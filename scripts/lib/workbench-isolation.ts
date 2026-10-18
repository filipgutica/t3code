// @effect-diagnostics nodeBuiltinImport:off - Inspect source imports without executing applications.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { Schema } from "effect";
import ts from "typescript-legacy";

export const IntegrationPolicy = Schema.Struct({
  integrations: Schema.Array(
    Schema.Struct({
      source: Schema.String,
      target: Schema.String,
      symbols: Schema.Array(Schema.String),
      reason: Schema.String,
    }),
  ),
});

export interface WorkbenchImport {
  readonly source: string;
  readonly line: number;
  readonly target: string;
  readonly symbols: ReadonlyArray<string>;
}

const slash = (path: string) => path.replaceAll(NodePath.sep, "/");
const modulePath = (path: string) => slash(path).replace(/\.[cm]?[jt]sx?$/, "");
export const isWorkbenchOwned = (path: string) =>
  /^(?:apps\/[^/]+\/src\/workbench\/|packages\/workbench\/|packages\/contracts\/src\/workbench|apps\/workbench-|infra\/workbench-|scripts\/(?:lib\/)?workbench-)/.test(
    path,
  ) || /^apps\/web\/src\/routes\/workbench(?:\.tsx)?$/.test(path);

export const isWorkbenchForkPath = (path: string) =>
  isWorkbenchOwned(path) ||
  /^(?:\.github\/workflows\/workbench-|docs\/internals\/workbench-)/.test(path);

export const isRuntimeSource = (path: string) =>
  /^(apps|packages|infra|scripts)\//.test(path) &&
  /\.[cm]?[jt]sx?$/.test(path) &&
  !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) &&
  !isWorkbenchOwned(path);

const importSymbols = (clause: ts.ImportClause | undefined) => {
  if (!clause) return ["<side-effect>"];
  const bindings = clause.namedBindings;
  const symbols = clause.name ? ["default"] : [];
  if (bindings && ts.isNamespaceImport(bindings)) symbols.push("*");
  if (bindings && ts.isNamedImports(bindings))
    symbols.push(...bindings.elements.map((item) => (item.propertyName ?? item.name).text));
  return symbols;
};

const importTypeSymbol = (name: ts.EntityName | undefined): string => {
  if (!name) return "*";
  return ts.isIdentifier(name) ? name.text : importTypeSymbol(name.left);
};

const moduleLoadEdge = (node: ts.Node) => {
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    const literal = node.moduleReference.expression;
    if (literal && ts.isStringLiteralLike(literal)) return { literal, symbols: ["*"] };
  }
  if (!ts.isCallExpression(node)) return;
  const isModuleLoad =
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === "require");
  const literal = node.arguments[0];
  if (isModuleLoad && literal && ts.isStringLiteralLike(literal))
    return { literal, symbols: ["*"] };
};

const moduleEdge = (node: ts.Node) => {
  if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier))
    return { literal: node.moduleSpecifier, symbols: importSymbols(node.importClause) };
  if (
    ts.isExportDeclaration(node) &&
    node.moduleSpecifier &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    const symbols =
      node.exportClause && ts.isNamedExports(node.exportClause)
        ? node.exportClause.elements.map((item) => (item.propertyName ?? item.name).text)
        : ["*"];
    return { literal: node.moduleSpecifier, symbols };
  }
  const load = moduleLoadEdge(node);
  if (load) return load;
  if (
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    ts.isStringLiteralLike(node.argument.literal)
  )
    return { literal: node.argument.literal, symbols: [importTypeSymbol(node.qualifier)] };
};

