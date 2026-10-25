import { defineConfig } from "vite-plus";
import baseConfig from "../../vite.config.ts";

// Workspace cache configuration is invalid on a package config.
const { run: _rootRunConfig, ...basePackageConfig } = baseConfig;

export default defineConfig({
  ...basePackageConfig,
  // The root's web-only alias is not part of the Workbench package boundary.
  resolve: { alias: {} },
});
