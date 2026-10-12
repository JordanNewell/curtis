// Claude-setup import tests — pure functions, node-safe (no Obsidian imports).
// The fs port is an in-memory fake; YAML parse is the same minimal fake the
// skills parser tests use.

import { describe, expect, it } from 'vitest';
import {
	agentToClaudeMarkdown,
	mapAgentToCurtis,
	mapMcpEntry,
	markMcpDuplicates,
	parseAgentMarkdown,
	parseMcpServersMap,
	scanClaudeSetup,
	type ClaudeFsPort,
	type ClaudeYamlParse,
} from './claude-setup';
import type { Agent } from '../types';

/** Split flow-collection body on top-level commas (commas inside quotes
 *  don't split). */
function splitFlow(body: string): string[] {
	const parts: string[] = [];
	let cur = '';
	let quote: string | null = null;
	for (const ch of body) {
		if (quote) {
			cur += ch;
			if (ch === quote) quote = null;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
			cur += ch;
		} else if (ch === ',') {
			parts.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	if (cur.trim()) parts.push(cur);
	return parts;
}

/** Minimal fake yaml: flat scalars, flow lists [a, b], flow maps {k: v},
 *  dash lists, and ONE nested block level (the curtis: block, whose own
 *  acl/routing children are flow style). Scalars stay strings — the Curtis
 *  coercion helpers must tolerate both this and real typed parseYaml. */
const yaml: ClaudeYamlParse = (text) => {
	const unquote = (s: string): string => {
		const t = s.trim();
		return /^".*"$/.test(t) || /^'.*'$/.test(t) ? t.slice(1, -1) : t;
	};
	const parseFlow = (raw: string): unknown => {
		const t = raw.trim();
		if (t.startsWith('[') && t.endsWith(']')) {
			const body = t.slice(1, -1).trim();
			return body ? splitFlow(body).map((p) => unquote(p)) : [];
		}
		if (t.startsWith('{') && t.endsWith('}')) {
			const body = t.slice(1, -1).trim();
			const out: Record<string, unknown> = {};
			if (body) {
				for (const part of splitFlow(body)) {
					const i = part.indexOf(':');
					if (i >= 0) out[part.slice(0, i).trim()] = parseFlow(part.slice(i + 1));
				}
			}
			return out;
		}
		return unquote(t);
	};
	const root: Record<string, unknown> = {};
	const list: string[] = [];
	let listKey: string | null = null;
	let pendingKey: string | null = null;
	let nestedKey: string | null = null;
	const nested: Record<string, unknown> = {};
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		if (/^\s+-/.test(line)) {
			if (!listKey && pendingKey) listKey = pendingKey;
			list.push(unquote(line.replace(/^\s*-\s?/, '')));
			continue;
		}
		const flat = /^(\s*)([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
		if (!flat) throw new Error(`bad line: ${line}`);
		const [, indent, key, rawVal] = flat;
		if (indent && !nestedKey) {
			// first child line after a bare `key:` — it opened a nested block
			nestedKey = pendingKey;
			pendingKey = null;
		}
		if (nestedKey) {
			nested[key] = parseFlow(rawVal);
			continue;
		}
		const val = rawVal.trim();
		if (val === '') {
			pendingKey = key;
			continue;
		}
		pendingKey = null;
		if (listKey) {
			root[listKey] = [...list];
			list.length = 0;
			listKey = null;
		}
		root[key] = parseFlow(rawVal);
	}
	if (nestedKey) root[nestedKey] = { ...nested };
	else if (listKey) root[listKey] = [...list];
	else if (pendingKey) root[pendingKey] = [];
	return root;
};

/** In-memory fs: paths use forward slashes. `dirs` marks directories;
 *  `files` maps paths to contents. */
function fakeFs(files: Record<string, string>, dirs: string[] = [], home = '/home/test'): ClaudeFsPort {
	const norm = (p: string) => p.replace(/\\/g, '/');
	const dirSet = new Set(dirs.map(norm));
	const fileMap = new Map(Object.entries(files).map(([k, v]) => [norm(k), v] as const));
	const allPaths = [...dirSet, ...fileMap.keys()];
	return {
		exists: async (p) => dirSet.has(norm(p)) || fileMap.has(norm(p)),
		readFile: async (p) => {
			const v = fileMap.get(norm(p));
			if (v === undefined) throw new Error('ENOENT');
			return v;
		},
		readdir: async (p) => {
			const base = norm(p).replace(/\/$/, '');
			const prefix = `${base}/`;
			const names = new Set<string>();
			for (const key of allPaths) {
				if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0]);
			}
			return [...names];
		},
		isDirectory: async (p) => dirSet.has(norm(p)),
		homedir: () => home,
	};
}

// ---------------------------------------------------------------------------
// MCP mapping
// ---------------------------------------------------------------------------

describe('MCP import mapping', () => {
	it('parses an mcpServers map with name from the key', () => {
		const entries = parseMcpServersMap({
			context7: { type: 'http', url: 'https://mcp.context7.com/mcp' },
		}, 'user');
		expect(entries).toHaveLength(1);
		expect(entries[0].name).toBe('context7');
		expect(entries[0].source).toBe('user');
	});

	it('maps http entries to a disabled Streamable HTTP config with headers', () => {
		const [mapped] = parseMcpServersMap({
			glama: { type: 'http', url: 'https://glama.app/mcp', headers: { Authorization: 'Bearer abc' } },
		}, 'user').map((e) => mapMcpEntry(e, () => 'mcp-1'));
		expect(mapped.kind).toBe('http');
		expect(mapped.config).not.toBeNull();
		expect(mapped.config!.enabled).toBe(false);
		expect(mapped.config!.url).toBe('https://glama.app/mcp');
		expect(mapped.config!.headers).toEqual([{ name: 'Authorization', value: 'Bearer abc' }]);
	});

	it('maps sse entries to a disabled config with a bridge note', () => {
		const [mapped] = parseMcpServersMap({
			legacy: { type: 'sse', url: 'https://old.example/mcp' },
		}, 'user').map((e) => mapMcpEntry(e, () => 'mcp-2'));
		expect(mapped.kind).toBe('sse');
		expect(mapped.config!.enabled).toBe(false);
		expect(mapped.note).toContain('bridge');
	});

	it('maps stdio entries to a bridge command and NO config — env displayed, never persisted', () => {
		const [mapped] = parseMcpServersMap({
			filesystem: {
				type: 'stdio',
				command: 'npx',
				args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
				env: { API_KEY: 'secret-value' },
			},
		}, 'user').map((e) => mapMcpEntry(e, () => 'mcp-3'));
		expect(mapped.kind).toBe('stdio');
		expect(mapped.config).toBeNull();
		expect(mapped.bridgeCommand).toContain('mcp-proxy');
		expect(mapped.bridgeCommand).toContain('npx -y @modelcontextprotocol/server-filesystem /tmp');
		expect(mapped.bridgeCommand).toContain('API_KEY=secret-value');
		expect(JSON.stringify(mapped.config)).toBe('null');
	});

	it('dedupes by URL against existing Curtis servers', () => {
		const entries = parseMcpServersMap({
			a: { type: 'http', url: 'https://dup.example/mcp' },
			b: { type: 'http', url: 'https://fresh.example/mcp' },
		}, 'user').map((e) => mapMcpEntry(e, () => 'x'));
		const marked = markMcpDuplicates(entries, ['https://dup.example/mcp/']);
		expect(marked[0].duplicate).toBe(true);
		expect(marked[1].duplicate).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Agent parsing + mapping
// ---------------------------------------------------------------------------

const STOCK_AGENT = `---
name: code-reviewer
description: Reviews code for quality and correctness. Use proactively after writes.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You are a principal engineer reviewing changes.`;

describe('agent file parsing', () => {
	it('parses a stock Claude Code agent file', () => {
		const p = parseAgentMarkdown('code-reviewer.md', STOCK_AGENT, yaml);
		expect(p.ok).toBe(true);
		expect(p.name).toBe('code-reviewer');
		expect(p.description).toContain('Reviews code');
		expect(p.tools).toEqual(['Read', 'Grep', 'Glob', 'Bash']);
		expect(p.model).toBe('sonnet');
		expect(p.body).toContain('principal engineer');
	});

	it('falls back to the filename and accepts .agent.md suffix', () => {
		const raw = `---
description: Does infra things.
---

Body.`;
		const p = parseAgentMarkdown('infra.agent.md', raw, yaml);
		expect(p.ok).toBe(true);
		expect(p.name).toBe('infra');
	});

	it('accepts tools as a YAML array', () => {
		const raw = `---
name: t
description: x
tools:
  - Read
  - WebSearch
---

Body.`;
		const p = parseAgentMarkdown('t.md', raw, yaml);
		expect(p.tools).toEqual(['Read', 'WebSearch']);
	});

	it('rejects files without frontmatter (stray documents)', () => {
		const p = parseAgentMarkdown('README.md', '# Just a doc\n\nNothing here.', yaml);
		expect(!p.ok && p.error).toContain('not a Claude agent file');
	});

	it('counts unknown frontmatter fields without rejecting', () => {
		const raw = `---
name: exotic
description: Has extras
role: Specialist
version: 1.0.0
domains: [hosting, cicd]
---

Body.`;
		const p = parseAgentMarkdown('exotic.agent.md', raw, yaml);
		expect(p.ok).toBe(true);
		expect(p.unknownFieldCount).toBe(3);
	});
});

describe('agent mapping to Curtis', () => {
	it('maps known tools to ACL buckets and surfaces unmapped ones', () => {
		const p = parseAgentMarkdown('devops.md', `---
name: devops
description: Infra specialist
tools: [docker, kubernetes, Read, WebSearch, mcp__github__create_issue]
---

Body.`, yaml);
		const { agent, notes } = mapAgentToCurtis(p);
		expect(agent.tools).toEqual({ vault: true, web: true, mcp: true, gcp: false });
		const unmapped = notes.find((n) => n.includes('not recognized'));
		expect(unmapped).toContain('docker');
		expect(unmapped).toContain('kubernetes');
		expect(agent.remote).toBe(false);
		expect(agent.providerId).toBe('');
	});

	it('treats an omitted tools field as all-on (minus GCP) with a note', () => {
		const p = parseAgentMarkdown('free.md', `---
name: free
description: No allowlist
---

Body.`, yaml);
		const { agent, notes } = mapAgentToCurtis(p);
		expect(agent.tools).toEqual({ vault: true, web: true, mcp: true, gcp: false });
		expect(notes.some((n) => n.includes('no tools allowlist'))).toBe(true);
	});

	it('notes the Claude model alias instead of guessing routing', () => {
		const p = parseAgentMarkdown('m.md', STOCK_AGENT, yaml);
		const { agent, notes } = mapAgentToCurtis(p);
		expect(agent.providerId).toBe('');
		expect(agent.modelId).toBe('');
		expect(notes.some((n) => n.includes('"sonnet"'))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Export round-trip
// ---------------------------------------------------------------------------

describe('agent export', () => {
	const baseAgent: Agent = {
		id: 'a1', name: 'reviewer', emoji: '🔍',
		description: 'Reviews code changes',
		systemPrompt: 'You review code.',
		providerId: '', modelId: '',
		tools: { vault: true, web: false, mcp: false, gcp: false },
		memory: 'inherit', createdAt: 0,
	};

	it('exports a restricted agent with a tools allowlist', () => {
		const md = agentToClaudeMarkdown(baseAgent);
		expect(md).toContain('name: reviewer');
		expect(md).toContain('description: Reviews code changes');
		expect(md).toContain('tools: Read, Grep, Glob, Edit, Write, Bash');
		expect(md.trim().endsWith('You review code.')).toBe(true);
	});

	it('omits tools when the ACL is all-on (Claude: all tools)', () => {
		const md = agentToClaudeMarkdown({ ...baseAgent, tools: { vault: true, web: true, mcp: true, gcp: true } });
		expect(md).not.toContain('tools:');
	});

	it('derives a description from the persona when the agent has none', () => {
		const md = agentToClaudeMarkdown({
			...baseAgent,
			description: undefined,
			systemPrompt: '# Role\n\nCareful reviewer of vault notes.',
		});
		expect(md).toContain('description: Careful reviewer of vault notes.');
	});

	it('round-trips: import → export → import keeps name, description, body', () => {
		const imported = mapAgentToCurtis(parseAgentMarkdown('rt.md', STOCK_AGENT, yaml));
		const agent: Agent = {
			...imported.agent,
			id: 'rt', createdAt: 0, emoji: '',
		};
		const exported = agentToClaudeMarkdown(agent);
		const re = parseAgentMarkdown('rt.md', exported, yaml);
		expect(re.ok).toBe(true);
		expect(re.name).toBe('code-reviewer');
		expect(re.description).toBe(imported.agent.description);
		expect(re.body).toBe(imported.agent.systemPrompt);
	});
});

// ---------------------------------------------------------------------------
// Curtis block — the lossless half of the round-trip
// ---------------------------------------------------------------------------

describe('curtis block round-trip', () => {
	const fullAgent: Agent = {
		id: 'f1', name: 'archivist', emoji: '🗄️',
		description: 'Files and retrieves notes',
		systemPrompt: 'You are the archivist.',
		providerId: 'openai', modelId: 'gpt-5.2',
		tools: { vault: true, web: false, mcp: true, gcp: true },
		temperature: 0.3, maxTokens: 4096, maxTurns: 10,
		memory: 'off',
		claims: ['PEP-P', 'PEP-D'],
		skillIds: ['after-effects'],
		remote: true,
		createdAt: 0,
	};

	it('exports a curtis block and re-imports losslessly — remote excepted', () => {
		const md = agentToClaudeMarkdown(fullAgent);
		expect(md).toContain('curtis:');
		const p = parseAgentMarkdown('a.md', md, yaml);
		expect(p.ok).toBe(true);
		expect(p.curtis).toBeDefined();
		const { agent, notes, keepRouting } = mapAgentToCurtis(p);
		expect(keepRouting).toBe(true);
		expect(agent.providerId).toBe('openai');
		expect(agent.modelId).toBe('gpt-5.2');
		expect(agent.tools).toEqual({ vault: true, web: false, mcp: true, gcp: true });
		expect(agent.memory).toBe('off');
		expect(agent.temperature).toBe(0.3);
		expect(agent.maxTokens).toBe(4096);
		expect(agent.maxTurns).toBe(10);
		expect(agent.claims).toEqual(['PEP-P', 'PEP-D']);
		expect(agent.skillIds).toEqual(['after-effects']);
		expect(agent.emoji).toBe('🗄️');
		// The one field import never restores, even from our own files.
		expect(agent.remote).toBe(false);
		expect(notes.some((n) => n.includes('remote'))).toBe(true);
	});

	it('all-on ACL survives via the curtis block (public tools omitted)', () => {
		const md = agentToClaudeMarkdown({ ...fullAgent, tools: { vault: true, web: true, mcp: true, gcp: true } });
		expect(md).not.toContain('\ntools:');
		const { agent } = mapAgentToCurtis(parseAgentMarkdown('a.md', md, yaml));
		expect(agent.tools).toEqual({ vault: true, web: true, mcp: true, gcp: true });
	});

	it('a foreign file without a curtis block maps exactly as before', () => {
		const p = parseAgentMarkdown('f.md', STOCK_AGENT, yaml);
		expect(p.curtis).toBeUndefined();
		const { agent, notes, keepRouting } = mapAgentToCurtis(p);
		expect(keepRouting).toBeUndefined();
		expect(agent.memory).toBe('inherit');
		expect(agent.providerId).toBe('');
		expect(agent.remote).toBe(false);
		expect(notes.some((n) => n.includes('"sonnet"'))).toBe(true);
	});

	it('a malformed curtis block is ignored, not fatal', () => {
		const md = '---\nname: x\ndescription: d\ncurtis: just a scalar\n---\n\nBody.';
		const p = parseAgentMarkdown('x.md', md, yaml);
		expect(p.ok).toBe(true);
		expect(p.curtis).toBeUndefined();
	});

	it('half a routing block is noted, never half-applied', () => {
		const md = '---\nname: x\ndescription: d\ncurtis:\n  routing: {provider: openai}\n---\n\nBody.';
		const { agent, notes, keepRouting } = mapAgentToCurtis(parseAgentMarkdown('x.md', md, yaml));
		expect(keepRouting).toBeUndefined();
		expect(agent.providerId).toBe('');
		expect(agent.modelId).toBe('');
		expect(notes.some((n) => n.includes('routing block incomplete'))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

describe('scanClaudeSetup', () => {
	it('finds skills, agents, MCP, and CLAUDE.md; filters stray files', async () => {
		const fs = fakeFs({
			'/home/test/.claude.json': JSON.stringify({
				mcpServers: { context7: { type: 'http', url: 'https://x.example/mcp' } },
				projects: { '/some/other': { mcpServers: { local: { type: 'stdio', command: 'uvx' } } } },
			}),
			'/home/test/.claude/skills/after-effects/SKILL.md': '---\nname: after-effects\ndescription: Motion.\n---\n\nDo motion.',
			'/home/test/.claude/skills/agent-logs.md': '# a stray doc, not a skill',
			'/home/test/.agents/skills/ai-agents/SKILL.md': '---\nname: ai-agents\ndescription: Agents.\n---\n\nBuild agents.',
			'/home/test/.claude/agents/backend.agent.md': STOCK_AGENT,
			'/home/test/.claude/agents/AGENTS.md': '# stray doc without frontmatter',
			'/home/test/.claude/CLAUDE.md': '# Global instructions',
			'/vault/.mcp.json': JSON.stringify({ mcpServers: { proj: { type: 'http', url: 'https://proj.example/mcp' } } }),
			'/vault/CLAUDE.md': '# Project instructions',
		}, [
			'/home/test/.claude/skills',
			'/home/test/.claude/skills/after-effects',
			'/home/test/.agents/skills',
			'/home/test/.agents/skills/ai-agents',
			'/home/test/.claude/agents',
		]);

		const scan = await scanClaudeSetup(fs, '/vault', [], yaml);
		expect(scan.skills.map((s) => s.folderName).sort()).toEqual(['after-effects', 'ai-agents']);
		expect(scan.skills.every((s) => s.raw.startsWith('---'))).toBe(true);
		expect(scan.agents).toHaveLength(1);
		expect(scan.agents[0].parse.name).toBe('code-reviewer');
		// top-level user scope imported; per-project local scope skipped
		expect(scan.mcp.map((m) => m.raw.name).sort()).toEqual(['context7', 'proj']);
		expect(scan.claudeMd.map((c) => c.scope).sort()).toEqual(['global', 'project']);
		expect(scan.scanNotes).toHaveLength(0);
	});

	it('tolerates a corrupt ~/.claude.json via scanNotes', async () => {
		const fs = fakeFs({
			'/home/test/.claude.json': '{ not json',
		});
		const scan = await scanClaudeSetup(fs, '/vault', [], yaml);
		expect(scan.mcp).toHaveLength(0);
		expect(scan.scanNotes[0]).toContain('.claude.json');
	});

	it('marks agents whose name already exists in Curtis', async () => {
		const fs = fakeFs({
			'/home/test/.claude/agents/dupe.md': STOCK_AGENT,
		}, ['/home/test/.claude/agents']);
		const scan = await scanClaudeSetup(fs, '/vault', ['Code-Reviewer'], yaml);
		expect(scan.agents[0].duplicate).toBe(true);
	});

	it('contributes nothing when nothing exists', async () => {
		const fs = fakeFs({});
		const scan = await scanClaudeSetup(fs, '/vault', [], yaml);
		expect(scan.mcp).toHaveLength(0);
		expect(scan.skills).toHaveLength(0);
		expect(scan.agents).toHaveLength(0);
		expect(scan.claudeMd).toHaveLength(0);
	});
});
