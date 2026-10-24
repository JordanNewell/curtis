// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// ObsidianHttpAdapter — bridges the @curtisai/llms HttpPort to Obsidian's
// requestUrl. Buffered-only (the port's contract): SSE streaming bypasses
// this adapter via the node-https / fetch transports in the package.
//
// requestUrl is CORS-immune, which is why the plugin prefers it over raw
// fetch for buffered calls (model discovery, plan usage, MCP fallbacks).
// `throw: false` makes requestUrl resolve for ANY HTTP status — the port's
// error policy is "report the status, never reject for 4xx/5xx".

import { requestUrl } from 'obsidian';
import type { HttpPort, HttpRequest, HttpResponse } from '@curtisai/llms';

export class ObsidianHttpAdapter implements HttpPort {
	async request(req: HttpRequest): Promise<HttpResponse> {
		const resp = await requestUrl({
			url: req.url,
			method: req.method,
			headers: req.headers,
			body: req.body,
			throw: false,
		});
		const arrayBuffer = resp.arrayBuffer;
		return {
			status: resp.status,
			text: resp.text,
			arrayBuffer: async () => arrayBuffer,
			json: async <T = unknown>() => resp.json as T,
		};
	}
}
