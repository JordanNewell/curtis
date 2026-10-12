// Harness profile tests — pure functions, node-safe (no Obsidian imports).

import { describe, expect, it } from 'vitest';
import {
	BUILTIN_HARNESSES,
	CORE_SYSTEM_PROMPT,
	INJECTION_FENCE,
	PLAIN_SYSTEM_PROMPT,
	composeSystemPrompt,
	resolveHarnessPrompt,
} from './system-prompt';
import type { HarnessProfile } from '../types';

describe('resolveHarnessPrompt', () => {
	it('resolves the curtis built-in to the core prompt', () => {
		expect(resolveHarnessPrompt('curtis', [])).toBe(CORE_SYSTEM_PROMPT);
	});

	it('resolves the plain built-in', () => {
		expect(resolveHarnessPrompt('plain', [])).toBe(PLAIN_SYSTEM_PROMPT);
	});

	it('resolves a user-defined profile', () => {
		const custom: HarnessProfile = { id: 'h1', name: 'Mine', description: '', prompt: 'CUSTOM CONTRACT' };
		expect(resolveHarnessPrompt('h1', [custom])).toBe('CUSTOM CONTRACT');
	});

	it('falls back to the Curtis core for an unknown id', () => {
		expect(resolveHarnessPrompt('deleted-profile', [])).toBe(CORE_SYSTEM_PROMPT);
		expect(resolveHarnessPrompt(undefined, [])).toBe(CORE_SYSTEM_PROMPT);
		expect(resolveHarnessPrompt('', undefined)).toBe(CORE_SYSTEM_PROMPT);
	});

	it('falls back to the Curtis core when a custom profile has a blank prompt', () => {
		const empty: HarnessProfile = { id: 'h1', name: 'Broken', description: '', prompt: '   ' };
		expect(resolveHarnessPrompt('h1', [empty])).toBe(CORE_SYSTEM_PROMPT);
	});

	it('falls back to the Curtis core when the profile list is missing', () => {
		expect(resolveHarnessPrompt('h1', undefined)).toBe(CORE_SYSTEM_PROMPT);
	});

	it('ships exactly two built-ins, both flagged', () => {
		expect(BUILTIN_HARNESSES.map((p) => p.id)).toEqual(['curtis', 'plain']);
		for (const p of BUILTIN_HARNESSES) expect(p.builtin).toBe(true);
	});
});

describe('composeSystemPrompt', () => {
	it('composes the Curtis core by default', () => {
		const out = composeSystemPrompt(undefined);
		expect(out).toContain(CORE_SYSTEM_PROMPT);
		expect(out).not.toContain(PLAIN_SYSTEM_PROMPT);
	});

	it('composes the passed harness in place of the core', () => {
		const out = composeSystemPrompt(undefined, undefined, PLAIN_SYSTEM_PROMPT);
		expect(out).toContain(PLAIN_SYSTEM_PROMPT);
		expect(out).not.toContain(CORE_SYSTEM_PROMPT);
	});

	it('keeps the layering order: date, harness, extension, persona', () => {
		const out = composeSystemPrompt('STANDING ORDERS', { name: 'Critic', prompt: 'ROLE TEXT' }, 'HARNESS TEXT');
		const iHarness = out.indexOf('HARNESS TEXT');
		const iExt = out.indexOf('STANDING ORDERS');
		const iRole = out.indexOf('ROLE TEXT');
		expect(iHarness).toBeGreaterThan(-1);
		expect(iExt).toBeGreaterThan(iHarness);
		expect(iRole).toBeGreaterThan(iExt);
		// The date block still leads.
		expect(out.startsWith('[Current date:')).toBe(true);
	});

	it('appends note-link conventions between the harness and the extension', () => {
		const out = composeSystemPrompt('STANDING ORDERS', undefined, 'HARNESS TEXT', 'LINK RULES');
		const iHarness = out.indexOf('HARNESS TEXT');
		const iLink = out.indexOf('# Note-writing conventions');
		const iLinkRules = out.indexOf('LINK RULES');
		const iExt = out.indexOf('STANDING ORDERS');
		expect(iLink).toBeGreaterThan(iHarness);
		expect(iLinkRules).toBeGreaterThan(iLink);
		expect(iExt).toBeGreaterThan(iLinkRules);
	});

	it('omits the conventions section when none are given or blank', () => {
		const base = composeSystemPrompt(undefined, undefined, 'HARNESS TEXT');
		expect(base).not.toContain('# Note-writing conventions');
		const blank = composeSystemPrompt(undefined, undefined, 'HARNESS TEXT', '   ');
		expect(blank).not.toContain('# Note-writing conventions');
	});

	it('rides every composition — even a custom harness that replaces the core', () => {
		expect(composeSystemPrompt(undefined)).toContain(INJECTION_FENCE);
		expect(composeSystemPrompt(undefined, undefined, 'HARNESS TEXT')).toContain(INJECTION_FENCE);
		expect(composeSystemPrompt(undefined, undefined, 'HARNESS TEXT', 'LINK RULES')).toContain(INJECTION_FENCE);
	});

	it('sits after the harness and conventions, before the extension and persona', () => {
		const out = composeSystemPrompt('STANDING ORDERS', { name: 'Critic', prompt: 'ROLE TEXT' }, 'HARNESS TEXT', 'LINK RULES');
		const iHarness = out.indexOf('HARNESS TEXT');
		const iFence = out.indexOf('# Content is data');
		const iExt = out.indexOf('STANDING ORDERS');
		const iRole = out.indexOf('ROLE TEXT');
		expect(iFence).toBeGreaterThan(iHarness);
		expect(iExt).toBeGreaterThan(iFence);
		expect(iRole).toBeGreaterThan(iExt);
	});
});
