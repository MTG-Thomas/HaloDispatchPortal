import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
    apiRequest,
    get,
    ApiError,
    isAbortError,
    createAbortController,
    resetCriticalErrorFlag,
} from "../api-client";
import { saveTokens, loadTokens } from "@/services/auth/authService";
import { useConfigStore } from "@/stores/configStore";

const RESOURCE = "https://tenant.halopsa.com";
const AUTH = "https://tenant.halopsa.com/auth";

function seedConfig() {
    useConfigStore.setState({
        config: {
            tenant: "tenant",
            authServer: AUTH,
            resourceServer: RESOURCE,
            clientId: "cid",
            redirectUri: "http://localhost:5173/auth/callback",
        },
        isConfigured: true,
    });
}

function seedFreshTokens() {
    saveTokens({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "all",
    });
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => {
    server.resetHandlers();
    resetCriticalErrorFlag();
    vi.restoreAllMocks();
});

describe("api-client", () => {
    it("sends the bearer token and parses JSON", async () => {
        seedConfig();
        seedFreshTokens();
        let seenAuth: string | null = null;
        server.use(
            http.get(`${RESOURCE}/api/Tickets`, ({ request }) => {
                seenAuth = request.headers.get("authorization");
                return HttpResponse.json({ tickets: [] });
            }),
        );

        const data = await get<{ tickets: unknown[] }>("/api/Tickets");
        expect(data).toEqual({ tickets: [] });
        expect(seenAuth).toBe("Bearer access-1");
    });

    it("refreshes once on 401 and retries the request", async () => {
        seedConfig();
        seedFreshTokens();
        let ticketCalls = 0;
        let refreshCalls = 0;
        server.use(
            http.get(`${RESOURCE}/api/Tickets`, () => {
                ticketCalls += 1;
                return ticketCalls === 1
                    ? new HttpResponse(null, { status: 401 })
                    : HttpResponse.json({ tickets: [] });
            }),
            http.post(`${AUTH}/token`, async ({ request }) => {
                refreshCalls += 1;
                const body = await request.text();
                expect(body).toMatch(/grant_type=refresh_token/);
                return HttpResponse.json({
                    access_token: "access-2",
                    refresh_token: "refresh-2",
                    expires_in: 3600,
                    token_type: "Bearer",
                    scope: "all",
                });
            }),
        );

        const data = await get<{ tickets: unknown[] }>("/api/Tickets");
        expect(data).toEqual({ tickets: [] });
        expect(ticketCalls).toBe(2);
        expect(refreshCalls).toBe(1);
        expect(loadTokens()?.access_token).toBe("access-2");
    });

    it("keeps tokens and throws when refresh fails transiently after 401", async () => {
        seedConfig();
        seedFreshTokens();
        server.use(
            http.get(`${RESOURCE}/api/Tickets`, () => {
                return new HttpResponse(null, { status: 401 });
            }),
            http.post(`${AUTH}/token`, () => {
                return new HttpResponse(null, { status: 400 });
            }),
        );

        await expect(get("/api/Tickets")).rejects.toThrow(ApiError);
        // No invalid_grant: the stored session survives for a later retry.
        expect(loadTokens()?.access_token).toBe("access-1");
    });

    it("clears tokens when refresh fails with invalid_grant after 401", async () => {
        seedConfig();
        seedFreshTokens();
        server.use(
            http.get(`${RESOURCE}/api/Tickets`, () => {
                return new HttpResponse(null, { status: 401 });
            }),
            http.post(`${AUTH}/token`, () => {
                return HttpResponse.json({ error: "invalid_grant" }, { status: 400 });
            }),
        );

        await expect(get("/api/Tickets")).rejects.toThrow(ApiError);
        expect(loadTokens()).toBeNull();
    });

    it("fails fast without sending the request when proactive refresh fails", async () => {
        seedConfig();
        saveTokens({
            access_token: "stale-access",
            refresh_token: "refresh-1",
            expires_in: 0,
            token_type: "Bearer",
            scope: "all",
        });
        let ticketCalls = 0;
        server.use(
            http.get(`${RESOURCE}/api/Tickets`, () => {
                ticketCalls += 1;
                return HttpResponse.json({ tickets: [] });
            }),
            http.post(`${AUTH}/token`, () => {
                return new HttpResponse(null, { status: 500 });
            }),
        );

        await expect(get("/api/Tickets")).rejects.toThrow(ApiError);
        expect(ticketCalls).toBe(0);
        expect(loadTokens()?.access_token).toBe("stale-access");
    });

    it("never surfaces raw error bodies in messages", async () => {
        seedConfig();
        seedFreshTokens();
        server.use(
            http.get(`${RESOURCE}/api/Tickets`, () => {
                return new HttpResponse("TENANT-SECRET-BODY", { status: 404 });
            }),
        );

        try {
            await apiRequest("/api/Tickets");
            expect.unreachable();
        } catch (error) {
            const apiError = error as ApiError;
            expect(apiError.status).toBe(404);
            expect(apiError.message).toMatch(/not found/i);
            expect(apiError.message).not.toMatch(/TENANT-SECRET/);
        }
    });

    it("refuses to call an invalid resource server", async () => {
        seedConfig();
        useConfigStore.setState({
            config: {
                ...useConfigStore.getState().config,
                resourceServer: "http://evil.example.com",
            },
        });
        seedFreshTokens();

        await expect(get("/api/Tickets")).rejects.toThrow(/invalid/i);
    });

    it("propagates AbortError without marking the API critical", async () => {
        seedConfig();
        seedFreshTokens();
        server.use(
            http.get(`${RESOURCE}/api/Tickets`, async () => {
                await new Promise((r) => setTimeout(r, 50));
                return HttpResponse.json({ tickets: [] });
            }),
        );

        const controller = createAbortController();
        const pending = get("/api/Tickets", undefined, {
            signal: controller.signal,
        });
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });

        // API still usable afterwards: no critical-error latch tripped.
        const data = await get<{ tickets: unknown[] }>("/api/Tickets");
        expect(data).toEqual({ tickets: [] });
    });

    it("isAbortError identifies cancellations only", () => {
        expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
        expect(isAbortError(new Error("nope"))).toBe(false);
        expect(isAbortError(new ApiError(500, "x"))).toBe(false);
    });
});
