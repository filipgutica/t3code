import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import type { getWorkbenchPullRequestAttention } from "./workbenchAttention.logic";

type Input = Parameters<typeof getWorkbenchPullRequestAttention>[0];
type Target = { readonly environmentId: EnvironmentId; readonly input: PullRequestRef };
const targetKey = (target: Target) => JSON.stringify(target);

/** Controllable native answers; each test owns the registry and its query leases. */
export function createAttentionNativeFixture() {
  const registry = AtomRegistry.make();
  const active = new Set<string>();
  const queryKeys = new WeakMap<object, string>();
  const leases = new Map<string, number>();
  let maxActive = 0;
  const subscribe = registry.subscribe.bind(registry);
  // Cached atom nodes outlive their listeners; count the native query leases the owner holds.
  Object.defineProperty(registry, "subscribe", {
    value: <A>(
      atom: Atom.Atom<A>,
      listener: (value: A) => void,
      options?: { readonly immediate?: boolean },
    ) => {
      const key = queryKeys.get(atom);
      if (key !== undefined) {
        leases.set(key, (leases.get(key) ?? 0) + 1);
        active.add(key);
        maxActive = Math.max(maxActive, active.size);
      }
      const stop = subscribe(atom, listener, options);
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        stop();
        if (key === undefined) return;
        const remaining = leases.get(key)! - 1;
        if (remaining > 0) leases.set(key, remaining);
        else {
          leases.delete(key);
          active.delete(key);
        }
      };
    },
  });
  const targets: Array<{ kind: string; target: Target }> = [];
  const answers = new Map<
    string,
    {
      summary: AsyncResult.AsyncResult<Input["summary"], Error>;
      activity: AsyncResult.AsyncResult<Input["activity"], Error>;
    }
  >();
  const initial = AsyncResult.initial<never, Error>(true);
  const query = Atom.family((key: string) => {
    const [kind, identity] = JSON.parse(key) as ["summary" | "activity", string];
    return Atom.make(() => answers.get(identity)?.[kind] ?? initial).pipe(Atom.setIdleTTL(0));
  });
  const summary = Atom.family((identity: string) =>
    Atom.make((get) => {
      const result = get(query(JSON.stringify(["summary", identity])));
      return AsyncResult.getOrElse(result, () => null) as Input["summary"];
    }).pipe(Atom.setIdleTTL(0)),
  );
  const viewers = new Map<string, AsyncResult.AsyncResult<{ viewer: string | undefined }, Error>>();
  const viewerQuery = Atom.family((key: string) =>
    Atom.make(() => viewers.get(key) ?? AsyncResult.success({ viewer: undefined })).pipe(
      Atom.setIdleTTL(0),
    ),
  );
  const queryFor = (kind: "summary" | "activity", target: Target) => {
    targets.push({ kind, target });
    const key = JSON.stringify([kind, targetKey(target)]);
    const atom = query(key);
    queryKeys.set(atom, key);
    return atom;
  };
  const stage = (target: Target, input: Input) => {
    // Native PR reads cannot succeed with null; a settled missing answer is unavailable.
    const result = <A>(data: A | null): AsyncResult.AsyncResult<A | null, Error> =>
      input.error || (data === null && !input.loading)
        ? AsyncResult.failure(Cause.fail(new Error("Native PR read failed")), {
            waiting: input.loading,
            previousSuccess: data === null ? Option.none() : Option.some(AsyncResult.success(data)),
          })
        : data === null
          ? AsyncResult.initial(input.loading)
          : AsyncResult.success(data, { waiting: input.loading });
    answers.set(targetKey(target), {
      summary: result(input.summary),
      activity: result(input.activity),
    });
  };
  const publish = (target: Target, input: Input) => {
    stage(target, input);
    for (const kind of ["summary", "activity"] as const) {
      const key = JSON.stringify([kind, targetKey(target)]);
      if (active.has(key)) registry.refresh(query(key));
    }
  };
  return {
    registry,
    active,
    targets,
    get maxActive() {
      return maxActive;
    },
    activeKeys: () =>
      [...active].map((key) => {
        const [kind, identity] = JSON.parse(key) as [string, string];
        const target = JSON.parse(identity) as Target;
        return `${kind}:${target.input.number}`;
      }),
    summaryQuery: (target: Target) => queryFor("summary", target),
    activityQuery: (target: Target) => queryFor("activity", target),
    sharedSummary: (environmentId: EnvironmentId, input: PullRequestRef) =>
      summary(targetKey({ environmentId, input })),
    viewerQuery: (target: { environmentId: EnvironmentId; input: { host: string } }) =>
      viewerQuery(JSON.stringify(target)),
    setViewer: (
      environmentId: EnvironmentId,
      host: string,
      status: "pending" | "settled" | "failed",
      viewer = "filipgutica",
    ) => {
      const key = JSON.stringify({ environmentId, input: { host } });
      viewers.set(
        key,
        status === "pending"
          ? AsyncResult.initial(true)
          : status === "failed"
            ? AsyncResult.failure(Cause.fail(new Error("Identity lookup failed")))
            : AsyncResult.success({ viewer }),
      );
      if (registry.getNodes().has(viewerQuery(key))) registry.refresh(viewerQuery(key));
    },
    stage,
    publish,
  };
}
