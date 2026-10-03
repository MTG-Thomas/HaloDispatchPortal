import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getModelContext, type WebMcpRegisteredTool } from "@/lib/webmcp";

/**
 * Dev-only WebMCP invoker. Lists the tools registered by the current route
 * and runs one with a JSON input, standing in for a model agent until a
 * real WebMCP client exists. Mounted only when `import.meta.env.DEV`.
 */
export function WebMcpPanel() {
    const [tools, setTools] = useState<WebMcpRegisteredTool[] | null>(null);
    const [selected, setSelected] = useState("");
    const [input, setInput] = useState("{}");
    const [output, setOutput] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState(false);

    if (!open) {
        return (
            <Button
                variant="outline"
                size="sm"
                className="fixed bottom-2 right-2 z-50 opacity-70"
                onClick={() => setOpen(true)}
            >
                WebMCP
            </Button>
        );
    }

    async function refresh() {
        setError(null);
        try {
            const context = getModelContext();
            if (!context) {
                setTools([]);
                setError("No model context: this browser does not support WebMCP.");
                return;
            }
            const listed = await context.getTools();
            setTools(listed);
            if (!selected && listed.length > 0) setSelected(listed[0].name);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }

    async function invoke() {
        setError(null);
        setOutput("");
        try {
            const context = getModelContext();
            if (!context) throw new Error("No model context.");
            let parsed: unknown;
            try {
                parsed = JSON.parse(input) as unknown;
            } catch {
                throw new Error("Input is not valid JSON.");
            }
            setOutput(await context.executeTool(selected, parsed));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }

    return (
        <Card className="fixed bottom-2 right-2 z-50 w-96 max-h-[70vh] overflow-auto opacity-95">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm">WebMCP invoker (dev)</CardTitle>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => void refresh()}>
                        List tools
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                        Close
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
                {error && <p className="text-destructive">{error}</p>}
                {tools && tools.length === 0 && !error && <p>No tools registered on this route.</p>}
                {tools && tools.length > 0 && (
                    <>
                        <label className="block">
                            <span className="font-medium">Tool</span>
                            <select
                                className="mt-1 w-full rounded border bg-background p-1"
                                value={selected}
                                onChange={(event) => setSelected(event.target.value)}
                            >
                                {tools.map((tool) => (
                                    <option key={tool.name} value={tool.name}>
                                        {tool.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="block">
                            <span className="font-medium">Input (JSON)</span>
                            <textarea
                                className="mt-1 w-full rounded border bg-background p-1 font-mono"
                                rows={4}
                                value={input}
                                onChange={(event) => setInput(event.target.value)}
                            />
                        </label>
                        <Button size="sm" onClick={() => void invoke()} disabled={!selected}>
                            Run tool
                        </Button>
                        {output && (
                            <pre className="whitespace-pre-wrap break-words rounded border bg-muted p-2 font-mono">
                                {output}
                            </pre>
                        )}
                    </>
                )}
                {!tools && !error && <p>Click “List tools” to query the model context.</p>}
            </CardContent>
        </Card>
    );
}
