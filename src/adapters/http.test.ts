// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// ObsidianHttpAdapter tests — requestUrl stubbed by the shared obsidian test
// stub (vitest.config.ts aliases 'obsidian' to it). Covers the port's error
// policy (4xx/5xx resolve, network failures reject) and the body mapping
// (text / json / arrayBuffer).

import { describe, expect, it } from 'vitest';
// Helpers come straight from the stub module (the vitest alias maps
// 'obsidian' to the same file — one shared module instance either way).
import { __setRequestRouter, requestsSeen, type StubResponse } from '../test/obsidian-stub';
import { ObsidianHttpAdapter } from './http';

const jsonResponse = (body: unknown, status = 200): StubResponse => ({
	status,
	text: JSON.stringify(body),
	json: body,
	arrayBuffer: new ArrayBuffer(4),
});

describe('ObsidianHttpAdapter.request', () => {
	it('forwards url, method, headers, body and throw:false', async () => {
		requestsSeen.length = 0;
		__setRequestRouter(() => jsonResponse({ ok: true }));
		await new ObsidianHttpAdapter().request({
			url: 'https://api.test/v1/x',
			method: 'POST',
			headers: { Authorization: 'Bearer k' },
			body: '{"a":1}',
		});
		expect(requestsSeen).toHaveLength(1);
		expect(requestsSeen[0]).toEqual({
			url: 'https://api.test/v1/x',
			method: 'POST',
			headers: { Authorization: 'Bearer k' },
			body: '{"a":1}',
			throw: false,
		});
	});

	it('maps status, text, json and arrayBuffer on 200', async () => {
		__setRequestRouter(() => jsonResponse({ data: [1, 2] }));
		const resp = await new ObsidianHttpAdapter().request({ url: 'https://api.test/v1/models', method: 'GET' });
		expect(resp.status).toBe(200);
		expect(resp.text).toBe('{"data":[1,2]}');
		await expect(resp.json<{ data: number[] }>()).resolves.toEqual({ data: [1, 2] });
		expect((await resp.arrayBuffer()).byteLength).toBe(4);
	});

	it('resolves (never rejects) on 4xx', async () => {
		__setRequestRouter(() => jsonResponse({ error: 'nope' }, 404));
		const resp = await new ObsidianHttpAdapter().request({ url: 'https://api.test/missing', method: 'GET' });
		expect(resp.status).toBe(404);
		await expect(resp.json<{ error: string }>()).resolves.toEqual({ error: 'nope' });
	});

	it('resolves (never rejects) on 5xx', async () => {
		__setRequestRouter(() => ({ status: 502, text: 'bad gateway' }));
		const resp = await new ObsidianHttpAdapter().request({ url: 'https://api.test/down', method: 'GET' });
		expect(resp.status).toBe(502);
		expect(resp.text).toBe('bad gateway');
	});

	it('rejects on a network failure (requestUrl throws)', async () => {
		__setRequestRouter(() => {
			throw new Error('net down');
		});
		await expect(new ObsidianHttpAdapter().request({ url: 'https://api.test/x', method: 'GET' })).rejects.toThrow('net down');
	});
});