/** Resolve aliases with each caller's compiler configuration; include import/export and lazy edges. */
export const collectWorkbenchImports = ({
  root,
  sources,
}: {
  root: string;
  sources: ReadonlyMap<string, string>;
}): ReadonlyArray<WorkbenchImport> => {
  const options = new Map<string, ts.CompilerOptions>();
  const imports: WorkbenchImport[] = [];
  const compilerOptions = (filename: string) => {
    const config = ts.findConfigFile(NodePath.dirname(filename), ts.sys.fileExists);
    if (!config) return {};
    const cached = options.get(config);
    if (cached) return cached;
    const read = ts.readConfigFile(config, ts.sys.readFile);
    if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, NodePath.dirname(config));
    options.set(config, parsed.options);
    return parsed.options;
  };
  for (const [source, content] of sources) {
    if (!isRuntimeSource(source)) continue;
    const filename = NodePath.resolve(root, source);
    const tree = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true);
    const record = (literal: ts.StringLiteralLike, symbols: ReadonlyArray<string>) => {
      const specifier = literal.text;
      const resolved = ts.resolveModuleName(specifier, filename, compilerOptions(filename), ts.sys)
        .resolvedModule?.resolvedFileName;
      const relative = specifier.startsWith(".")
        ? NodePath.resolve(NodePath.dirname(filename), specifier)
        : undefined;
      const target = resolved ?? relative;
      const path = target ? modulePath(NodePath.relative(root, target)) : specifier;
      // Wildcard barrel access can hide Workbench use; require an explicit reviewed site.
      const contractSymbols = symbols.filter(
        (name) => name === "*" || /^(Workbench|WORKBENCH_)/.test(name),
      );
      const isContractBarrel =
        specifier === "@t3tools/contracts" || path === "packages/contracts/src/index";
      if (
        isWorkbenchOwned(path) ||
        specifier.startsWith("@t3tools/workbench") ||
        (isContractBarrel && contractSymbols.length > 0)
      ) {
        imports.push({
          source,
          line: tree.getLineAndCharacterOfPosition(literal.getStart(tree)).line + 1,
          target: path,
          symbols: isContractBarrel ? contractSymbols : symbols,
        });
      }
    };
    const visit = (node: ts.Node) => {
      const edge = moduleEdge(node);
      if (edge) record(edge.literal, edge.symbols);
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return imports;
};

export const validateWorkbenchIntegrations = ({
  imports,
  policy,
}: {
  imports: ReadonlyArray<WorkbenchImport>;
  policy: typeof IntegrationPolicy.Type;
}): ReadonlyArray<string> => {
  const violations: string[] = [];
  const keys = new Set<string>();
  for (const entry of policy.integrations) {
    const key = `${entry.source} -> ${entry.target}`;
    if (keys.has(key)) violations.push(`Duplicate integration: ${key}`);
    keys.add(key);
    if (!entry.reason.trim() || entry.symbols.length === 0)
      violations.push(`Integration needs a purpose and symbols: ${key}`);
    const edges = imports.filter(
      (edge) => edge.source === entry.source && edge.target === entry.target,
    );
    if (edges.length === 0) violations.push(`Remove obsolete integration: ${key}`);
    const obsolete = entry.symbols.filter(
      (symbol) => !edges.some((edge) => edge.symbols.includes(symbol)),
    );
    violations.push(
      ...obsolete.map((symbol) => `Remove obsolete integration symbol: ${key} (${symbol})`),
    );
  }
  for (const edge of imports) {
    const entry = policy.integrations.find(
      (allowed) => allowed.source === edge.source && allowed.target === edge.target,
    );
    if (!entry || edge.symbols.some((symbol) => !entry.symbols.includes(symbol)))
      violations.push(
        `${edge.source}:${edge.line} imports ${edge.target} (${edge.symbols.join(", ")}) outside the reviewed host boundary`,
      );
  }
  return violations;
};

export const readRuntimeSources = (root: string, files: ReadonlyArray<string>) =>
  new Map(
    files
      .filter((file) => isRuntimeSource(file) && NodeFS.existsSync(NodePath.resolve(root, file)))
      .map((file) => [file, NodeFS.readFileSync(NodePath.resolve(root, file), "utf8")]),
  );
