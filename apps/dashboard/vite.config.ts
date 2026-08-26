import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const envFile = path.resolve(fileURLToPath(new URL("../../.env", import.meta.url)));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({ plugins: [react()], server: { proxy: { "/api": process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000" } }, test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], restoreMocks: true } });
