import { defineConfig } from "vite";

export function createConfig(env = process.env) {
  return {
    server: {
      proxy: {
        "/occupancy": env.DISPLAY_API_TARGET || "http://127.0.0.1:3000",
      },
    },
    test: { environment: "jsdom" },
  };
}

export default defineConfig(() => createConfig());
