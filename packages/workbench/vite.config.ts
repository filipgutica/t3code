import { defineConfig } from "vite-plus";
import baseConfig from "../../vite.config.ts";

export default defineConfig({
  ...baseConfig,
  // The root's web-only alias is not part of the Workbench package boundary.
  resolve: { alias: {} },
});
