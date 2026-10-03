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
        list: async (options: { prefix: string }) => ({
            keys: [...store.keys()]
                .filter((key) => key.startsWith(options.prefix))
                .map((name) => ({ name })),
        }),
    };
}
