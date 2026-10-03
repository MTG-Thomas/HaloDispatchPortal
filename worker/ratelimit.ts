/**
 * Per-IP rate limit for the public booking endpoints (mint, slots, book).
 *
 * Choice: two layers, either of which can deny.
 * - In-memory sliding window (30 req/min/IP/isolate) is the precise
 *   enforcer. It is cheap and exact within one isolate, but each Worker
 *   isolate holds its own map, so a distributed burst across many isolates
 *   would slip past memory alone.
 * - A KV counter (`book:rl:<ip>`, 120 req/min/IP) extends enforcement
 *   across isolates. KV is eventually consistent, so this layer is
 *   best-effort: it may over-count (double increments under concurrency)
 *   or briefly under-count (stale reads). The headroom between the two
 *   limits (30 vs 120) keeps KV staleness from blocking legitimate users
 *   while still blunting cross-isolate floods.
 *
 * KV failures fail open to the memory verdict: rate limiting must never
 * take booking down when KV is unavailable.
 */

import type { KeyValueClient } from "./kv";

export const RATE_LIMIT_WINDOW_SEC = 60;
export const RATE_LIMIT_MEMORY_MAX = 30;
export const RATE_LIMIT_KV_MAX = 120;

interface KvCounter {
    count: number;
    reset: number;
}

const memory = new Map<string, number[]>();

export function rateLimitKey(ip: string): string {
    return `book:rl:${ip}`;
}

/** Test-only reset for the in-memory windows. */
export function resetRateLimitsForTests(): void {
    memory.clear();
}

function memoryAllows(ip: string, nowMs: number): boolean {
    const windowStart = nowMs - RATE_LIMIT_WINDOW_SEC * 1000;
    const kept = (memory.get(ip) ?? []).filter((t) => t > windowStart);
    if (kept.length >= RATE_LIMIT_MEMORY_MAX) {
        memory.set(ip, kept);
        return false;
    }
    kept.push(nowMs);
    memory.set(ip, kept);
    return true;
}

function parseCounter(raw: string | null): KvCounter | null {
    if (raw === null) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as Partial<KvCounter>;
        if (typeof parsed.count === "number" && typeof parsed.reset === "number") {
            return { count: parsed.count, reset: parsed.reset };
        }
        return null;
    } catch {
        return null;
    }
}

export async function checkPublicRateLimit(
    kv: KeyValueClient,
    ip: string,
    nowMs: number = Date.now(),
): Promise<{ allowed: boolean }> {
    const memoryOk = memoryAllows(ip, nowMs);
    let kvOk = true;
    try {
        const key = rateLimitKey(ip);
        const windowMs = RATE_LIMIT_WINDOW_SEC * 1000;
        const current = parseCounter(await kv.get(key));
        const counter: KvCounter =
            current && nowMs < current.reset
                ? { count: current.count + 1, reset: current.reset }
                : { count: 1, reset: nowMs + windowMs };
        kvOk = counter.count <= RATE_LIMIT_KV_MAX;
        const ttlSec = Math.max(1, Math.ceil((counter.reset - nowMs) / 1000) + 60);
        await kv.put(key, JSON.stringify(counter), { expirationTtl: ttlSec });
    } catch {
        kvOk = true;
    }
    return { allowed: memoryOk && kvOk };
}
