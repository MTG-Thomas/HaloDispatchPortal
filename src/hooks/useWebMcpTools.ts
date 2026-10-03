import { useEffect } from "react";
import { registerWebMcpTools, type WebMcpToolDefinition } from "@/lib/webmcp";

/**
 * Register WebMCP tools for the lifetime of the mounted route. Registration
 * is aborted on unmount so tools never leak across routes.
 *
 * The `tools` array must be referentially stable (build with `useMemo`) —
 * a new array identity re-registers. No-op on browsers without WebMCP.
 */
export function useWebMcpTools(tools: WebMcpToolDefinition[]): void {
    useEffect(() => {
        const controller = new AbortController();
        void registerWebMcpTools(tools, { signal: controller.signal });
        return () => {
            controller.abort();
        };
    }, [tools]);
}
