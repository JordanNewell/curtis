// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Import from Claude Code — one-click bring-over of an existing setup.
//
// Scans (desktop, local files only — no network):
//   ~/.claude.json top-level mcpServers   (user-scope MCP servers)
//   <vaultRoot>/.mcp.json                 (project-scope MCP servers)
//   ~/.claude/skills, ~/.agents/skills,   (open Agent Skills folders)
//   <vaultRoot>/.claude/skills
//   ~/.claude/agents, <vaultRoot>/.claude/agents   (subagent markdown files)
//   ~/.claude/CLAUDE.md, <vaultRoot>/CLAUDE.md     (instruction files)
//
// Pure and node-safe: all filesystem access goes through ClaudeFsPort (the
// desktop host implements it with lazy `window.require`, tests with fakes),
// and YAML parsing is injected. Real-world directories are messy — stray
// markdown documents live next to real agent files and skill folders — so
// every leg filters strictly and tolerates the rest.
//
// Scope note: Curtis Porter (the standalone converter) is deliberately not
// part of this path. Porter translates proprietary chat exports for people
// not in Obsidian yet; these legs need no translation (skills and agents
// are shared open formats) and must run where the destinations live — the
// vault and Curtis's settings stores. This module nevertheless follows the
// same Obsidian-free standard as the conversation serializer, so a future
// Porter command could lift it to scaffold a vault before first launch.
//
// Invariants (deliberate, promise-preserving):
//   - Everything imports DISABLED: MCP configs carry enabled:false, agents
//     carry remote:false. The user reviews, then turns things on.
//   - stdio `env` values are interpolated into the displayed bridge command
//     only — they are never written into any persisted config.
//   - Collisions never overwrite; callers skip and report.

import type { Agent, AgentToolAcl, McpServerConfig } from '@curtisai/shared';

/** YAML frontmatter parser, injected by the host (Obsidian passes parseYaml). */
export type ClaudeYamlParse = (text: string) => unknown;

/** Minimal filesystem surface the scanner needs. Desktop-only host; tests
 *  pass in-memory fakes. Mobile never constructs one. */
export interface ClaudeFsPort {
	exists(path: string): Promise<boolean>;
	readFile(path: string): Promise<string>;
	/** Entry names of a directory; empty when missing or unreadable. */
	readdir(path: string): Promise<string[]>;
	isDirectory(path: string): Promise<boolean>;
	homedir(): string;
}

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

export interface ClaudeMcpEntryRaw {
	/** Where it was found: user scope (~/.claude.json) or project (.mcp.json). */
	source: 'user' | 'project';
	/** The key in the mcpServers map — Claude's server name. */
	name: string;
	type: string;
	url?: unknown;
	headers?: unknown;
	command?: unknown;
	args?: unknown;
	env?: unknown;
}

export interface MappedMcpEntry {
	raw: ClaudeMcpEntryRaw;
	kind: 'http' | 'sse' | 'stdio' | 'unknown';
	/** Streamable-HTTP config ready for settings.mcpServers — http and sse
	 *  only, always enabled:false. Null for stdio/unknown (nothing usable
	 *  to persist; the bridge command is the deliverable instead). */
	config: McpServerConfig | null;
	/** Human-facing status for the checklist row. */
	note?: string;
	/** stdio only — the command to run outside Obsidian to bridge the
	 *  server onto Streamable HTTP. May contain env values: display only. */
	bridgeCommand?: string;
	/** True when a server with the same URL already exists in Curtis. */
	duplicate?: boolean;
}

/** Read one `mcpServers` map (shape: { "<name>": { type, url|command, … } }). */
export function parseMcpServersMap(map: unknown, source: 'user' | 'project'): ClaudeMcpEntryRaw[] {
	if (typeof map !== 'object' || map === null || Array.isArray(map)) return [];
	const entries: ClaudeMcpEntryRaw[] = [];
	for (const [name, value] of Object.entries(map as Record<string, unknown>)) {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
		const v = value as Record<string, unknown>;
		entries.push({
			source,
			name,
			type: typeof v['type'] === 'string' ? v['type'] : (typeof v['command'] === 'string' ? 'stdio' : typeof v['url'] === 'string' ? 'http' : 'unknown'),
			url: v['url'],
			headers: v['headers'],
			command: v['command'],
			args: v['args'],
			env: v['env'],
		});
	}
	return entries;
}

