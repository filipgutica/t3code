import type * as Effect from "effect/Effect";

/** Product decisions consumed by the native packaging mechanics. */
export interface DesktopBuildProduct {
  readonly appId: string;
  readonly packageName: string;
  readonly productName: string;
  readonly artifactName: string;
  readonly protocols: readonly { readonly name: string; readonly schemes: readonly string[] }[];
  readonly publish: readonly Record<string, unknown>[] | null;
  readonly mac: {
    readonly hardenedRuntime?: boolean;
    readonly forceCodeSigning: boolean;
    readonly identity?: string;
    readonly notarize?: false;
    readonly usePasskeySigning: boolean;
  };
  readonly linux: {
    readonly executableName: string;
    readonly includeDeb: boolean;
    readonly includeNativeDebMetadata: boolean;
  };
  readonly validateBuildMode: (skipBuild: boolean) => Effect.Effect<void, Error>;
  readonly validateSigningEnvironment: (
    env: Readonly<Record<string, string | undefined>>,
  ) => Effect.Effect<void, Error>;
  readonly bundleEnvironment: (baseEnv: Readonly<NodeJS.ProcessEnv>) => NodeJS.ProcessEnv;
}
