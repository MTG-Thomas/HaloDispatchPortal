import type { KeyValueClient } from "../kv";

/** In-memory {@link KeyValueClient} for worker tests. */
export function fakeKv(initial: Record<string, string> = {}): KeyValueClient {
    const store = new Map<string, string>(Object.entries(initial));
    return {
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string, value: string) => {
            store.set(key, value);
        },
        delete: async (key: string) => {
            store.delete(key);
        },
        list: async (options: { prefix: string; cursor?: string; limit?: number }) => {
            const names = [...store.keys()].filter((key) => key.startsWith(options.prefix));
            const start = options.cursor === undefined ? 0 : Number(options.cursor);
            const end =
                options.limit === undefined
                    ? names.length
                    : Math.min(names.length, start + options.limit);
            const keys = names.slice(start, end).map((name) => ({ name }));
            return end >= names.length
                ? { keys, list_complete: true as const }
                : { keys, list_complete: false as const, cursor: String(end) };
        },
    };
}
