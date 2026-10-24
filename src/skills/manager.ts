// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Skills — vault-backed store for the open Agent Skills standard.
//
// Skills live as folders under <skillsFolder>/ (default AI/Skills/), one
// SKILL.md each, hand-editable and vault-synced like the memory and PCP
// files. Freshness needs no event listeners: every access re-lists the
// folder (a cheap sync call) and re-reads only SKILL.md files whose
// TFile.stat.mtime moved, so external edits, sync clients, and renames are
// picked up by the next send with no timers, no debounce, no leak risk.
//
// All model-facing selection flows through skillBlocks() — the single
// point where settings (master toggle), per-skill overrides, always-mode
// injection, and conversation/agent attachment combine. Every arena (chat,
// arena mode, headless API, swarm followers) calls this same method, which
// is what makes skills work with any model in any harness.

import { Notice, normalizePath, parseYaml, TFile, TFolder } from 'obsidian';
import type { Skill, ToolDefinition } from '../types';
import type CurtisPlugin from '../main';
import {
	formatSkillBodyBlock,
	formatSkillsIndexBlock,
	parseSkillMarkdown,
} from './parser';
import { LOAD_SKILL_TOOL_NAME, buildLoadSkillTool } from './load-skill-tool';

/** The registry's public API surface this manager needs — kept structural
 *  so tests can pass a two-method stub. */
interface ToolRegistryLike {
	register(tool: ToolDefinition): () => void;
	unregister(name: string): void;
	has(name: string): boolean;
}

export interface SkillsSnapshot {
	/** Enabled, spec-valid skills, sorted by name. */
	skills: Skill[];
	/** Files that exist but failed spec validation — surfaced in settings,
	 *  never injected. */
	invalid: { path: string; error: string }[];
}

const EMPTY_SNAPSHOT: SkillsSnapshot = { skills: [], invalid: [] };

interface CacheEntry {
	skill: Skill;
	mtime: number;
}

export class SkillManager {
	private plugin: CurtisPlugin;
	private cache = new Map<string, CacheEntry>();
	private lastSignature = '';
	/** Invalid-file entries from the last full rebuild — reused by the cached
	 *  path so the settings display stays truthful between rebuilds. */
	private lastInvalid: { path: string; error: string }[] = [];
	/** Last snapshot delivered — synchronous access for the settings UI. */
	private lastDelivered: SkillsSnapshot = EMPTY_SNAPSHOT;

	constructor(plugin: CurtisPlugin) {
		this.plugin = plugin;
	}

	/** The most recent snapshot, without touching the vault. May be stale by
	 *  one send; the settings group schedules a background refresh on top. */
	getCachedSnapshot(): SkillsSnapshot {
		return this.lastDelivered;
	}

	/** Drop all cached state — the next getSnapshot() rescans from scratch.
	 *  Called when the skills folder setting changes. */
	invalidate(): void {
		this.cache.clear();
		this.lastSignature = '';
		this.lastInvalid = [];
	}

	/** The configured skills folder, normalized. */
	folder(): string {
		return normalizePath(this.plugin.settings.skillsFolder || 'AI/Skills');
	}

	/** Current snapshot: enabled, valid skills (+ invalid files for settings).
	 *  Cheap when nothing changed — a folder listing and stat comparisons. */
	async getSnapshot(): Promise<SkillsSnapshot> {
		const snap = await this.scan();
		this.lastDelivered = snap;
		return snap;
	}

