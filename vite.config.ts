import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    plugins: [sveltekit()],
    define: {
      __SKYBOARD_CONSTELLATION_URL__: JSON.stringify(
        env.VITE_CONSTELLATION_URL || "",
      ),
      __SKYBOARD_JETSTREAM_URL__: JSON.stringify(env.VITE_JETSTREAM_URL || ""),
    },
    server: {
      port: 3001,
      host: "127.0.0.1",
    },
  };
});
