// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// requestUrl-backed HttpSender for @curtisai/core's MCP Streamable HTTP
// transport. Buffering: awaits the full body. Contract (see the package's
// HttpSender): resolves with the complete response for ANY HTTP status —
// reject only on network-level failure; header keys lowercased.

import { requestUrl } from 'obsidian';
import type { HttpSendRequest, HttpSendResponse } from '@curtisai/core';

export async function obsidianHttpSender(req: HttpSendRequest): Promise<HttpSendResponse> {
	const resp = await requestUrl({
		url: req.url,
		method: req.method,
		headers: req.headers,
		body: req.body,
		throw: false,
	});
	const headers: Record<string, string> = {};
	for (const [k, v] of Object.entries(resp.headers ?? {})) {
		headers[k.toLowerCase()] = v;
	}
	return { status: resp.status, headers, text: resp.text };
}