/** Map one raw entry to what Curtis can use. http → direct (disabled);
 *  sse → direct (disabled + bridge note; our client speaks Streamable HTTP);
 *  stdio → no config, bridge command only. */
export function mapMcpEntry(raw: ClaudeMcpEntryRaw, idGen: () => string): MappedMcpEntry {
	const kind: MappedMcpEntry['kind'] =
		raw.type === 'http' || raw.type === 'sse' || raw.type === 'stdio' ? raw.type : 'unknown';

	if (kind === 'stdio') {
		const command = typeof raw.command === 'string' ? raw.command : '';
		const args = Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === 'string') : [];
		const env = asStringMap(raw.env);
		const envPrefix = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ');
		const bridge = [
			envPrefix,
			'npx -y mcp-proxy --port 8080 --',
			command,
			...args,
		].filter(Boolean).join(' ');
		return {
			raw,
			kind,
			config: null,
			note: 'stdio server — Curtis speaks Streamable HTTP only; run the bridge command, then add its URL manually',
			bridgeCommand: bridge,
		};
	}

	if (kind === 'unknown' || typeof raw.url !== 'string' || !/^https?:\/\//.test(raw.url)) {
		return { raw, kind, config: null, note: 'no usable URL — skipped' };
	}

	const headers = Object.entries(asStringMap(raw.headers)).map(([name, value]) => ({ name, value }));
	const config: McpServerConfig = {
		id: idGen(),
		name: raw.name,
		url: raw.url,
		enabled: false,
		headers,
	};
	if (kind === 'sse') {
		return {
			raw,
			kind,
			config,
			note: 'legacy SSE endpoint — imports disabled; if it will not connect, bridge it with mcp-proxy',
		};
	}
	return { raw, kind, config };
}

function asStringMap(v: unknown): Record<string, string> {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
	const out: Record<string, string> = {};
	for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
		if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
			out[k] = String(val);
		}
	}
	return out;
}

/** Dedupe http/sse entries against the user's existing Curtis servers by URL. */
export function markMcpDuplicates(entries: MappedMcpEntry[], existingUrls: string[]): MappedMcpEntry[] {
	const known = new Set(existingUrls.map((u) => u.replace(/\/+$/, '')));
	return entries.map((e) =>
		e.config && known.has(e.config.url.replace(/\/+$/, ''))
			? { ...e, duplicate: true, note: 'a server with this URL already exists in Curtis' }
			: e
	);
}

// ---------------------------------------------------------------------------
// Subagent files
// ---------------------------------------------------------------------------

export interface ClaudeAgentParse {
	ok: boolean;
	error?: string;
	/** Frontmatter name, else filename minus .agent.md/.md. */
	name: string;
	description?: string;
	/** Tool allowlist from frontmatter; empty when omitted or absent. */
	tools: string[];
	/** True when the file has no `tools` field — Claude's semantic is "all
	 *  tools", which maps to an all-on Curtis ACL (GCP aside). */
	toolsOmitted: boolean;
	model?: string;
	/** The markdown body — the subagent's system prompt. */
	body: string;
	/** Curtis-specific fields from the `curtis:` block, when present and
	 *  well-formed. The lossless half of the round-trip: everything the
	 *  four public dialect fields cannot carry. */
	curtis?: CurtisAgentFileMeta;
	/** Unknown frontmatter fields, tolerated and dropped. */
	unknownFieldCount: number;
}

/** Curtis-specific agent state in the `curtis:` frontmatter block. Claude
 *  Code ignores unknown frontmatter, so a Curtis export stays a valid
 *  Claude Code subagent file; Curtis reads the block back for a lossless
 *  round-trip. Every field is optional — foreign files carry none of it. */
export interface CurtisAgentFileMeta {
	/** File schema version. 1 = the fields below. */
	version?: number;
	emoji?: string;
	memory?: 'inherit' | 'on' | 'off';
	/** Exact tool ACL — the truth the dialect `tools` names only project
	 *  (bucket → name is an approximation; this block is not). */
	acl?: Partial<AgentToolAcl>;
	/** Model routing. Restored only when BOTH halves survive the file — a
	 *  dangling provider or model would silently mix with the active lane. */
	routing?: { provider?: string; model?: string };
	temperature?: number;
	maxTokens?: number;
	maxTurns?: number;
	/** PCP-0 claim classes the agent consents to. */
	claims?: string[];
	/** Skill ids pinned to the agent. */
	skills?: string[];
	/** Exported for fidelity only. Import NEVER restores it — the
	 *  remote:false invariant holds for every file, including our own. */
	remote?: boolean;
}

