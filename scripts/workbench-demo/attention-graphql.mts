import * as Effect from "effect/Effect";
import * as RequestResolver from "effect/RequestResolver";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { GraphQLClient, GraphQLGroup, GraphQLProtocol, GraphQLResolver } from "effect/graphql";
import { PullRequestSummary } from "../../packages/source-control-github/src/server/pullRequestBatches.graphql.ts";

const decodeVariables = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

/** Capture the native resolver's document so fixture allowlists follow its alias encoding. */
export const attentionSummaryDocument = (
  references: ReadonlyArray<{ readonly repository: string; readonly number: number }>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      let document: { query: string; variables: unknown } | undefined;
      const client = yield* GraphQLClient.make(GraphQLGroup.make(PullRequestSummary)).pipe(
        Effect.provideService(GraphQLProtocol.GraphQLProtocol, {
          execute: (request) => {
            document = { query: request.query, variables: request.variables };
            const variables = decodeVariables(request.variables);
            return Effect.succeed({
              body: {
                data: Object.fromEntries(
                  Object.keys(variables)
                    .filter((name) => /^_\d+_number$/.test(name))
                    .map((name) => [name.replace(/number$/, "repository"), null]),
                ),
              },
            });
          },
          subscribe: () => Stream.empty,
        }),
      );
      const lookup = GraphQLResolver.request(
        GraphQLResolver.aliased(client.PullRequestSummary).pipe(RequestResolver.batchN(25)),
      );
      yield* Effect.forEach(
        references,
        ({ repository, number }) => {
          const [owner, name] = repository.split("/");
          return lookup({ owner: owner!, name: name!, number, stacks: true });
        },
        { concurrency: "unbounded" },
      );
      if (document === undefined)
        return yield* Effect.die("No attention summary document generated");
      return document;
    }),
  );