	private async scan(): Promise<SkillsSnapshot> {
		if (!this.plugin.settings.skillsEnabled) {
			this.cache.clear();
			this.lastSignature = '';
			this.lastInvalid = [];
			return EMPTY_SNAPSHOT;
		}
		const root = this.plugin.app.vault.getAbstractFileByPath(this.folder());
		if (!(root instanceof TFolder)) {
			this.cache.clear();
			this.lastSignature = '';
			this.lastInvalid = [];
			return EMPTY_SNAPSHOT;
		}

		// Signature of the one-level-deep skill layout. Any change (folder
		// added/removed/renamed, SKILL.md created/deleted) forces rebuilds;
		// unchanged files are then filtered further by mtime below.
		const entries: { folder: TFolder; file: TFile | null }[] = [];
		for (const child of root.children) {
			if (!(child instanceof TFolder)) continue;
			const file = child.children.find((f) => f instanceof TFile && f.name === 'SKILL.md');
			entries.push({ folder: child, file: file instanceof TFile ? file : null });
		}
		const signature = entries
			.map((e) => `${e.folder.name}:${e.file?.stat.mtime ?? '-'}`)
			.sort()
			.join('|');
		if (signature === this.lastSignature) {
			return this.snapshotFromCache();
		}
		this.lastSignature = signature;
		return this.rebuild(entries);
	}

	private snapshotFromCache(): SkillsSnapshot {
		const skills = [...this.cache.values()].map((e) => e.skill).sort((a, b) => a.name.localeCompare(b.name));
		return { skills, invalid: this.lastInvalid };
	}

	private async rebuild(
		entries: { folder: TFolder; file: TFile | null }[]
	): Promise<SkillsSnapshot> {
		const nextCache = new Map<string, CacheEntry>();
		const invalid: { path: string; error: string }[] = [];
		for (const { folder, file } of entries) {
			if (!file) {
				invalid.push({
					path: `${this.folder()}/${folder.name}`,
					error: 'no SKILL.md in the skill folder',
				});
				continue;
			}
			const cached = this.cache.get(folder.name);
			if (cached && cached.mtime === file.stat.mtime) {
				nextCache.set(folder.name, cached);
				continue;
			}
			try {
				const raw = await this.plugin.app.vault.read(file);
				// parseYaml is injected so parser.ts stays node-safe.
				const result = parseSkillMarkdown(
					folder.name,
					raw,
					(text) => parseYaml(text),
					{ path: file.path, folderPath: folder.path }
				);
				if (result.ok) {
					nextCache.set(folder.name, { skill: result.skill, mtime: file.stat.mtime });
				} else {
					invalid.push({ path: file.path, error: result.error });
				}
			} catch (e) {
				invalid.push({ path: file.path, error: e instanceof Error ? e.message : String(e) });
			}
		}
		this.cache = nextCache;
		this.lastInvalid = invalid;
		const skills = [...nextCache.values()].map((e) => e.skill).sort((a, b) => a.name.localeCompare(b.name));
		return { skills, invalid };
	}

	/** Effective override for one skill — settings win, defaults otherwise. */
	private isEnabled(skill: Skill): boolean {
		return this.plugin.settings.skillOverrides[skill.name]?.enabled !== false;
	}
	private modeOf(skill: Skill): 'auto' | 'always' {
		return this.plugin.settings.skillOverrides[skill.name]?.mode ?? 'auto';
	}

	/** Resolve a skill reference: exact name, case-insensitive name, then
	 *  unambiguous substring among enabled skills (same ladder as agents). */
	async findSkill(ref: string): Promise<Skill | undefined> {
		const { skills } = await this.getSnapshot();
		const q = ref.trim().toLowerCase();
		if (!q) return undefined;
		const exact = skills.find((s) => s.name === q);
		if (exact) return exact;
		const byName = skills.filter((s) => s.name.toLowerCase() === q);
		if (byName.length === 1) return byName[0];
		const bySubstring = skills.filter((s) => s.name.toLowerCase().includes(q));
		return bySubstring.length === 1 ? bySubstring[0] : undefined;
	}

