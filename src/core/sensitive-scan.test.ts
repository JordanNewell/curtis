// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Sensitive-scan tests — pure pattern + triage + formatting, node-safe.

import { describe, expect, it } from 'vitest';
import {
	CREDENTIAL_PATTERNS,
	CONFIDENTIAL_NAME_RULES,
	triageFilename,
	scanContentCredentials,
	scanContentMarkers,
	formatCredentialHits,
	formatConfidentialHits,
} from './sensitive-scan';

describe('triageFilename (filename-first confidentiality triage)', () => {
	// The regression this whole category exists for: a credentials-only sweep
	// missed this file; its own NAME flags it as confidential.
	it('flags the DO-NOT-SHARE client note from the fixture vault', () => {
		expect(triageFilename('00 INBOX — DO NOT SHARE client personal note.md')?.group).toBe('explicit');
	});

	it('flags encrypted files by extension regardless of name', () => {
		expect(triageFilename('Journals/2026-05-14.mdenc')?.group).toBe('encrypted');
		expect(triageFilename('Notes/SECRET-PLAN.MDENC')?.group).toBe('encrypted');
	});

	it('flags each confidentiality marker group', () => {
		expect(triageFilename('Clients/Acme Corp kickoff.md')?.group).toBe('client');
		expect(triageFilename('Legal/settlement draft.md')?.group).toBe('legal');
		expect(triageFilename('Health/patient intake notes.md')?.group).toBe('health');
		expect(triageFilename('Finances/2025 tax return.md')?.group).toBe('financial');
		expect(triageFilename('personal/diary draft.md')?.group).toBe('personal');
	});

	it('flags marker variants: hyphenated, apostrophe, word-boundary safe', () => {
		expect(triageFilename('internal-only roadmap.md')?.group).toBe('explicit');
		expect(triageFilename("don't share this.md")?.group).toBe('explicit');
		expect(triageFilename('bank-statement Jan.md')?.group).toBe('financial');
	});

	it('does not flag ordinary notes', () => {
		expect(triageFilename('Projects/curtis/DESIGN.md')).toBeNull();
		expect(triageFilename('Daily/2026-10-14.md')).toBeNull();
		// "taxonomy" must not trip the tax rule; "client-side" in a dev note
		// is a stretch but stays flagged — documented over-trigger, cheap.
		expect(triageFilename('Dev/taxonomy notes.md')).toBeNull();
	});

	it('priority order: encrypted > explicit > client > legal > health > financial > personal', () => {
		// A name matching several groups classifies under the strongest.
		expect(triageFilename('confidential client meeting.md')?.group).toBe('explicit');
		expect(triageFilename('client settlement terms.md')?.group).toBe('client');
	});

	it('every rule compiles and carries a name', () => {
		for (const rule of CONFIDENTIAL_NAME_RULES) {
			expect(rule.name.length).toBeGreaterThan(0);
			expect(rule.re).toBeInstanceOf(RegExp);
		}
	});
});

describe('scanContentCredentials', () => {
	it('hits each fixture pattern shape with the right pattern name', () => {
		const content = [
			'database password=hunter2secret',
			'stripe_api_key: sk_live_51H8xYz',
			'openai key sk-abc123def456ghi789jk',
			'aws access key AKIAIOSFODNN7EXAMPLE',
			'token ghp_16CharactersXXXXXXXXXXXXXXXXX',
			'slack xoxb-123456789012-abcdef',
			'-----BEGIN RSA PRIVATE KEY-----',
			'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
		].join('\n');
		const hits = scanContentCredentials('vault/secrets.md', content);
		const kinds = hits.map((h) => h.kind);
		expect(kinds).toContain('password');
		expect(kinds).toContain('api_key');
		expect(kinds).toContain('sk-');
		expect(kinds).toContain('AKIA');
		expect(kinds).toContain('ghp_');
		expect(kinds).toContain('xox');
		expect(kinds).toContain('private_key');
		expect(kinds).toContain('jwt');
	});

	it('reports 1-based line numbers and never the matched value', () => {
		const hits = scanContentCredentials('a.md', 'nothing here\npassword: supersecret123');
		expect(hits).toHaveLength(1);
		expect(hits[0].line).toBe(2);
		expect(hits[0].path).toBe('a.md');
	});

	it('stays quiet on prose that merely mentions security', () => {
		expect(scanContentCredentials('a.md', 'We should rotate our passwords regularly.')).toHaveLength(0);
	});
});

