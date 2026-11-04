/**
 * Adapt Jira's wiki-style text for the read-only Markdown preview; never change the saved source.
 * `jira` looks for wiki markers in `source`; `"wiki"` converts a fragment of a document that has them.
 */
export function workbenchDescriptionMarkdown(source: string, jira: boolean | "wiki"): string {
  const wiki =
    jira === "wiki" ||
    (jira && /(^h[1-6]\. |\{\{|\{code|\{noformat\}|\[[^\]\n]+\|https?:)/m.test(source));
  if (!wiki) return source;
  let fenced = false;
  return source
    .split("\n")
    .map((line) => {
      const code = /^\{(code(?::([^}]+))?|noformat)\}\s*$/.exec(line);
      if (code) {
        const language = fenced ? "" : (code[2] ?? "");
        fenced = !fenced;
        return `\`\`\`${language}`;
      }
      if (fenced) return line;
      let rendered = line
        .replace(/^h([1-6])\. /, (_, level: string) => `${"#".repeat(Number(level))} `)
        .replace(/^(#+)\s+/, (match, marks: string) =>
          line.startsWith("h") ? match : `${"  ".repeat(marks.length - 1)}1. `,
        )
        .replace(/^(\*+)\s+/, (_, marks: string) => `${"  ".repeat(marks.length - 1)}- `)
        .replace(/\[([^\]\n|]+)\|([^\]\n]+)\]/g, "[$1]($2)")
        .replace(/\{\{([^}\n]+)\}\}/g, "`$1`")
        .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "**$1**");
      if (rendered.startsWith("||") && rendered.endsWith("||")) {
        const cells = rendered.slice(2, -2).split("||");
        rendered = `|${cells.join("|")}|\n|${cells.map(() => "---").join("|")}|`;
      }
      return rendered;
    })
    .join("\n");
}
