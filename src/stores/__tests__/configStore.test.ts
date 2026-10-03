import { describe, it, expect, beforeEach } from "vitest";
import { useConfigStore } from "../configStore";

describe("configStore validation", () => {
    beforeEach(() => {
        useConfigStore.setState({
            config: {
                tenant: "",
                authServer: "",
                resourceServer: "",
                clientId: "",
                redirectUri: "",
            },
            isConfigured: false,
        });
    });

    it("normalizes server URLs on set", () => {
        useConfigStore.getState().setConfig({
            authServer: "  https://a.halopsa.com/auth/// ",
            resourceServer: "https://a.halopsa.com/",
        });
        const { config } = useConfigStore.getState();
        expect(config.authServer).toBe("https://a.halopsa.com/auth");
        expect(config.resourceServer).toBe("https://a.halopsa.com");
    });

    it("trims tenant, clientId, and redirectUri", () => {
        useConfigStore.getState().setConfig({
            tenant: "  acme ",
            clientId: "  cid ",
            redirectUri: "  http://localhost:5173/auth/callback ",
        });
        const { config } = useConfigStore.getState();
        expect(config.tenant).toBe("acme");
        expect(config.clientId).toBe("cid");
        expect(config.redirectUri).toBe("http://localhost:5173/auth/callback");
    });

    it("is configured only when clientId and both servers are present", () => {
        const { setConfig } = useConfigStore.getState();
        setConfig({ clientId: "cid" });
        expect(useConfigStore.getState().isConfigured).toBe(false);
        setConfig({ authServer: "https://a.halopsa.com/auth" });
        expect(useConfigStore.getState().isConfigured).toBe(false);
        setConfig({ resourceServer: "https://a.halopsa.com" });
        expect(useConfigStore.getState().isConfigured).toBe(true);
    });

    it("whitespace-only values do not count as configured", () => {
        useConfigStore.getState().setConfig({
            clientId: "   ",
            authServer: "https://a.halopsa.com/auth",
            resourceServer: "https://a.halopsa.com",
        });
        expect(useConfigStore.getState().isConfigured).toBe(false);
    });

    it("resetConfig clears to defaults with a generated redirect URI", () => {
        useConfigStore.getState().setConfig({
            tenant: "acme",
            clientId: "cid",
            authServer: "https://a.halopsa.com/auth",
            resourceServer: "https://a.halopsa.com",
        });
        useConfigStore.getState().resetConfig();
        const { config, isConfigured } = useConfigStore.getState();
        expect(config.tenant).toBe("");
        expect(config.clientId).toBe("");
        expect(config.redirectUri).toMatch(/\/auth\/callback$/);
        expect(isConfigured).toBe(false);
    });
});
