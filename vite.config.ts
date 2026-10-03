import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/**
 * Dev-only: strip the CSP meta tag from served index.html. The production
 * bundle needs no inline scripts, but `vite dev` injects an inline React
 * preamble and HMR client that script-src 'self' would block. Built output
 * (and `vite preview`) keeps the policy.
 */
function stripCspMetaInDev(): Plugin {
    return {
        name: "strip-csp-meta-in-dev",
        apply: "serve",
        transformIndexHtml(html) {
            return html.replace(
                /<meta http-equiv="Content-Security-Policy"[^>]*>/,
                "<!-- CSP meta stripped in dev (applies to built output) -->",
            );
        },
    };
}

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss(), stripCspMetaInDev()],
    test: {
        environment: "jsdom",
        setupFiles: ["./src/test/setup.ts"],
        globals: true,
        include: ["src/**/*.{test,spec}.{ts,tsx}"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            include: ["src/lib/**/*.ts", "src/services/**/*.ts", "src/stores/**/*.ts"],
        },
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    build: {
        // Source maps for production debugging
        sourcemap: false,

        // Chunk size warning threshold (500kb)
        chunkSizeWarningLimit: 500,

        // Minification settings
        minify: "esbuild",
        target: "es2020",
    },
});
