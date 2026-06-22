/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./", // relative asset paths so dist/index.html opens via file:// (double-click)
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
