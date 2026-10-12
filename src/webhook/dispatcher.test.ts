// Dispatcher tests — node-only (the module is deliberately Obsidian-free;
// transport and audit recorder are injected). The invariants that matter:
// audit receipts match curtis-ai-audit's validation rules, the webhook fires
// only when enabled + the event toggle is on, and nothing ever throws into
// the caller.

import { describe, expect, it, vi } from 'vitest';
import {
	buildEventPayload,
	buildReceiptPayload,
	WebhookDispatcher,
	type AuditRecorder,
	type WebhookConfig,
	type WebhookTransport,
} from './dispatcher';

const ACTION_RE = /^[a-z0-9][a-z0-9._-]{0,64}$/;

function makeDispatcher(overrides?: {
	config?: Partial<WebhookConfig>;
	audit?: AuditRecorder | null;
}) {
	const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
	const transport: WebhookTransport = {
		post: async (url, headers, body) => {
			posts.push({ url, headers, body });
			return { status: 200, text: '' };
		},
	};
	const audit = overrides?.audit === undefined ? null : overrides.audit;
	const dispatcher = new WebhookDispatcher({
		getConfig: () => ({
			enabled: true,
			url: 'https://example.test/hook',
			secret: '',
			onChatCompletion: true,
			onScheduledRun: true,
			...overrides?.config,
		}),
		transport,
		getAuditRecorder: () => audit,
	});
	return { dispatcher, posts };
}

describe('buildEventPayload', () => {
	it('maps a chat event into the versioned wire shape', () => {
		const payload = buildEventPayload('chat.completion', {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			durationMs: 1234.6,
			status: 'ok',
			tokens: { input: 10, output: 20 },
			cost: 0.001,
			conversationId: 'conv_1',
			agentName: 'Researcher',
		});
		expect(payload.schema).toBe('curtis.chat.event/v1');
		expect(payload.event).toBe('chat.completion');
		expect(payload.status).toBe('ok');
		expect(payload.durationMs).toBe(1235); // rounded, non-negative
		expect(payload.tokens).toEqual({ input: 10, output: 20 });
		expect(payload.provider).toBe('anthropic');
		expect(payload.detail).toMatchObject({ conversationId: 'conv_1', agentName: 'Researcher' });
		// JSON-serializable (audit canonicalJson requirement).
		expect(() => JSON.stringify(payload)).not.toThrow();
	});

	it('carries job identity in detail for scheduled runs', () => {
		const payload = buildEventPayload('scheduled.run', {
			jobName: 'morning brief',
			jobId: 'job_1',
			trigger: 'schedule',
			durationMs: 500,
			status: 'error',
			error: 'boom',
			subject: 'AI/Scheduled/brief.md',
		});
		expect(payload.detail).toMatchObject({
			jobName: 'morning brief',
			jobId: 'job_1',
			trigger: 'schedule',
			subject: 'AI/Scheduled/brief.md',
			error: 'boom',
		});
		expect(payload.provider).toBeUndefined();
	});
});

describe('buildReceiptPayload', () => {
	it('produces a payload that passes curtis-ai-audit validation rules', () => {
		const evt = {
			provider: 'openai',
			model: 'gpt-4o',
			durationMs: 100,
			status: 'ok' as const,
			tokens: { input: 5, output: 6 },
			conversationId: 'c1',
		};
		const receipt = buildReceiptPayload('chat.completion', evt, buildEventPayload('chat.completion', evt));
		expect(receipt.agent).toBe('curtis-ai-chat');
		expect(ACTION_RE.test(String(receipt.action))).toBe(true);
		expect(['ok', 'error', 'aborted']).toContain(receipt.status);
		expect(Number.isFinite(receipt.durationMs as number)).toBe(true);
		expect((receipt.tokens as { input: number }).input).toBeGreaterThanOrEqual(0);
		expect(Number.isNaN(Date.parse(String(receipt.ts)))).toBe(false);
		expect(receipt.subject).toBe('conversation:c1');
		expect(receipt.detail).toBeDefined();
		// No ledger-assigned fields — those belong to the audit plugin.
		expect(receipt).not.toHaveProperty('schema');
		expect(receipt).not.toHaveProperty('id');
		expect(receipt).not.toHaveProperty('seq');
		expect(receipt).not.toHaveProperty('recorded');
	});
});

describe('WebhookDispatcher', () => {
	it('skips the webhook when disabled or URL empty', () => {
		for (const config of [{ enabled: false }, { url: '   ' }]) {
			const { dispatcher, posts } = makeDispatcher({ config });
			dispatcher.chatFinished({
				provider: 'p', model: 'm', durationMs: 1, status: 'ok',
			});
			expect(posts).toHaveLength(0);
		}
	});

	it('honors the per-event toggles', () => {
		const { dispatcher, posts } = makeDispatcher({ config: { onChatCompletion: false } });
		dispatcher.chatFinished({ provider: 'p', model: 'm', durationMs: 1, status: 'ok' });
		expect(posts).toHaveLength(0);
		dispatcher.scheduledRunFinished({
			jobName: 'j', jobId: 'id', trigger: 'schedule', durationMs: 1, status: 'ok',
		});
		expect(posts).toHaveLength(1);
	});

	it('POSTs JSON with the secret header only when set', () => {
		const { dispatcher, posts } = makeDispatcher({ config: { secret: 's3cret' } });
		dispatcher.chatFinished({ provider: 'p', model: 'm', durationMs: 1, status: 'ok' });
		expect(posts[0].headers['X-Curtis-Secret']).toBe('s3cret');
		expect(posts[0].headers['Content-Type']).toBe('application/json');
		const parsed = JSON.parse(posts[0].body) as { event: string };
		expect(parsed.event).toBe('chat.completion');
	});

	it('records an audit receipt when the audit plugin is present', () => {
		const calls: Record<string, unknown>[] = [];
		const { dispatcher } = makeDispatcher({
			audit: { record: (payload) => { calls.push(payload); return undefined; } },
			config: { enabled: false },
		});
		dispatcher.chatFinished({ provider: 'p', model: 'm', durationMs: 1, status: 'ok' });
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ agent: 'curtis-ai-chat', action: 'chat.completion' });
	});

	it('never throws into the caller — transport and audit failures are logged', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const failing = new WebhookDispatcher({
				getConfig: () => ({
					enabled: true, url: 'https://x.test', secret: '',
					onChatCompletion: true, onScheduledRun: true,
				}),
				transport: {
					post: async () => {
						throw new Error('network down');
					},
				},
				getAuditRecorder: () => ({
					record: () => {
						throw new Error('audit broken');
					},
				}),
			});
			expect(() =>
				failing.chatFinished({ provider: 'p', model: 'm', durationMs: 1, status: 'ok' })
			).not.toThrow();
			// The transport rejection lands on a later microtask — both the sync
			// throw (audit) and the async rejection must be contained + logged.
			await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
		} finally {
			errorSpy.mockRestore();
		}
	});
});
