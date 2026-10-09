import { WorkbenchRpcGroup } from "@t3tools/contracts";
import type * as RpcGroup from "effect/rpc/RpcGroup";

type WorkbenchRpcMethod = RpcGroup.Rpcs<typeof WorkbenchRpcGroup>["_tag"];

export const WORKBENCH_RPC_AGGREGATES = Object.fromEntries(
  [...WorkbenchRpcGroup.requests.keys()].map((method) => [method, "workbench"]),
) as Record<WorkbenchRpcMethod, "workbench">;
