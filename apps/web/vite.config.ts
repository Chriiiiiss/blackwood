import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("../..", import.meta.url)), [
    "API_",
    "DEV_TLS_",
  ]);
  const port = env.API_PORT ?? process.env.API_PORT ?? "3000";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("API_PORT must be an integer between 1 and 65535.");
  }
  const cert = env.DEV_TLS_CERT;
  const key = env.DEV_TLS_KEY;
  if (!!cert !== !!key)
    throw new Error(
      "Set both DEV_TLS_CERT and DEV_TLS_KEY for HTTPS development.",
    );

  return {
    plugins: [
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react(),
    ],
    server: {
      port: 5173,
      strictPort: true,
      ...(cert && key
        ? { https: { cert: readFileSync(cert), key: readFileSync(key) } }
        : {}),
      proxy: {
        "/api": `http://127.0.0.1:${port}`,
      },
    },
  };
});