const KNOWN_FIELDS = new Set(['name', 'description', 'tools', 'model', 'curtis']);

/** Accept a boolean from real YAML (true) or tolerant string forms ('true')
 *  — hand-edited files and minimal parsers do not agree on types. */
function coerceBool(v: unknown): boolean | undefined {
	if (typeof v === 'boolean') return v;
	if (v === 'true') return true;
	if (v === 'false') return false;
	return undefined;
}

/** Accept a number from real YAML or a numeric string from a minimal parser. */
function coerceNumber(v: unknown): number | undefined {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
	return undefined;
}

function coerceStringList(v: unknown): string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out = v
		.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
		.map((s) => s.trim());
	return out.length > 0 ? out : undefined;
}

/** Field-by-field tolerant extraction of the `curtis:` block. A wrong-typed
 *  field is ignored individually — never fails the file, never guesses. */
function parseCurtisMeta(raw: Record<string, unknown>): CurtisAgentFileMeta {
	const meta: CurtisAgentFileMeta = {};
	const version = coerceNumber(raw['version']);
	if (version !== undefined) meta.version = version;
	if (typeof raw['emoji'] === 'string' && raw['emoji'].trim()) meta.emoji = raw['emoji'].trim();
	if (raw['memory'] === 'inherit' || raw['memory'] === 'on' || raw['memory'] === 'off') {
		meta.memory = raw['memory'];
	}
	const acl = raw['acl'];
	if (acl && typeof acl === 'object' && !Array.isArray(acl)) {
		const a = acl as Record<string, unknown>;
		const out: Partial<AgentToolAcl> = {};
		for (const k of ['vault', 'web', 'mcp', 'gcp'] as const) {
			const b = coerceBool(a[k]);
			if (b !== undefined) out[k] = b;
		}
		if (Object.keys(out).length > 0) meta.acl = out;
	}
	const routing = raw['routing'];
	if (routing && typeof routing === 'object' && !Array.isArray(routing)) {
		const r = routing as Record<string, unknown>;
		const provider = typeof r['provider'] === 'string' && r['provider'].trim() ? r['provider'].trim() : undefined;
		const model = typeof r['model'] === 'string' && r['model'].trim() ? r['model'].trim() : undefined;
		if (provider || model) meta.routing = { ...(provider ? { provider } : {}), ...(model ? { model } : {}) };
	}
	const temperature = coerceNumber(raw['temperature']);
	if (temperature !== undefined) meta.temperature = temperature;
	const maxTokens = coerceNumber(raw['maxTokens']);
	if (maxTokens !== undefined) meta.maxTokens = maxTokens;
	const maxTurns = coerceNumber(raw['maxTurns']);
	if (maxTurns !== undefined) meta.maxTurns = maxTurns;
	const claims = coerceStringList(raw['claims']);
	if (claims) meta.claims = claims;
	const skills = coerceStringList(raw['skills']);
	if (skills) meta.skills = skills;
	const remote = coerceBool(raw['remote']);
	if (remote !== undefined) meta.remote = remote;
	return meta;
}

/** Parse one .claude/agents file. Tolerant: extra frontmatter (role,
 *  version, languages, … — common in shared agent collections) is counted
 *  and dropped; files without frontmatter are rejected (they are stray
 *  documents, not agents). */
