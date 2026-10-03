import { describe, it, expect } from "vitest";
import {
    generateCodeVerifier,
    generateCodeChallenge,
    generateState,
    savePkceRequest,
    loadPkceRequest,
    clearPkceRequest,
} from "../pkce";

describe("PKCE helpers", () => {
    it("generates a 64-char verifier from the RFC 7636 unreserved set", () => {
        const verifier = generateCodeVerifier();
        expect(verifier).toHaveLength(64);
        expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
        expect(generateCodeVerifier()).not.toBe(verifier);
    });

    it("derives the RFC 7636 Appendix B S256 challenge", async () => {
        // RFC 7636 test vector.
        const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        await expect(generateCodeChallenge(verifier)).resolves.toBe(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        );
    });

    it("generates unique opaque state values", () => {
        const a = generateState();
        const b = generateState();
        expect(a).toBeTruthy();
        expect(b).toBeTruthy();
        expect(a).not.toBe(b);
    });

    it("round-trips PKCE material through sessionStorage", () => {
        expect(loadPkceRequest()).toBeNull();
        savePkceRequest({ state: "s", verifier: "v" });
        expect(loadPkceRequest()).toEqual({ state: "s", verifier: "v" });
        clearPkceRequest();
        expect(loadPkceRequest()).toBeNull();
    });

    it("loads null when only half the material is present", () => {
        sessionStorage.setItem("halo-dispatch-oauth-state", "s");
        expect(loadPkceRequest()).toBeNull();
    });
});
