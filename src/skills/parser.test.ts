// Skills parser tests — pure functions, node-safe (no Obsidian imports).
// The YAML fn is a minimal fake covering the shapes SKILL.md frontmatter
// uses (flat scalars + one nested map), same port-injection idiom as the
// conversation-format tests.

import { describe, expect, it } from 'vitest';
import {
	formatSkillBodyBlock,
	formatSkillsIndexBlock,
	parseSkillMarkdown,
	type YamlParseFn,
} from './parser';
import type { Skill } from '../types';

/** Parses flat `key: value` lines plus one level of nested `key:` maps —
 *  enough for spec frontmatter. Throws on lines it can't shape. */
const fakeYaml: YamlParseFn = (text) => {
	const root: Record<string, unknown> = {};
	let nested: { target: Record<string, unknown> } | null = null;
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		if (/^\s+-/.test(line)) throw new Error('fake does not support lists');
		if (line.startsWith('  ') || line.startsWith('\t')) {
			if (!nested) throw new Error('indented line outside a nested map');
			const m = /^[\s\t]+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
			if (!m) throw new Error(`bad nested line: ${line}`);
			nested.target[m[1]] = coerce(m[2]);
			continue;
		}
		const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (!m) throw new Error(`bad line: ${line}`);
		if (m[2] === '') {
			nested = { target: {} };
			root[m[1]] = nested.target;
		} else {
			root[m[1]] = coerce(m[2]);
			nested = null;
		}
	}
	return root;
};

function coerce(raw: string): unknown {
	// Quoted scalars are strings in YAML — check before stripping quotes.
	if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
	const v = raw.replace(/^['"]|['"]$/g, '');
	if (v === 'true') return true;
	if (v === 'false') return false;
	return v;
}

const PATHS = { path: 'AI/Skills/test-skill/SKILL.md', folderPath: 'AI/Skills/test-skill' };

function parse(folderName: string, raw: string) {
	return parseSkillMarkdown(folderName, raw, fakeYaml, PATHS);
}

const MINIMAL = `---
name: test-skill
description: Does a thing. Use when the user asks for the thing.
---

# Instructions

Do the thing carefully.`;

describe('parseSkillMarkdown — spec validation', () => {
	it('parses a minimal valid skill', () => {
		const r = parse('test-skill', MINIMAL);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.skill.name).toBe('test-skill');
		expect(r.skill.description).toBe('Does a thing. Use when the user asks for the thing.');
		expect(r.skill.body).toContain('# Instructions');
		expect(r.skill.body).not.toContain('name:');
		expect(r.skill.body.endsWith('carefully.')).toBe(true);
	});

	it('parses CRLF files', () => {
		const r = parse('test-skill', MINIMAL.replace(/\n/g, '\r\n'));
		expect(r.ok).toBe(true);
	});

	it('keeps optional spec fields and drops unknown ones', () => {
		const raw = `---
name: test-skill
description: Does a thing.
license: Apache-2.0
compatibility: Requires nothing special
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash Read
some-future-field: whatever
---

Body.`;
		const r = parse('test-skill', raw);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.skill.license).toBe('Apache-2.0');
		expect(r.skill.compatibility).toBe('Requires nothing special');
		expect(r.skill.metadata).toEqual({ author: 'example-org', version: '1.0' });
		expect((r.skill as unknown as Record<string, unknown>)['allowed-tools']).toBeUndefined();
	});

	it('coerces scalar metadata values to strings and drops nested ones', () => {
		const raw = `---
name: test-skill
description: Does a thing.
metadata:
  count: 3
  flag: true
---

Body.`;
		const r = parse('test-skill', raw);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.skill.metadata).toEqual({ count: '3', flag: 'true' });
	});

	it('rejects name/folder mismatch', () => {
		const r = parse('other-name', MINIMAL);
		expect(!r.ok && r.error).toContain('must match the skill folder name');
	});

	it.each([
		['Test-Skill', 'uppercase'],
		['-skill', 'leading hyphen'],
		['skill-', 'trailing hyphen'],
		['te--st', 'consecutive hyphens'],
		['te st', 'space'],
		['te_st', 'underscore'],
	])('rejects invalid name %s (%s)', (name) => {
		const r = parse(name, MINIMAL.replace('name: test-skill', `name: ${name}`));
		expect(!r.ok).toBe(true);
	});

	it('rejects a name over 64 characters', () => {
		const long = 'a'.repeat(65);
		const r = parse(long, MINIMAL.replace('name: test-skill', `name: ${long}`));
		expect(!r.ok && r.error).toContain('64');
	});

	it('accepts a 64-character name', () => {
		const name = 'a'.repeat(64);
		const r = parse(name, MINIMAL.replace('name: test-skill', `name: ${name}`));
		expect(r.ok).toBe(true);
	});

	it('rejects missing or empty description', () => {
		const noDesc = parse('test-skill', MINIMAL.replace(/description: .*\n/, ''));
		expect(!noDesc.ok && noDesc.error).toContain('description');
		const empty = parse('test-skill', MINIMAL.replace('description: Does a thing. Use when the user asks for the thing.', 'description: ""'));
		expect(!empty.ok).toBe(true);
	});

	it('rejects a description over 1024 characters', () => {
		const long = `d`.repeat(1025);
		const r = parse('test-skill', MINIMAL.replace('description: Does a thing. Use when the user asks for the thing.', `description: ${long}`));
		expect(!r.ok && r.error).toContain('1024');
	});

	it('rejects missing frontmatter', () => {
		const r = parse('test-skill', 'Just markdown, no fences.');
		expect(!r.ok && r.error).toContain('frontmatter');
	});

	it('rejects an unterminated frontmatter block', () => {
		const r = parse('test-skill', '---\nname: test-skill\ndescription: x\n\nbody without close');
		expect(!r.ok).toBe(true);
	});

	it('rejects invalid YAML', () => {
		const r = parseSkillMarkdown(
			'test-skill',
			'---\nname: test-skill\n---\n\nBody.',
			() => {
				throw new Error('boom');
			},
			PATHS
		);
		expect(!r.ok && r.error).toContain('YAML');
	});

	it('rejects frontmatter that is not a mapping', () => {
		const scalar = parseSkillMarkdown('test-skill', '---\njust a string\n---\n\nBody.', () => 'string', PATHS);
		expect(!scalar.ok && scalar.error).toContain('mapping');
	});

	it('rejects an empty body', () => {
		const r = parse('test-skill', '---\nname: test-skill\ndescription: Does a thing.\n---\n');
		expect(!r.ok && r.error).toContain('empty');
	});
});

