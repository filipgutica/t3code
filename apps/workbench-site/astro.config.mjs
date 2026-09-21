import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://filipgutica.github.io",
  base: "/t3code",
  output: "static",
  trailingSlash: "always",
  // Preserve separate animation-timeline declarations: the minifier combines them
  // into an animation shorthand that current browsers can reject.
  vite: { build: { cssMinify: false } },
  server: { port: 4175 },
});
