import { defineConfig } from "cf/config";

/**
 * Cloudflare Workers hosting (static frontend only — the app still talks to
 * HaloPSA directly; the token-vault BFF is a later phase).
 *
 * Deploy: npm run build && cf deploy
 * Preview: https://halo-dispatch-portal.<account>.workers.dev
 * Custom:  https://dispatch.midtowntg.com
 */
export default defineConfig({
    worker: {
        name: "halo-dispatch-portal",
        compatibilityDate: "2026-10-03",
        assets: {
            notFoundHandling: "single-page-application",
        },
        domains: ["dispatch.midtowntg.com"],
    },
});