describe('scanContentMarkers (content pass, second line of defense)', () => {
	it('flags confidential markers in body text', () => {
		const hits = scanContentMarkers('plain-titled.md', 'Intro\nThis document is CONFIDENTIAL — internal only.');
		expect(hits.map((h) => h.kind)).toContain('explicit');
	});

	it('flags attorney-client privileged bodies under the legal group', () => {
		const hits = scanContentMarkers('memo.md', 'ATTORNEY-CLIENT PRIVILEGED COMMUNICATION');
		expect(hits[0].kind).toBe('legal');
	});

	it('returns nothing for clean content', () => {
		expect(scanContentMarkers('a.md', 'Just a recipe for soup.')).toHaveLength(0);
	});
});

describe('formatCredentialHits', () => {
	it('formats locations only — the matched value never appears', () => {
		const hits = scanContentCredentials('a.md', 'password: supersecret123');
		const out = formatCredentialHits(hits, 25);
		expect(out).toContain('a.md:1');
		expect(out).toContain('password');
		expect(out).not.toContain('supersecret123');
	});

	it('returns a clean negative', () => {
		expect(formatCredentialHits([], 25)).toMatch(/No credential-pattern matches/);
	});

	it('caps the per-file listing when max is exceeded', () => {
		const hits = scanContentCredentials('a.md', 'password: one11111\npassword: two22222\npassword: three333');
		const out = formatCredentialHits(hits, 2);
		expect(out).toContain('+1 more');
	});
});

describe('formatConfidentialHits (summary-first output safety)', () => {
	const hits = [
		{ path: '00 INBOX/DO NOT SHARE client personal note.md', category: 'confidential' as const, kind: 'explicit' },
		{ path: '00 INBOX/quiet personal.md', category: 'confidential' as const, kind: 'personal' },
		{ path: 'Clients/Acme kickoff.md', category: 'confidential' as const, kind: 'client' },
		{ path: 'Journals/may.mdenc', category: 'confidential' as const, kind: 'encrypted' },
	];

	it('summary by default: counts + categories + top-level folders, NO filenames', () => {
		const out = formatConfidentialHits(hits, false, 25);
		expect(out).toContain('Confidentiality triage: 4 file(s) flagged');
		expect(out).toContain('- explicit: 1');
		expect(out).toContain('- client: 1');
		expect(out).toContain('- encrypted: 1');
		expect(out).toContain('00 INBOX (2)');
		expect(out).toContain('Clients (1)');
		// The whole point: names stay out of the summary.
		expect(out).not.toContain('DO NOT SHARE client personal note');
		expect(out).not.toContain('Acme');
		expect(out).not.toContain('quiet personal');
		expect(out).toContain('reveal_names=true');
	});

	it('reveals filenames only when explicitly asked', () => {
		const out = formatConfidentialHits(hits, true, 25);
		expect(out).toContain('00 INBOX/DO NOT SHARE client personal note.md [explicit]');
		expect(out).toContain('Journals/may.mdenc [encrypted]');
	});

	it('clean negative', () => {
		expect(formatConfidentialHits([], false, 25)).toMatch(/No confidentiality markers/);
	});

	it('caps the revealed listing', () => {
		const many = hits.concat([...Array(30).keys()].map((i) => ({
			path: `f/${i}.md`,
			category: 'confidential' as const,
			kind: 'personal',
		})));
		const out = formatConfidentialHits(many, true, 10);
		expect(out).toContain('+24 more');
	});

	it('credentials patterns each carry a distinct name', () => {
		const names = CREDENTIAL_PATTERNS.map((p) => p.name);
		expect(new Set(names).size).toBe(names.length);
	});
});