	/**
	 * The system-prompt blocks for one send — the single selection point
	 * every arena goes through. `attachedIds` are skill names pinned to the
	 * conversation/agent or pre-activated via the API; their bodies ride in
	 * full, as do always-mode skills. Everything else enabled appears only
	 * as a discovery index entry (progressive disclosure, stage 1).
	 */
	async skillBlocks(attachedIds: string[] | undefined): Promise<string[]> {
		if (!this.plugin.settings.skillsEnabled) return [];
		const { skills } = await this.getSnapshot();
		const usable = skills.filter((s) => this.isEnabled(s));
		if (usable.length === 0) return [];

		// Attachments resolve through the same ladder as /skill and the API:
		// exact name, case-insensitive, unambiguous substring. Unknown refs
		// are dropped silently — a stale attachment must never fail a send.
		const attached = new Set<string>();
		for (const ref of attachedIds ?? []) {
			if (!ref.trim()) continue;
			const skill = await this.findSkill(ref);
			if (skill) attached.add(skill.name);
		}
		const bodies: Skill[] = [];
		const indexable: Skill[] = [];
		for (const s of usable) {
			if (attached.has(s.name) || this.modeOf(s) === 'always') bodies.push(s);
			else indexable.push(s);
		}

		const blocks: string[] = [];
		if (bodies.length > 0) {
			blocks.push(bodies.map((s) => formatSkillBodyBlock(s)).join('\n\n'));
		}
		if (indexable.length > 0) {
			blocks.push(formatSkillsIndexBlock(indexable, this.folder()));
		}
		return blocks;
	}

	/** Full body block for one skill — the load_skill tool's payload. */
	async loadSkillBody(ref: string): Promise<string | null> {
		const skill = await this.findSkill(ref);
		return skill ? formatSkillBodyBlock(skill) : null;
	}

	/** Keep the load_skill tool slice in step with the master toggle —
	 *  same hot-reload contract as setWebToolsEnabled/setRagToolEnabled:
	 *  takes effect on the next agent send without a plugin reload. */
	syncTools(registry: ToolRegistryLike): void {
		if (this.plugin.settings.skillsEnabled) {
			if (!registry.has(LOAD_SKILL_TOOL_NAME)) {
				registry.register(buildLoadSkillTool(this));
			}
		} else {
			registry.unregister(LOAD_SKILL_TOOL_NAME);
		}
	}

	/** Open (creating from a starter template when missing) the skills
	 *  folder. Used by the settings row; keeps the feature discoverable
	 *  without a dedicated editor UI. */
	async openSkillsFolder(): Promise<void> {
		const folder = this.folder();
		if (!this.plugin.app.vault.getAbstractFileByPath(folder)) {
			try {
				await this.plugin.app.vault.createFolder(folder);
			} catch { /* folder may already exist */ }
		}
		const examplePath = `${folder}/example-skill/SKILL.md`;
		if (!this.plugin.app.vault.getAbstractFileByPath(examplePath)) {
			try {
				await this.plugin.app.vault.create(examplePath, SKILL_TEMPLATE);
				new Notice(`Created starter skill: ${examplePath}`);
			} catch { /* created concurrently or vault read-only */ }
		}
		await this.plugin.app.workspace.openLinkText(examplePath, '', false);
	}
}

/** Starter SKILL.md for the "Open skills folder" button. The folder name
 *  (`example-skill`) must match the frontmatter name — duplicating a skill
 *  means renaming the folder AND the name field together. */
const SKILL_TEMPLATE = `---
name: example-skill
description: What this skill does and when to use it. The model reads this line when deciding whether to load the skill — be specific about triggers ("use when the user asks to …").
---

# Instructions

Replace this with the step-by-step instructions the agent follows when the
skill is loaded. Recommended sections: steps, input/output examples, edge
cases.

Bundled files (references/, assets/, …) live next to this file in the vault
and are read on demand — reference them by their vault path.

Keep this file under ~500 lines; move detail into reference files. To make
your own skill, duplicate this folder and rename the folder and the
frontmatter name to match (lowercase letters, digits, single hyphens).
`;
