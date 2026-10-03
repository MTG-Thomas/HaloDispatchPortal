/**
 * Tiny logger for dispatch UI code.
 *
 * Single place to shape log output: every line carries a `[dispatch]` prefix
 * so tenant log noise stays greppable. `info`/`debug` only emit in dev;
 * `warn`/`error` always emit since they signal real failures.
 */

type LogArgs = unknown[];

function withPrefix(args: LogArgs): LogArgs {
    return ["[dispatch]", ...args];
}

export const logger = {
    error: (...args: LogArgs): void => {
        console.error(...withPrefix(args));
    },
    warn: (...args: LogArgs): void => {
        console.warn(...withPrefix(args));
    },
    info: (...args: LogArgs): void => {
        if (import.meta.env.DEV) {
            console.info(...withPrefix(args));
        }
    },
    debug: (...args: LogArgs): void => {
        if (import.meta.env.DEV) {
            console.debug(...withPrefix(args));
        }
    },
};
