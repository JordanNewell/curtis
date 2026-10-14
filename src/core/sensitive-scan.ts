// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Sensitive-content scan — pure pattern + triage logic behind the
// scan_sensitive tool. Deliberately Obsidian-free so vitest exercises it
// under node (same split as ./tool-schema).
//
// Two categories:
//   credentials   — secret-shaped content (passwords, API keys, tokens).
//                   Matches are reported by file/line/pattern ONLY — the
//                   matched value is never echoed back into chat.
//   confidential  — files whose NAME or content signals confidentiality.
//                   Filename triage runs first (cheap, catches a note titled
//                   "DO NOT SHARE client personal note" without reading a
//                   byte); content markers second, capped like search_notes.
//
// Output safety: confidential results are summary-first (counts, groups,
// top-level folders). Listing confidential FILENAMES into chat can itself be
// the leak (screen share); per-file names require an explicit reveal.

export type SensitiveCategory = 'credentials' | 'confidential';

export interface SensitiveHit {
	/** Vault path of the flagged file. */
	path: string;
	category: SensitiveCategory;
	/** Short label — credential pattern name or confidentiality group. */
	kind: string;
	/** 1-based line number for content hits; undefined for filename triage. */
	line?: number;
}

// ---------------------------------------------------------------------------
// Credentials — secret-shaped content patterns (category: credentials)
// ---------------------------------------------------------------------------

export interface PatternRule {
	name: string;
	re: RegExp;
}

/** Value shapes the agent's ad-hoc sweeps have historically looked for. The
 *  matched TEXT is never reported — only file, line, and pattern name. */
