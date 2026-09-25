import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://filipgutica.github.io",
  base: "/t3code",
  output: "static",
  trailingSlash: "always",
  server: { port: 4175 },
});