export function parseAgentMarkdown(fileName: string, raw: string, yamlParse: ClaudeYamlParse): ClaudeAgentParse {
	const fallbackName = fileName.replace(/\.agent\.md$/i, '').replace(/\.md$/i, '');
	const fail = (error: string): ClaudeAgentParse => ({
		ok: false, error, name: fallbackName, tools: [], toolsOmitted: false, body: '', unknownFieldCount: 0,
	});

	const fm = splitFrontmatter(raw);
	if (!fm) return fail('no YAML frontmatter — not a Claude agent file');
	let data: unknown;
	try {
		data = yamlParse(fm);
	} catch (e) {
		return fail(`frontmatter is not valid YAML: ${(e as Error).message}`);
	}
	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		return fail('frontmatter must be a YAML mapping');
	}
	const fields = data as Record<string, unknown>;

	const name = typeof fields['name'] === 'string' && fields['name'].trim()
		? fields['name'].trim()
		: fallbackName;
	const description = typeof fields['description'] === 'string' && fields['description'].trim()
		? fields['description'].trim()
		: undefined;
	const model = typeof fields['model'] === 'string' ? fields['model'].trim() : undefined;

	const toolsRaw = fields['tools'];
	let tools: string[] = [];
	let toolsOmitted = toolsRaw === undefined;
	if (typeof toolsRaw === 'string') {
		tools = toolsRaw.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
	} else if (Array.isArray(toolsRaw)) {
		tools = toolsRaw.filter((t): t is string => typeof t === 'string');
	}

	const curtisRaw = fields['curtis'];
	let curtis: CurtisAgentFileMeta | undefined;
	if (curtisRaw !== undefined) {
		// Well-formed block → meta; anything else (scalar, array) is ignored
		// the way unknown fields are — tolerated, never guessed at.
		if (curtisRaw && typeof curtisRaw === 'object' && !Array.isArray(curtisRaw)) {
			curtis = parseCurtisMeta(curtisRaw as Record<string, unknown>);
		}
	}

	const unknownFieldCount = Object.keys(fields).filter((k) => !KNOWN_FIELDS.has(k)).length;

	return {
		ok: true,
		name,
		description,
		tools,
		toolsOmitted,
		model,
		body: stripFrontmatter(raw).trim(),
		...(curtis ? { curtis } : {}),
		unknownFieldCount,
	};
}

/** Claude Code tool names → Curtis ACL buckets. Anything not listed here
 *  (collections often carry technology names like "docker") is surfaced as
 *  an unmapped note, never guessed. */
const TOOL_BUCKETS: Record<string, keyof Omit<AgentToolAcl, never>> = {
	read: 'vault', grep: 'vault', glob: 'vault', edit: 'vault', write: 'vault',
	notebookedit: 'vault', bash: 'vault', todo: 'vault', todowrite: 'vault',
	webfetch: 'web', websearch: 'web',
};

export interface AgentMapping {
	/** Ready for AgentManager.createAgent (plus routing left empty — the
	 *  agent follows the active lane unless the user sets one). */
	agent: Omit<Agent, 'id' | 'createdAt'>;
	/** Human-facing notes: unmapped tools, routing policy, etc. */
	notes: string[];
	/** True when the `curtis:` block restored real model routing — the host
	 *  must NOT reset routing to the active lane after createAgent. */
	keepRouting?: boolean;
}

/** Map a parsed agent file to a Curtis agent. Invariant: remote:false —
 *  an imported agent can only ever run in chats the user starts until they
 *  explicitly enable remote invocation, and a `curtis:` block never
 *  overrides that (it is noted instead). Claude's `model` aliases (sonnet,
 *  opus, …) are not provider model ids — routing is left empty and noted,
 *  unless the Curtis block carried both halves of a real routing. */
