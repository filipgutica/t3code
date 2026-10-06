import { defineConfig } from "astro/config";
import vue from "@astrojs/vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://filipgutica.github.io",
  base: "/t3code",
  output: "static",
  integrations: [vue()],
  vite: { plugins: [tailwindcss()] },
  trailingSlash: "always",
  image: { service: { config: { webp: { lossless: true } } } },
  server: { port: 4175 },
});
