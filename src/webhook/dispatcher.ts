// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Outbound events — HTTP webhook + local audit receipts, one payload shape.
//
// Two independent sinks fire per event and must never break the caller
// (both hang off UI-facing finally blocks):
//   - curtis-ai-audit, when installed, via window.curtisAudit.record() —
//     this is the actual pairing with the audit plugin; it is local, not HTTP.
//   - An optional user-configured webhook URL (Settings → Outbound events),
//     POSTed as the same JSON body so a remote endpoint sees what the ledger
//     sees.
//
// Deliberately Obsidian-free: the HTTP transport and the audit recorder are
// injected, so this module runs under plain node in vitest. The plugin wires
// the real transport (requestUrl) in main.ts.

/** Event names double as audit `action` values — must match
 *  curtis-ai-audit's ACTION_RE: /^[a-z0-9][a-z0-9._-]{0,64}$/. */
export type WebhookEventType = 'chat.completion' | 'scheduled.run';

/** Audit status vocabulary (curtis-ai-audit schema.ts) — exactly these three. */
export type EventStatus = 'ok' | 'error' | 'aborted';

/** Token counts in audit receipt shape: { input, output }, non-negative. */
export interface EventTokens {
	input: number;
	output: number;
}

export interface ChatFinishedEvent {
	provider: string;
	model: string;
	/** Duration of the stream, ms — set by the caller, not derived here. */
	durationMs: number;
	status: EventStatus;
	tokens?: EventTokens;
	cost?: number;
	summary?: string;
	/** Conversation id — a stable vault-side handle, not sensitive content. */
	conversationId?: string;
	agentName?: string;
}

export interface ScheduledRunEvent {
	jobName: string;
	jobId: string;
	agentName?: string;
	trigger: 'schedule' | 'manual';
	durationMs: number;
	status: EventStatus;
	/** Path of the run note, when one was written. */
	subject?: string;
	summary?: string;
	error?: string;
}

/** The wire body — versioned once so remote consumers and any future OM-1
 *  emission agree on the shape. `ts` is ISO 8601 UTC. */
export interface WebhookEventPayload {
	schema: 'curtis.chat.event/v1';
	event: WebhookEventType;
	ts: string;
	agent: 'curtis-ai-chat';
	status: EventStatus;
	durationMs: number;
	tokens?: EventTokens;
	cost?: number;
	provider?: string;
	model?: string;
	summary?: string;
	detail?: Record<string, unknown>;
}

/** POST contract the dispatcher needs; main.ts implements it with requestUrl. */
export interface WebhookTransport {
	post(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; text: string }>;
}

/** The slice of curtis-ai-audit's window API we speak (api.ts: record). */
export interface AuditRecorder {
	record(payload: Record<string, unknown>): unknown;
}

export interface WebhookConfig {
	enabled: boolean;
	url: string;
	secret: string;
	onChatCompletion: boolean;
	onScheduledRun: boolean;
}

export interface WebhookDispatcherOptions {
	getConfig: () => WebhookConfig;
	transport: WebhookTransport;
	/** Null when the audit plugin is absent — receipts silently skip. */
	getAuditRecorder: () => AuditRecorder | null;
}

export class WebhookDispatcher {
	private opts: WebhookDispatcherOptions;

	constructor(opts: WebhookDispatcherOptions) {
		this.opts = opts;
	}

	chatFinished(evt: ChatFinishedEvent): void {
		this.emit('chat.completion', evt);
	}

	scheduledRunFinished(evt: ScheduledRunEvent): void {
		this.emit('scheduled.run', evt);
	}

	private emit(event: WebhookEventType, evt: ChatFinishedEvent | ScheduledRunEvent): void {
		const payload = buildEventPayload(event, evt);
		try {
			const audit = this.opts.getAuditRecorder();
			if (audit) {
				void Promise.resolve(audit.record(buildReceiptPayload(event, evt, payload)))
					.catch((e: unknown) => console.error(`[Curtis] Audit receipt (${event}) failed:`, e));
			}
		} catch (e) {
			console.error(`[Curtis] Audit receipt (${event}) failed:`, e);
		}

		const cfg = this.opts.getConfig();
		if (!cfg.enabled || !cfg.url.trim()) return;
		if (event === 'chat.completion' && !cfg.onChatCompletion) return;
		if (event === 'scheduled.run' && !cfg.onScheduledRun) return;
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (cfg.secret.trim()) headers['X-Curtis-Secret'] = cfg.secret.trim();
		void this.opts.transport.post(cfg.url.trim(), headers, JSON.stringify(payload)).then(
			(resp) => {
				if (resp.status < 200 || resp.status >= 300) {
					console.error(`[Curtis] Webhook (${event}) got HTTP ${resp.status}:`, resp.text.slice(0, 500));
				}
			},
			(e: unknown) => console.error(`[Curtis] Webhook (${event}) failed:`, e)
		);
	}
}

export function buildEventPayload(
	event: WebhookEventType,
	evt: ChatFinishedEvent | ScheduledRunEvent
): WebhookEventPayload {
	const payload: WebhookEventPayload = {
		schema: 'curtis.chat.event/v1',
		event,
		ts: new Date().toISOString(),
		agent: 'curtis-ai-chat',
		status: evt.status,
		durationMs: Math.max(0, Math.round(evt.durationMs)),
	};
	if ('tokens' in evt && evt.tokens) payload.tokens = evt.tokens;
	if ('provider' in evt) payload.provider = evt.provider;
	if ('model' in evt) payload.model = evt.model;
	if (evt.summary) payload.summary = evt.summary;
	if ('cost' in evt && typeof evt.cost === 'number') payload.cost = evt.cost;
	const detail: Record<string, unknown> = {};
	if ('conversationId' in evt && evt.conversationId) detail.conversationId = evt.conversationId;
	if ('agentName' in evt && evt.agentName) detail.agentName = evt.agentName;
	if ('jobName' in evt) {
		detail.jobName = evt.jobName;
		detail.jobId = evt.jobId;
		detail.trigger = evt.trigger;
		if (evt.subject) detail.subject = evt.subject;
	}
	if ('error' in evt && evt.error) detail.error = evt.error;
	if (Object.keys(detail).length > 0) payload.detail = detail;
	return payload;
}

/** curtis-ai-audit ReceiptPayload (schema.ts:55-67) minus ledger-assigned
 *  fields (schema/id/seq/recorded) — those are the ledger's to fill. */
export function buildReceiptPayload(
	event: WebhookEventType,
	evt: ChatFinishedEvent | ScheduledRunEvent,
	payload: WebhookEventPayload
): Record<string, unknown> {
	const receipt: Record<string, unknown> = {
		agent: 'curtis-ai-chat',
		action: event,
		ts: payload.ts,
		status: evt.status,
		durationMs: payload.durationMs,
	};
	if ('tokens' in evt && evt.tokens) receipt.tokens = evt.tokens;
	if ('provider' in evt) receipt.provider = evt.provider;
	if ('model' in evt) receipt.model = evt.model;
	if (evt.summary) receipt.summary = evt.summary;
	if ('conversationId' in evt && evt.conversationId) receipt.subject = `conversation:${evt.conversationId}`;
	if ('subject' in evt && evt.subject) receipt.subject = evt.subject;
	receipt.detail = payload;
	return receipt;
}