export function mapAgentToCurtis(parse: ClaudeAgentParse): AgentMapping {
	const notes: string[] = [];
	const tools: AgentToolAcl = { vault: false, web: false, mcp: false, gcp: false };
	const meta = parse.curtis;
	let keepRouting = false;

	if (meta?.acl) {
		// Exact truth from a Curtis round-trip beats the dialect projection —
		// bucket→name→bucket is lossy (GCP has no names; bash rides vault).
		tools.vault = meta.acl.vault === true;
		tools.web = meta.acl.web === true;
		tools.mcp = meta.acl.mcp === true;
		tools.gcp = meta.acl.gcp === true;
	} else if (parse.toolsOmitted) {
		// Claude semantic: no tools field = the full toolset.
		tools.vault = true;
		tools.web = true;
		tools.mcp = true;
		notes.push('no tools allowlist — vault/web/MCP enabled (GCP left off)');
	} else {
		const unmapped: string[] = [];
		for (const raw of parse.tools) {
			const key = raw.toLowerCase();
			if (key.startsWith('mcp__') || key === 'mcp') {
				tools.mcp = true;
			} else {
				const bucket = TOOL_BUCKETS[key];
				if (bucket) tools[bucket] = true;
				else unmapped.push(raw);
			}
		}
		if (unmapped.length > 0) notes.push(`tools not recognized by Curtis (left unmapped): ${unmapped.join(', ')}`);
	}

	const agent: Omit<Agent, 'id' | 'createdAt'> = {
		name: parse.name,
		description: parse.description,
		emoji: meta?.emoji ?? '',
		systemPrompt: parse.body,
		providerId: '',
		modelId: '',
		tools,
		memory: meta?.memory ?? 'inherit',
		remote: false,
	};
	if (meta?.temperature !== undefined) agent.temperature = meta.temperature;
	if (meta?.maxTokens !== undefined) agent.maxTokens = meta.maxTokens;
	if (meta?.maxTurns !== undefined) agent.maxTurns = meta.maxTurns;
	if (meta?.claims && meta.claims.length > 0) agent.claims = meta.claims;
	if (meta?.skills && meta.skills.length > 0) agent.skillIds = meta.skills;

	const provider = meta?.routing?.provider;
	const model = meta?.routing?.model;
	if (provider && model) {
		agent.providerId = provider;
		agent.modelId = model;
		keepRouting = true;
	} else {
		if (provider || model) notes.push('Curtis routing block incomplete — routing follows the active lane');
		if (parse.model) notes.push(`Claude model "${parse.model}" not mapped — routing follows the active lane`);
	}
	if (meta?.memory === 'off') notes.push('memory off restored — the agent stays out of the shared memory file');
	if (meta?.remote === true) {
		notes.push('remote invocation is never enabled by import — enable it in the agent editor if wanted');
	}
	if (parse.unknownFieldCount > 0) notes.push(`${parse.unknownFieldCount} extra frontmatter field(s) dropped`);

	return {
		agent,
		notes,
		...(keepRouting ? { keepRouting } : {}),
	};
}

// ---------------------------------------------------------------------------
// Export — Curtis agent → Claude Code agent file
// ---------------------------------------------------------------------------

/** Derive the frontmatter `description` for export when the agent has none:
 *  the first non-heading, non-blank line of the persona. Deterministic. */
function deriveDescription(agent: Agent): string {
	for (const line of agent.systemPrompt.split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t.startsWith('#')) continue;
		return t.length > 200 ? `${t.slice(0, 197)}…` : t;
	}
	return agent.name;
}

const EXPORT_TOOL_NAMES: Record<keyof AgentToolAcl, string> = {
	vault: 'Read, Grep, Glob, Edit, Write, Bash',
	web: 'WebFetch, WebSearch',
	mcp: 'mcp__*',
	gcp: 'gcp__*',
};

/** Serialize one agent to the Claude Code subagent file format. tools is
 *  omitted when the ACL is all-on (Claude's "all tools" semantic); GCP is
 *  the only bucket with no Claude-native names, so it exports as `gcp__*`.
 *  A `curtis:` block rides along with everything the four public fields
 *  cannot carry — Curtis reads it back losslessly, Claude Code ignores it. */
export function agentToClaudeMarkdown(agent: Agent): string {
	const allOn = agent.tools.vault && agent.tools.web && agent.tools.mcp && agent.tools.gcp;
	const fields: string[] = [
		`name: ${yamlScalar(agent.name)}`,
		`description: ${yamlScalar(agent.description?.trim() || deriveDescription(agent))}`,
	];
	if (!allOn) {
		const names = (Object.keys(EXPORT_TOOL_NAMES) as (keyof AgentToolAcl)[])
			.filter((k) => agent.tools[k])
			.map((k) => EXPORT_TOOL_NAMES[k]);
		if (names.length > 0) fields.push(`tools: ${names.join(', ')}`);
	}
	fields.push(curtisBlock(agent));
	return `---\n${fields.join('\n')}\n---\n\n${agent.systemPrompt.trim()}\n`;
}

/** The `curtis:` frontmatter block — the lossless half of the round-trip.
 *  Emitted for every Curtis agent, because the public fields are a lossy
 *  projection of the ACL: GCP has no Claude-native names, and an all-on ACL
 *  omits `tools` entirely (Claude's "all tools"), which re-imports as
 *  GCP-off. Claude Code drops the unknown key; Curtis reads it back.
 *  remote exports for fidelity; import never restores it — the
 *  disabled-by-default invariant holds for every file, including ours. */
