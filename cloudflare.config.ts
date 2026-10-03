import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./worker/entry.ts" with { type: "cf-worker" };

/**
 * Cloudflare Workers hosting: the SPA is served as static assets and the same
 * Worker answers the booking-link BFF at /api/book/* (runWorkerFirst).
 * The app still talks to HaloPSA directly; sealed dispatcher tokens in KV let
 * the Worker make its own Halo calls for booking (slices 1-3: mint,
 * status, cancel, list, slots, book).
 *
 * Deploy: npm run build:cf && cf deploy --prebuilt --mode production
 * (--prebuilt is required: a bare `cf deploy` rebuilds without
 * CF_WORKERS_BUILD=1, dropping the Cloudflare Vite plugin output).
 * Preview: https://halo-dispatch-portal.<account>.workers.dev
 * Custom:  https://dispatch.midtowntg.com
 */
export default defineConfig({
    worker: {
        name: "halo-dispatch-portal",
        compatibilityDate: "2026-10-03",
        entrypoint,
        assets: {
            notFoundHandling: "single-page-application",
            runWorkerFirst: ["/api/book/*"],
        },
        domains: ["dispatch.midtowntg.com"],
        env: {
            BOOKING_REQUESTS: bindings.kv({ id: "d88fab52db17473f8d078b40b84a8203" }),
        },
    },
});
