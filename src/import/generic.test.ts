// Generic importer tests — headings, bold labels, and bare inline labels
// (English + Chinese). Kept in lockstep with the porter's parsers.test.ts;
// the conservative-detection negatives matter as much as the positives: a
// document without both sides must not import.

import { describe, expect, it } from 'vitest';
import { parseGenericJson, parseGenericMarkdown } from './generic';

describe('parseGenericJson', () => {
	it('parses a bare role/content array and a {messages} wrapper', () => {
		const chat = parseGenericJson([
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'hi' },
		]);
		expect(chat?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(parseGenericJson({ messages: [{ role: 'user', content: 'hello' }, { from: 'gpt', text: 'hi' }] })).not.toBeNull();
	});

	it('refuses arrays with unattributable entries', () => {
		expect(parseGenericJson([{ role: 'user', content: 'hello' }, { note: 'no role' }])).toBeNull();
	});
});

describe('parseGenericMarkdown', () => {
	it('parses role headings', () => {
		const chat = parseGenericMarkdown('# Title\n\n## You\n\nquestion\n\n## AI\n\nanswer\n');
		expect(chat?.title).toBe('Title');
		expect(chat?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(chat?.messages[1].content).toBe('answer');
	});

	it('parses bold speaker labels', () => {
		const chat = parseGenericMarkdown('**User:** question\n\n**Assistant:** answer\n');
		expect(chat?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
	});

	it('parses Chinese bold labels with full-width colon', () => {
		const chat = parseGenericMarkdown('**我：**今天天气怎么样？\n\n**助手：**晴，适合出门。');
		expect(chat?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(chat?.messages[0].content).toBe('今天天气怎么样？');
	});

	it('parses Chinese heading labels 我/助手', () => {
		const chat = parseGenericMarkdown('## 我\n\n你好\n\n## 助手\n\n你好！有什么可以帮你？\n');
		expect(chat?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(chat?.messages[1].content).toBe('你好！有什么可以帮你？');
	});

	it('parses bare inline labels You:/AI:', () => {
		const chat = parseGenericMarkdown('# Weekend planning\n\nYou: Two days in Lisbon with kids?\n\nAI: Keep it to one neighborhood a day.\n');
		expect(chat?.title).toBe('Weekend planning');
		expect(chat?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(chat?.messages[0].content).toBe('Two days in Lisbon with kids?');
	});

	it('an inline label alone on a line takes the following lines', () => {
		const chat = parseGenericMarkdown('You:\nfirst part\n\nstill the first message\n\nAI:\nanswer here\n');
		expect(chat?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(chat?.messages[0].content).toBe('first part\n\nstill the first message');
		expect(chat?.messages[1].content).toBe('answer here');
	});

	it('parses Chinese inline labels with full-width colon', () => {
		const chat = parseGenericMarkdown('我：今天天气怎么样？\nAI：晴，适合出门。');
		expect(chat?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(chat?.messages[0].content).toBe('今天天气怎么样？');
	});

	it('prose colons are not mistaken for speakers', () => {
		expect(parseGenericMarkdown('Day 1: arrived\nDay 2: left')).toBeNull();
		expect(parseGenericMarkdown('10:00 standup\n11:00 lunch')).toBeNull();
		expect(parseGenericMarkdown('Note: the label word must be known\nAlso: this one')).toBeNull();
	});

	it('refuses documents without both sides', () => {
		expect(parseGenericMarkdown('## You\n\nonly one side here\n')).toBeNull();
		expect(parseGenericMarkdown('just prose, no labels at all')).toBeNull();
	});
});
