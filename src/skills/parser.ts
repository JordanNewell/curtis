// Agent Skills parsing — the open Agent Skills standard (agentskills.io).
//
// A skill is a folder under <skillsFolder>/ containing a SKILL.md: YAML
// frontmatter (name, description, optional license/compatibility/metadata/
// allowed-tools) + a markdown body of instructions. Folders may also bundle
// scripts/, references/, and assets/ — plain vault files the agent reads on
// demand with the ordinary note tools.
//
// The format is shared with Cursor, Claude Code, Copilot, Gemini CLI, and
// every other spec-compatible agent, so skills are portable in both
// directions. Curtis-specific behavior (enabled, inject mode) lives in
// settings overrides, never in the file — a SKILL.md stays 100% spec.
//
// Unknown frontmatter fields are tolerated and dropped, never rejected:
// forward compatibility with future spec revisions beats strictness. Pure
// functions, Obsidian-free (same boundary as pcp/autocomplete), so this runs
// under node; the YAML parse fn is injected by the host.

import type { Skill } from '../types';

/** YAML frontmatter parser — the Obsidian host passes parseYaml; node hosts
 *  (tests, external tooling) pass js-yaml's load or a fake. */
export type YamlParseFn = (text: string) => unknown;

export type SkillParseResult =
	| { ok: true; skill: Skill }
	| { ok: false; error: string };

/** Spec: 1–64 chars, lowercase a–z/0–9 and single hyphens, no leading,
 *  trailing, or consecutive hyphens. The regex alone enforces shape; the
 *  64-char bound is checked separately for a clearer error. */
export const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;
export const SKILL_COMPATIBILITY_MAX = 500;

/**
 * Parse one SKILL.md. `folderName` is the skill folder's name — per spec the
 * frontmatter `name` must match it, and the folder name is the skill id
 * everywhere else (overrides, /skill, api.skills), so a mismatch is an
 * error, not a rename.
 */
export function parseSkillMarkdown(
	folderName: string,
	raw: string,
	yamlParse: YamlParseFn,
	paths: { path: string; folderPath: string }
): SkillParseResult {
	const fail = (error: string): SkillParseResult => ({ ok: false, error });

	const fm = extractFrontmatter(raw);
	if (!fm) return fail('missing YAML frontmatter (file must open with a --- block)');

	let data: unknown;
	try {
		data = yamlParse(fm);
	} catch (e) {
		return fail(`frontmatter is not valid YAML: ${(e as Error).message}`);
	}
	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		return fail('frontmatter must be a YAML mapping of fields');
	}
	const fields = data as Record<string, unknown>;

	const name = fields['name'];
	if (typeof name !== 'string' || !name.trim()) return fail('required field "name" is missing or not a string');
	if (name.length > SKILL_NAME_MAX)
		return fail(`"name" exceeds ${SKILL_NAME_MAX} characters (${name.length})`);
	if (!SKILL_NAME_RE.test(name)) {
		return fail(`"name" ("${name}") must be lowercase letters, digits, and single hyphens, not starting/ending with a hyphen`);
	}
	if (name !== folderName) {
		return fail(`"name" (${name}) must match the skill folder name (${folderName})`);
	}

	const description = fields['description'];
	if (typeof description !== 'string' || !description.trim())
		return fail('required field "description" is missing or not a string');
	if (description.length > SKILL_DESCRIPTION_MAX) {
		return fail(`"description" exceeds ${SKILL_DESCRIPTION_MAX} characters (${description.length})`);
	}

	const licenseRaw = fields['license'];
	if (licenseRaw !== undefined && typeof licenseRaw !== 'string') {
		return fail('"license" must be a string');
	}
	const compatRaw = fields['compatibility'];
	if (compatRaw !== undefined && typeof compatRaw !== 'string') {
		return fail('"compatibility" must be a string');
	}
	if (compatRaw !== undefined && compatRaw.length > SKILL_COMPATIBILITY_MAX) {
		return fail(`"compatibility" exceeds ${SKILL_COMPATIBILITY_MAX} characters`);
	}

	const metadataRaw = fields['metadata'];
	let metadata: Record<string, string> | undefined;
	if (metadataRaw !== undefined) {
		if (typeof metadataRaw !== 'object' || metadataRaw === null || Array.isArray(metadataRaw)) {
			return fail('"metadata" must be a mapping of string keys to string values');
		}
		// Tolerant coercion: scalars become strings; everything else (nested
		// structures, symbols) is dropped rather than rejected — the spec's
		// map is string→string.
		metadata = {};
		for (const [k, v] of Object.entries(metadataRaw as Record<string, unknown>)) {
			if (typeof v === 'string') metadata[k] = v;
			else if (typeof v === 'number' || typeof v === 'boolean') metadata[k] = String(v);
		}
	}

	// Unknown fields (including the experimental spec field `allowed-tools`,
	// which Curtis does not act on) are tolerated and dropped.

	const body = stripFrontmatter(raw).trim();
	if (!body) return fail('markdown body is empty — a skill needs instructions');

	const skill: Skill = {
		name,
		description: description.trim(),
		body,
		path: paths.path,
		folderPath: paths.folderPath,
	};
	if (typeof licenseRaw === 'string' && licenseRaw.trim()) skill.license = licenseRaw.trim();
	if (typeof compatRaw === 'string' && compatRaw.trim()) skill.compatibility = compatRaw.trim();
	if (metadata && Object.keys(metadata).length > 0) skill.metadata = metadata;
	return { ok: true, skill };
}