function curtisBlock(agent: Agent): string {
	const lines: string[] = [];
	if (agent.emoji.trim()) lines.push(`  emoji: ${yamlScalar(agent.emoji.trim())}`);
	if (agent.memory !== 'inherit') lines.push(`  memory: ${agent.memory}`);
	lines.push(`  acl: {vault: ${agent.tools.vault}, web: ${agent.tools.web}, mcp: ${agent.tools.mcp}, gcp: ${agent.tools.gcp}}`);
	if (agent.providerId && agent.modelId) {
		lines.push(`  routing: {provider: ${yamlScalar(agent.providerId)}, model: ${yamlScalar(agent.modelId)}}`);
	}
	if (agent.temperature !== undefined) lines.push(`  temperature: ${agent.temperature}`);
	if (agent.maxTokens !== undefined) lines.push(`  maxTokens: ${agent.maxTokens}`);
	if (agent.maxTurns !== undefined) lines.push(`  maxTurns: ${agent.maxTurns}`);
	if (agent.claims && agent.claims.length > 0) {
		lines.push(`  claims: [${agent.claims.map((c) => yamlScalar(c)).join(', ')}]`);
	}
	if (agent.skillIds && agent.skillIds.length > 0) {
		lines.push(`  skills: [${agent.skillIds.map((s) => yamlScalar(s)).join(', ')}]`);
	}
	if (agent.remote === true) lines.push('  remote: true');
	return ['curtis:', '  version: 1', ...lines].join('\n');
}

