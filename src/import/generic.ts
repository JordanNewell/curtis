// Generic best-effort importers: plain JSON transcripts and role-headed
// markdown. These cover tools with no official export format — Copilot chat
// pastes, Gemini printouts, arbitrary {role, content} JSON. Best-effort means
// detection is conservative: if we can't confidently find both sides of a
// conversation, we say so instead of importing garbage.
//
// Kept in lockstep with curtis-ai-chat-porter src/core/generic.ts (synced
// back from the porter):
//   - Chinese speaker labels (我/用户/助手…) and full-width colons, so
//     transcripts pasted or scraped out of z.ai, Kimi, Doubao, Ernie and
//     MiniMax parse like any others.
//   - bare inline speaker labels (`You: …` / `我：…` at line start) — plain
//     pasted transcripts; headings and bold spans worked, bare prefixes
//     didn't.

import type { ParsedChat, ParsedMessage } from './types';

// ---- Generic JSON: [{role, content}, ...] or {messages: [...]} ----

const KNOWN_ROLES = new Set(['user', 'assistant', 'system', 'tool']);

function contentToText(c: unknown): string {
	if (typeof c === 'string') return c;
	if (Array.isArray(c)) {
		return c
			.map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
			.join('\n')
			.trim();
	}
	return '';
}

/** Returns null when the JSON doesn't look like a role/content transcript. */
export function parseGenericJson(data: unknown): ParsedChat | null {
	let arr: unknown;
	if (Array.isArray(data)) {
		arr = data;
	} else if (data && typeof data === 'object' && Array.isArray((data as { messages?: unknown }).messages)) {
		arr = (data as { messages: unknown[] }).messages;
	} else {
		return null;
	}

	const messages: ParsedMessage[] = [];
	for (const raw of arr as unknown[]) {
		if (!raw || typeof raw !== 'object') continue;
		const m = raw as { role?: unknown; content?: unknown; from?: unknown; text?: unknown };
		const role: ParsedMessage['role'] | undefined =
			typeof m.role === 'string' && KNOWN_ROLES.has(m.role)
				? (m.role as ParsedMessage['role'])
				: m.from === 'human' || m.from === 'user'
					? 'user'
					: m.from === 'assistant' || m.from === 'bot' || m.from === 'gpt'
						? 'assistant'
						: undefined;
		if (!role) return null; // one unattributable entry → not a transcript
		const text = (contentToText(m.content) || (typeof m.text === 'string' ? m.text : '')).trim();
		if (!text) continue;
		messages.push({ role, content: text });
	}
	if (messages.length === 0) return null;
	return { title: 'Imported chat', messages };
}

// ---- Generic markdown: role headings or bold speaker labels ----

/** Speaker labels that map to a role, matched case-insensitively at a
 *  markdown heading (`## You`), at the start of a bold span (`**User:**`),
 *  or as a bare prefix at line start (`User:` / `我：`). Chinese labels
 *  cover transcripts pasted or scraped out of z.ai, Kimi, Doubao, Ernie
 *  and MiniMax. */
const USER_LABELS = ['you', 'user', 'human', 'me', 'q', '我', '用户', '本人'];
const ASSISTANT_LABELS = ['ai', 'assistant', 'bot', 'chatgpt', 'claude', 'gemini', 'copilot', 'a', '助手', 'ai助手', '机器人'];

function labelToRole(label: string): ParsedMessage['role'] | null {
	const l = label.trim().toLowerCase().replace(/[:：\s]+$/u, '');
	if (USER_LABELS.includes(l)) return 'user';
	if (ASSISTANT_LABELS.includes(l)) return 'assistant';
	if (l === 'system' || l === '系统') return 'system';
	return null;
}

/**
 * Parse markdown where speakers are marked by headings (`#`–`####`), bold
 * prefixes (`**User:**` / `**我：**`), or bare inline prefixes (`User:` /
 * `我：` at line start). Returns null when fewer than one message per side
 * is found — ambiguous documents are not imported.
 */
export function parseGenericMarkdown(raw: string): ParsedChat | null {
	const lines = raw.split('\n');
	const messages: ParsedMessage[] = [];
	// Which label style the document uses, decided on the first confident hit.
	let style: 'heading' | 'bold' | 'inline' | null = null;
	let current: { role: ParsedMessage['role']; lines: string[] } | null = null;

	const flush = (): void => {
		if (!current) return;
		const text = current.lines.join('\n').trim();
		if (text) messages.push({ role: current.role, content: text });
		current = null;
	};

	for (const line of lines) {
		const heading = line.match(/^#{1,4}\s+(.+?)\s*$/);
		const bold = line.match(/^\*\*(.+?)[:：]?\*\*\s*(.*)$/u);
		// Bare prefix: a known label glued to a colon at line start. The colon
		// must sit directly after the label word, so prose like "Day 1: …" or
		// timestamps like "10:00 …" can't be mistaken for speakers.
		const inline = line.match(/^([^\s:：]{1,12})[:：][ \t]*(.*)$/u);
		if (style !== 'bold' && heading && labelToRole(heading[1])) {
			if (style === null) style = 'heading';
			if (style === 'heading') {
				flush();
				current = { role: labelToRole(heading[1]) as ParsedMessage['role'], lines: [] };
				continue;
			}
		}
		if (style !== 'heading' && bold && labelToRole(bold[1])) {
			if (style === null) style = 'bold';
			if (style === 'bold') {
				flush();
				current = { role: labelToRole(bold[1]) as ParsedMessage['role'], lines: [bold[2]] };
				continue;
			}
		}
		if ((style === null || style === 'inline') && inline && labelToRole(inline[1])) {
			if (style === null) style = 'inline';
			if (style === 'inline') {
				flush();
				current = { role: labelToRole(inline[1]) as ParsedMessage['role'], lines: [inline[2]] };
				continue;
			}
		}
		if (current) current.lines.push(line);
	}
	flush();

	const hasUser = messages.some((m) => m.role === 'user');
	const hasAssistant = messages.some((m) => m.role === 'assistant');
	if (!hasUser || !hasAssistant) return null;

	// Title: first H1, else first line of the first user message.
	const h1 = raw.match(/^# (.+)$/m)?.[1]?.trim();
	const firstUser = messages.find((m) => m.role === 'user');
	return {
		title: h1 || (firstUser ? firstUser.content.slice(0, 60) : 'Imported chat'),
		messages,
	};
}