/** Pull the raw YAML text between the opening and closing `---` fences.
 *  Returns null when the file doesn't open with a frontmatter block. */
function extractFrontmatter(raw: string): string | null {
	if (!raw.startsWith('---')) return null;
	const afterOpen = raw.slice(3);
	// The opening fence may be followed immediately by a newline; anything
	// else on that line (e.g. "----") is not a frontmatter fence.
	if (!/^(\r?\n)/.test(afterOpen)) return null;
	const close = afterOpen.search(/^---\s*(\r?\n|$)/m);
	if (close === -1) return null;
	return afterOpen.slice(0, close);
}

/** The markdown body — everything after the closing fence. */
function stripFrontmatter(raw: string): string {
	const fm = extractFrontmatter(raw);
	if (fm === null) return raw;
	// fm starts with the newline that ends the opening fence, so raw at
	// 3 + fm.length is the closing fence line itself — strip it.
	const rest = raw.slice(3 + fm.length);
	const close = rest.search(/^---\s*(\r?\n|$)/m);
	if (close === -1) return '';
	return rest.slice(close).replace(/^---\s*(\r?\n|$)/, '');
}

/**
 * The discovery block — stage 1 of the spec's progressive disclosure. Lists
 * name + description for each skill the model hasn't been given yet (~100
 * tokens per skill), with activation guidance that works with or without a
 * tool loop. `skills` should already be filtered to enabled, unattached
 * ones; the caller decides scope.
 */
export function formatSkillsIndexBlock(skills: Skill[], skillsFolder: string): string {
	if (skills.length === 0) return '';
	const lines = [
		'# Skills available',
		'',
		'Skills are reusable instruction packages from the user\'s vault. When a task matches one below, load it before proceeding.',
		'',
		...skills.map((s) => `- **${s.name}** — ${s.description}`),
		'',
		`Load a skill with the \`load_skill\` tool when it is in your tool list; otherwise ask the user to attach it with \`/skill <name>\`. Bundled skill files live under \`${skillsFolder}/<name>/\` in the vault — read them with \`read_note\` when a skill references them.`,
	];
	return lines.join('\n');
}

/**
 * The activation block — stage 2. The full SKILL.md body, framed so the
 * model knows its provenance and where bundled files live. Used for
 * always-mode skills, /skill attachments, agent pins, and API
 * pre-activation alike.
 */
export function formatSkillBodyBlock(skill: Skill): string {
	const bundled = `\n\n*Bundled files for this skill live at \`${skill.folderPath}/\` — read them with \`read_note\` when the instructions reference them.*`;
	return `# Skill: ${skill.name}\n\n${skill.description}\n\n---\n\n${skill.body}${bundled}`;
}