describe('formatSkillsIndexBlock', () => {
	const skill = (name: string): Skill => ({
		name,
		description: `Skill ${name} description.`,
		body: 'Body.',
		path: `AI/Skills/${name}/SKILL.md`,
		folderPath: `AI/Skills/${name}`,
	});

	it('returns empty string for no skills', () => {
		expect(formatSkillsIndexBlock([], 'AI/Skills')).toBe('');
	});

	it('lists each skill name and description with activation guidance', () => {
		const block = formatSkillsIndexBlock([skill('alpha'), skill('beta')], 'AI/Skills');
		expect(block).toContain('- **alpha** — Skill alpha description.');
		expect(block).toContain('- **beta** — Skill beta description.');
		expect(block).toContain('`load_skill`');
		expect(block).toContain('`/skill <name>`');
		expect(block).toContain('AI/Skills');
		expect(block.indexOf('alpha')).toBeLessThan(block.indexOf('beta'));
	});
});

describe('formatSkillBodyBlock', () => {
	it('frames the body with name, description, and bundled-file note', () => {
		const skill: Skill = {
			name: 'pdf-processing',
			description: 'Extract text from PDFs.',
			body: '# How\n\nDo it.',
			path: 'AI/Skills/pdf-processing/SKILL.md',
			folderPath: 'AI/Skills/pdf-processing',
		};
		const block = formatSkillBodyBlock(skill);
		expect(block.startsWith('# Skill: pdf-processing')).toBe(true);
		expect(block).toContain('Extract text from PDFs.');
		expect(block).toContain('# How');
		expect(block).toContain('AI/Skills/pdf-processing/');
	});
});
