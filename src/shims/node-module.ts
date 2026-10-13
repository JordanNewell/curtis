// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Build-time shim for `node:module`, aliased by esbuild.config.mjs.
//
// @curtis/llms does a top-level `import { createRequire } from "node:module"`
// for its streaming-transport probe. Left external, that becomes a bare
// `require("node:module")` in the bundled main.js — a load-time crash on
// mobile (and anywhere `require` isn't the Node loader). The shim keeps the
// import lazy: the probe resolves builtins through Electron's
// `window.require`, exactly the way the in-tree transport did before the
// package extraction. The returned loader returns undefined when
// window.require is unavailable, and the package treats that as "no Node
// here" and falls back to fetch / the buffered port.

export function createRequire(_from: unknown): (id: string) => unknown {
	const req = (window as unknown as { require?: (id: string) => unknown }).require;
	return (id: string) => {
		try {
			return req?.(id);
		} catch {
			return undefined;
		}
	};
}
