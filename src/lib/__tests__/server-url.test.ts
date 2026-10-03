import { describe, it, expect } from "vitest";
import {
    normalizeServerUrl,
    isHaloSaasHost,
    isValidTenantSlug,
    validateServerUrl,
    isAllowedServerUrl,
    buildResourceServer,
    buildAuthServer,
} from "../server-url";

describe("normalizeServerUrl", () => {
    it("trims whitespace and trailing slashes", () => {
        expect(normalizeServerUrl("  https://a.halopsa.com///  ")).toBe("https://a.halopsa.com");
    });
});

describe("isHaloSaasHost", () => {
    it.each([
        ["halopsa.com", true],
        ["tenant.halopsa.com", true],
        ["Tenant.HaloPSA.com", true],
        ["halopsa.com.evil.com", false],
        ["evilhalopsa.com", false],
        ["example.com", false],
    ])("%s -> %s", (host, expected) => {
        expect(isHaloSaasHost(host)).toBe(expected);
    });
});

describe("isValidTenantSlug", () => {
    it.each([
        ["acme", true],
        ["acme-2", true],
        ["A1", true],
        ["", false],
        ["-acme", false],
        ["acme-", false],
        ["ac_me", false],
        ["acme.corp", false],
        ["a".repeat(64), false],
    ])("%s -> %s", (slug, expected) => {
        expect(isValidTenantSlug(slug as string)).toBe(expected);
    });
});

describe("validateServerUrl", () => {
    it("requires a value", () => {
        expect(validateServerUrl("")).toMatch(/required/);
    });

    it("rejects non-URLs and relative paths", () => {
        expect(validateServerUrl("not-a-url")).toMatch(/absolute URL/);
        expect(validateServerUrl("/auth")).toMatch(/absolute URL/);
    });

    it("rejects embedded credentials, query, and fragment", () => {
        expect(validateServerUrl("https://user:pass@a.halopsa.com")).toMatch(/credentials/);
        expect(validateServerUrl("https://a.halopsa.com?x=1")).toMatch(/without query or fragment/);
        expect(validateServerUrl("https://a.halopsa.com#frag")).toMatch(
            /without query or fragment/,
        );
    });

    it("requires https except for localhost", () => {
        expect(validateServerUrl("http://a.halopsa.com")).toMatch(/https/);
        expect(
            validateServerUrl("http://localhost:8080", {
                allowCustomHosts: true,
            }),
        ).toBeNull();
        expect(
            validateServerUrl("http://127.0.0.1:8080", {
                allowCustomHosts: true,
            }),
        ).toBeNull();
        expect(validateServerUrl("ftp://a.halopsa.com")).toMatch(/https/);
    });

    it("allowlists shared-link origins to *.halopsa.com", () => {
        expect(validateServerUrl("https://a.halopsa.com")).toBeNull();
        expect(validateServerUrl("https://selfhosted.example.com")).toMatch(/halopsa\.com/);
        // Manual config may use self-hosted Halo over https.
        expect(
            validateServerUrl("https://selfhosted.example.com", {
                allowCustomHosts: true,
            }),
        ).toBeNull();
    });

    it("accepts a path prefix such as /auth", () => {
        expect(validateServerUrl("https://a.halopsa.com/auth")).toBeNull();
    });

    it("rejects overlong URLs", () => {
        expect(validateServerUrl(`https://a.halopsa.com/${"x".repeat(2100)}`)).toMatch(/too long/);
    });
});

describe("isAllowedServerUrl", () => {
    it("is the boolean form of validateServerUrl", () => {
        expect(isAllowedServerUrl("https://a.halopsa.com")).toBe(true);
        expect(isAllowedServerUrl("http://a.halopsa.com")).toBe(false);
    });
});

describe("URL builders", () => {
    it("derives SaaS servers from a tenant slug", () => {
        expect(buildResourceServer("Acme")).toBe("https://acme.halopsa.com");
        expect(buildAuthServer("https://acme.halopsa.com/")).toBe("https://acme.halopsa.com/auth");
    });
});