/** Minimal YAML scalar serializer for the three flat fields we export. */
function yamlScalar(v: string): string {
	if (/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(v) && !/^\s|\s$/.test(v)) return v;
	return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export interface ClaudeSkillCandidate {
	/** Human label of the source directory ("~/.claude/skills", …). */
	source: string;
	/** Skill folder name — becomes the vault folder under AI/Skills/. */
	folderName: string;
	/** Absolute path of the SKILL.md. */
	path: string;
	/** Full SKILL.md content, copied verbatim (validation happens in Curtis's
	 *  skills loader, which already surfaces spec errors in settings). */
	raw: string;
}

export interface ClaudeAgentCandidate {
	/** File name as found. */
	file: string;
	/** Absolute path. */
	path: string;
	parse: ClaudeAgentParse;
	/** True when an agent of the same name already exists in Curtis. */
	duplicate?: boolean;
}

export interface ClaudeMdSeed {
	/** 'global' (~/.claude/CLAUDE.md) or 'project' (<vaultRoot>/CLAUDE.md). */
	scope: 'global' | 'project';
	path: string;
	raw: string;
}

export interface ClaudeSetupScan {
	mcp: MappedMcpEntry[];
	skills: ClaudeSkillCandidate[];
	agents: ClaudeAgentCandidate[];
	claudeMd: ClaudeMdSeed[];
	/** Non-fatal observations: corrupt files, skipped scopes, unreadable dirs. */
	scanNotes: string[];
}

const SKILL_SOURCES: { base: (home: string) => string; label: string; vaultRelative?: string }[] = [
	{ base: (home) => `${home}/.claude/skills`, label: '~/.claude/skills' },
	{ base: (home) => `${home}/.agents/skills`, label: '~/.agents/skills' },
	{ base: () => '.claude/skills', label: '<vault>/.claude/skills' },
];

/** Walk every known Claude Code location and build the import snapshot.
 *  Missing directories are normal (most users have a subset) and silently
 *  contribute nothing; unreadable/corrupt content lands in scanNotes. */
export async function scanClaudeSetup(
	fs: ClaudeFsPort,
	vaultRoot: string,
	existingAgentNames: string[],
	yamlParse: ClaudeYamlParse
): Promise<ClaudeSetupScan> {
	const scanNotes: string[] = [];
	const home = fs.homedir();

	// --- MCP ---
	const mcp: MappedMcpEntry[] = [];
	const claudeJsonPath = `${home}/.claude.json`;
	if (await fs.exists(claudeJsonPath)) {
		try {
			const parsed: unknown = JSON.parse(await fs.readFile(claudeJsonPath));
			const topLevel = typeof parsed === 'object' && parsed !== null
				? (parsed as Record<string, unknown>)['mcpServers']
				: undefined;
			mcp.push(...parseMcpServersMap(topLevel, 'user').map((e) => mapMcpEntry(e, () => mcpId())));
			// Local-scope (per-project) servers inside ~/.claude.json projects
			// are deliberately not imported — v1 covers user scope + the vault's
			// own .mcp.json.
		} catch (e) {
			scanNotes.push(`~/.claude.json could not be read as JSON: ${(e as Error).message}`);
		}
	}
	const projectMcp = `${vaultRoot}/.mcp.json`;
	if (await fs.exists(projectMcp)) {
		try {
			const parsed: unknown = JSON.parse(await fs.readFile(projectMcp));
			const map = typeof parsed === 'object' && parsed !== null
				? (parsed as Record<string, unknown>)['mcpServers']
				: undefined;
			mcp.push(...parseMcpServersMap(map, 'project').map((e) => mapMcpEntry(e, () => mcpId())));
		} catch (e) {
			scanNotes.push(`.mcp.json could not be read as JSON: ${(e as Error).message}`);
		}
	}

	// --- Skills ---
	const skills: ClaudeSkillCandidate[] = [];
	for (const src of SKILL_SOURCES) {
		const base = src.base(home);
		if (!(await fs.exists(base))) continue;
		for (const entry of await fs.readdir(base)) {
			const dir = `${base}/${entry}`;
			if (!(await fs.isDirectory(dir))) continue; // stray files are common
			const skillMd = `${dir}/SKILL.md`;
			if (!(await fs.exists(skillMd))) continue;
			try {
				skills.push({ source: src.label, folderName: entry, path: skillMd, raw: await fs.readFile(skillMd) });
			} catch (e) {
				scanNotes.push(`${skillMd} unreadable: ${(e as Error).message}`);
			}
		}
	}

	// --- Agents ---
	const agents: ClaudeAgentCandidate[] = [];
	const existingNames = new Set(existingAgentNames.map((n) => n.toLowerCase()));
	for (const base of [`${home}/.claude/agents`, `${vaultRoot}/.claude/agents`]) {
		if (!(await fs.exists(base))) continue;
		for (const entry of await fs.readdir(base)) {
			if (!/\.md$/i.test(entry)) continue;
			const path = `${base}/${entry}`;
			if (await fs.isDirectory(path)) continue;
			let raw: string;
			try {
				raw = await fs.readFile(path);
			} catch (e) {
				scanNotes.push(`${path} unreadable: ${(e as Error).message}`);
				continue;
			}
			const parse = parseAgentMarkdown(entry, raw, yamlParse);
			if (!parse.ok) continue; // stray document, not an agent — silently skip
			agents.push({
				file: entry,
				path,
				parse,
				duplicate: existingNames.has(parse.name.toLowerCase()),
			});
		}
	}

	// --- CLAUDE.md ---
	const claudeMd: ClaudeMdSeed[] = [];
	const globalMd = `${home}/.claude/CLAUDE.md`;
	if (await fs.exists(globalMd)) {
		try {
			claudeMd.push({ scope: 'global', path: globalMd, raw: await fs.readFile(globalMd) });
		} catch (e) {
			scanNotes.push(`${globalMd} unreadable: ${(e as Error).message}`);
		}
	}
	const projectMd = `${vaultRoot}/CLAUDE.md`;
	if (vaultRoot && await fs.exists(projectMd)) {
		try {
			claudeMd.push({ scope: 'project', path: projectMd, raw: await fs.readFile(projectMd) });
		} catch (e) {
			scanNotes.push(`${projectMd} unreadable: ${(e as Error).message}`);
		}
	}

	return { mcp, skills, agents, claudeMd, scanNotes };
}

let mcpIdCounter = 0;
function mcpId(): string {
	return `mcp-${Date.now()}-${(mcpIdCounter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Frontmatter helpers (local — the skills parser keeps its own private ones)
// ---------------------------------------------------------------------------

/** Raw YAML text between the opening/closing `---` fences, or null. */
function splitFrontmatter(raw: string): string | null {
	if (!raw.startsWith('---')) return null;
	const afterOpen = raw.slice(3);
	if (!/^(\r?\n)/.test(afterOpen)) return null;
	const close = afterOpen.search(/^---\s*(\r?\n|$)/m);
	return close === -1 ? null : afterOpen.slice(0, close);
}

/** Markdown body after the closing fence. */
function stripFrontmatter(raw: string): string {
	const fm = splitFrontmatter(raw);
	if (fm === null) return raw;
	const rest = raw.slice(3 + fm.length);
	const close = rest.search(/^---\s*(\r?\n|$)/m);
	if (close === -1) return '';
	return rest.slice(close).replace(/^---\s*(\r?\n|$)/, '');
}
