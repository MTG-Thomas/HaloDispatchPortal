// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
    checkPublicRateLimit,
    RATE_LIMIT_KV_MAX,
    RATE_LIMIT_MEMORY_MAX,
    rateLimitKey,
    resetRateLimitsForTests,
} from "../ratelimit";
import { fakeKv } from "./fake-kv";

describe("public rate limit", () => {
    it("allows bursts under the in-memory limit", async () => {
        resetRateLimitsForTests();
        const kv = fakeKv();
        for (let i = 0; i < RATE_LIMIT_MEMORY_MAX; i++) {
            await expect(checkPublicRateLimit(kv, "10.1.0.1")).resolves.toEqual({ allowed: true });
        }
    });

    it("denies past the in-memory limit and scopes by IP", async () => {
        resetRateLimitsForTests();
        const kv = fakeKv();
        for (let i = 0; i < RATE_LIMIT_MEMORY_MAX; i++) {
            await checkPublicRateLimit(kv, "10.1.0.2");
        }
        await expect(checkPublicRateLimit(kv, "10.1.0.2")).resolves.toEqual({ allowed: false });
        await expect(checkPublicRateLimit(kv, "10.1.0.3")).resolves.toEqual({ allowed: true });
    });

    it("denies when the KV cross-isolate counter is exhausted", async () => {
        resetRateLimitsForTests();
        const kv = fakeKv({
            [rateLimitKey("10.1.0.4")]: JSON.stringify({
                count: RATE_LIMIT_KV_MAX,
                reset: Date.now() + 60_000,
            }),
        });
        await expect(checkPublicRateLimit(kv, "10.1.0.4")).resolves.toEqual({ allowed: false });
    });

    it("fails open when KV throws", async () => {
        resetRateLimitsForTests();
        const kv = {
            get: vi.fn(async () => {
                throw new Error("kv down");
            }),
            put: vi.fn(async () => undefined),
            delete: vi.fn(async () => undefined),
            list: vi.fn(async () => {
                throw new Error("kv down");
            }),
        };
        await expect(checkPublicRateLimit(kv, "10.1.0.5")).resolves.toEqual({ allowed: true });
    });
});