export const CREDENTIAL_PATTERNS: PatternRule[] = [
	{ name: 'password', re: /(?<![A-Za-z])(?:password|passwd|pwd)\s*[:=]\s*['"]?\S{4,}/i },
	// (?<![A-Za-z]) not \b — "stripe_api_key" is one \w run, so \b never fires
	// before the "api"; we only need to rule out a letter right before it.
	{ name: 'api_key', re: /(?<![A-Za-z])api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_-]{8,}/i },
	{ name: 'sk-', re: /\bsk-[A-Za-z0-9]{16,}\b/ },
	{ name: 'AKIA', re: /\bAKIA[0-9A-Z]{16}\b/ },
	{ name: 'ghp_', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
	{ name: 'xox', re: /\bxox[aerzb]-[A-Za-z0-9-]{10,}\b/ },
	{ name: 'private_key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
	{ name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/ },
];

/** Credential hits in one file's content — one hit per line per pattern. */
export function scanContentCredentials(path: string, content: string): SensitiveHit[] {
	const hits: SensitiveHit[] = [];
	const lines = content.split('\n');
	for (const rule of CREDENTIAL_PATTERNS) {
		for (let i = 0; i < lines.length; i++) {
			if (rule.re.test(lines[i])) {
				hits.push({ path, category: 'credentials', kind: rule.name, line: i + 1 });
			}
		}
	}
	return hits;
}

// ---------------------------------------------------------------------------
// Confidential — filename triage first, content markers second
// ---------------------------------------------------------------------------

/** Triage groups, in priority order — first match classifies the file. */
export const CONFIDENTIAL_NAME_RULES: PatternRule[] = [
	{ name: 'encrypted', re: /\.mdenc$/i },
	{ name: 'explicit', re: /do[ _-]?not[ _-]?share|don'?t[ _-]?share|internal[ _-]?only|confidential|proprietary|restricted/i },
	{ name: 'client', re: /\bclients?\b|\bcustomers?\b/i },
	{ name: 'legal', re: /attorney|lawyer|litigation|lawsuit|settlement|\bnda\b|work[ _-]?product|privileged|\blegal\b|counsel/i },
	{ name: 'health', re: /\bphi\b|medical|health|patient|diagnos|hipaa|clinic/i },
	{ name: 'financial', re: /\bfinanc|\bbank|\btax(?:es)?\b|\binvoice|payroll|salary|\bssn\b|net[ _-]?worth/i },
	{ name: 'personal', re: /\bpersonals?\b|\bprivate\b/i },
];

export interface TriageResult {
	group: string;
}

/** Classify one vault path by name. Null when the name carries no marker. */
export function triageFilename(path: string): TriageResult | null {
	for (const rule of CONFIDENTIAL_NAME_RULES) {
		if (rule.re.test(path)) return { group: rule.name };
	}
	return null;
}

/** In-body markers — second pass for files whose names triaged clean. */
export const CONTENT_MARKER_RULES: PatternRule[] = [
	{ name: 'explicit', re: /\bdo not share\b|\bdo not (?:distribute|disclose)\b|\bconfidential\b/i },
	{ name: 'legal', re: /attorney[- ]client privileged|work product|privileged and confidential/i },
];

/** Marker hits in one file's content (first marker per line wins). */
export function scanContentMarkers(path: string, content: string): SensitiveHit[] {
	const hits: SensitiveHit[] = [];
	for (const rule of CONTENT_MARKER_RULES) {
		const lines = content.split('\n');
		for (let i = 0; i < lines.length; i++) {
			if (rule.re.test(lines[i])) {
				hits.push({ path, category: 'confidential', kind: rule.name, line: i + 1 });
				break;
			}
		}
	}
	return hits;
}

// ---------------------------------------------------------------------------
// Formatting — credentials are per-file (names alone aren't the secret);
// confidential is summary-first unless explicitly revealed.
// ---------------------------------------------------------------------------

/**
 * Format credential hits. Reports file:line + pattern name — never the
 * matched value, so echoing the report into chat can't leak the secret.
 */
export function formatCredentialHits(hits: SensitiveHit[], max: number): string {
	if (hits.length === 0) return 'No credential-pattern matches found.';
	const shown = hits.slice(0, max);
	const lines = shown.map((h) => `- ${h.path}${h.line ? `:${h.line}` : ''} — ${h.kind}`);
	const capNote = hits.length > max ? `\n(+${hits.length - max} more — narrow with folder or raise max_results)` : '';
	return `Credential-pattern matches: ${hits.length} (values withheld — only locations reported):\n${lines.join('\n')}${capNote}`;
}

/**
 * Format confidentiality hits. Summary-first by default: counts per group +
 * top-level folders. Filenames are withheld unless revealNames — listing
 * confidential titles into chat can itself leak on a shared screen.
 */
export function formatConfidentialHits(hits: SensitiveHit[], revealNames: boolean, max: number): string {
	if (hits.length === 0) {
		return 'No confidentiality markers found (filenames triaged clean; capped content marker pass found nothing).';
	}

	const byGroup = new Map<string, number>();
	const byFolder = new Map<string, number>();
	for (const h of hits) {
		byGroup.set(h.kind, (byGroup.get(h.kind) || 0) + 1);
		const top = h.path.includes('/') ? h.path.slice(0, h.path.indexOf('/')) : '(vault root)';
		byFolder.set(top, (byFolder.get(top) || 0) + 1);
	}
	const groups = [...byGroup.entries()].sort((a, b) => b[1] - a[1]).map(([g, n]) => `- ${g}: ${n}`);
	const folders = [...byFolder.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, n]) => `- ${f} (${n})`);

	const summary = `Confidentiality triage: ${hits.length} file(s) flagged.\nBy category:\n${groups.join('\n')}\nTop folders:\n${folders.join('\n')}`;

	if (!revealNames) {
		return (
			summary +
			'\n\nFilenames withheld — listing confidential titles into chat can itself be a leak (e.g. screen share). ' +
			'Re-run with reveal_names=true to list them.'
		);
	}

	const shown = hits.slice(0, max);
	const capNote = hits.length > max ? `\n(+${hits.length - max} more)` : '';
	return `${summary}\n\nFlagged files:\n${shown.map((h) => `- ${h.path} [${h.kind}]`).join('\n')}${capNote}`;
}
