import { vitePlugin as reactRouter } from "@react-router/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    reactRouter({
      future: {
        unstable_serverComponents: true,
      },
    }),
    tsconfigPaths(),
  ],
});
