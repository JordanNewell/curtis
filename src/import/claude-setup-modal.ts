// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Import-from-Claude-Code modal: scan → checklist → apply → result.
// Desktop-only (the scanner reads files outside the vault); callers gate on
// Platform.isDesktopApp before opening. Reuses the chat-import summary
// styling so the two importers read as one family.

import { App, Modal, setIcon } from 'obsidian';
import type CurtisPlugin from '../main';
import { mapAgentToCurtis } from './claude-setup';
import {
	applyClaudeSetupImport,
	scanClaudeSetupForPlugin,
	type ClaudeSetupApplyResult,
	type ClaudeSetupSelection,
} from './claude-setup-host';
import type { ClaudeSetupScan } from './claude-setup';

export class ClaudeSetupImportModal extends Modal {
	private plugin: CurtisPlugin;
	private scan: ClaudeSetupScan | null = null;
	private scanError: string | null = null;
	/** Checked indices per section. */
	private mcpChecked = new Set<number>();
	private skillChecked = new Set<number>();
	private agentChecked = new Set<number>();
	private claudeMdChecked = new Set<string>();
	private applied: ClaudeSetupApplyResult | null = null;

	constructor(app: App, plugin: CurtisPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('curt-claude-setup');
		contentEl.createDiv({ cls: 'curt-import-summary-title', text: 'Import from Claude Code' });

		if (this.applied) {
			this.renderResult();
			return;
		}

		contentEl.createDiv({ cls: 'curt-claude-setup-status', text: 'Scanning Claude Code configuration…' });
		try {
			this.scan = await scanClaudeSetupForPlugin(this.plugin);
		} catch (e) {
			this.scanError = e instanceof Error ? e.message : String(e);
		}
		if (!this.scan || this.scanError) {
			contentEl.empty();
			contentEl.createDiv({ cls: 'curt-import-summary-title', text: 'Import from Claude Code' });
			contentEl.createDiv({
				cls: 'curt-claude-setup-status',
				text: this.scanError ?? 'Claude Code configuration could not be scanned. This import is desktop-only.',
			});
			this.renderDoneButton();
			return;
		}
		this.renderChecklist();
	}

	private renderChecklist(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createDiv({ cls: 'curt-import-summary-title', text: 'Import from Claude Code' });
		const sub = contentEl.createDiv({ cls: 'curt-claude-setup-sub' });
		sub.setText('Everything imports disabled — review, then turn each piece on. Existing items are never overwritten.');

		for (const note of this.scan!.scanNotes) {
			const row = contentEl.createDiv({ cls: 'curt-claude-setup-note' });
			setIcon(row.createDiv({ cls: 'curt-claude-setup-note-icon' }), 'info');
			row.createSpan({ text: note });
		}

		if (this.scan!.mcp.length > 0) this.renderMcpSection();
		if (this.scan!.skills.length > 0) this.renderSkillsSection();
		if (this.scan!.agents.length > 0) this.renderAgentsSection();
		if (this.scan!.claudeMd.length > 0) this.renderClaudeMdSection();

		if (this.scan!.mcp.length + this.scan!.skills.length + this.scan!.agents.length + this.scan!.claudeMd.length === 0) {
			contentEl.createDiv({
				cls: 'curt-claude-setup-status',
				text: 'Nothing found — no Claude Code configuration, skills, agents, or CLAUDE.md on this machine.',
			});
		}
		this.renderActions();
	}

	private sectionHeading(title: string): HTMLElement {
		const h = this.contentEl.createDiv({ cls: 'curt-claude-setup-section' });
		h.createDiv({ cls: 'curt-claude-setup-section-title', text: title });
		return h;
	}

	private renderMcpSection(): void {
		this.sectionHeading('MCP servers');
		for (let i = 0; i < this.scan!.mcp.length; i++) {
			const entry = this.scan!.mcp[i];
			const row = this.contentEl.createDiv({ cls: 'curt-claude-setup-row' });
			const url = typeof entry.raw.url === 'string' ? entry.raw.url : '';
			if (entry.kind === 'stdio') {
				// Nothing importable — the bridge command is the deliverable.
				row.addClass('is-static');
				const body = row.createDiv({ cls: 'curt-claude-setup-row-body' });
				body.createDiv({ cls: 'curt-claude-setup-row-title', text: `${entry.raw.name} (stdio)` });
				const code = body.createDiv({ cls: 'curt-claude-setup-bridge' });
				code.setText(entry.bridgeCommand ?? '');
				body.createDiv({ cls: 'curt-claude-setup-row-note', text: entry.note ?? '' });
				continue;
			}
			const check = row.createDiv({ cls: 'curt-claude-setup-check' });
			const cb = check.createEl('input', { type: 'checkbox' });
			cb.checked = !!entry.config && !entry.duplicate;
			if (cb.checked) this.mcpChecked.add(i);
			cb.addEventListener('change', () => {
				if (cb.checked) this.mcpChecked.add(i);
				else this.mcpChecked.delete(i);
			});
			const body = row.createDiv({ cls: 'curt-claude-setup-row-body' });
			const badges = [entry.kind.toUpperCase(), entry.raw.source === 'user' ? 'user scope' : 'project'];
			if (entry.duplicate) badges.push('already in Curtis');
			body.createDiv({ cls: 'curt-claude-setup-row-title', text: entry.raw.name });
			body.createDiv({ cls: 'curt-claude-setup-row-note', text: `${badges.join(' · ')} · ${url}` });
			if (entry.note && !entry.duplicate) {
				body.createDiv({ cls: 'curt-claude-setup-row-note', text: entry.note });
			}
		}
	}

	private renderSkillsSection(): void {
		this.sectionHeading(`Skills (${this.plugin.skills.folder()})`);
		for (let i = 0; i < this.scan!.skills.length; i++) {
			const candidate = this.scan!.skills[i];
			const exists = !!this.plugin.app.vault.getAbstractFileByPath(
				`${this.plugin.skills.folder()}/${candidate.folderName}/SKILL.md`
			);
			const row = this.contentEl.createDiv({ cls: 'curt-claude-setup-row' });
			const check = row.createDiv({ cls: 'curt-claude-setup-check' });
			const cb = check.createEl('input', { type: 'checkbox' });
			cb.checked = !exists;
			if (cb.checked) this.skillChecked.add(i);
			cb.addEventListener('change', () => {
				if (cb.checked) this.skillChecked.add(i);
				else this.skillChecked.delete(i);
			});
			const body = row.createDiv({ cls: 'curt-claude-setup-row-body' });
			body.createDiv({ cls: 'curt-claude-setup-row-title', text: candidate.folderName });
			body.createDiv({
				cls: 'curt-claude-setup-row-note',
				text: `${candidate.source}${exists ? ' · already in the vault — will be skipped' : ''}`,
			});
		}
	}

	private renderAgentsSection(): void {
		this.sectionHeading('Subagents');
		for (let i = 0; i < this.scan!.agents.length; i++) {
			const candidate = this.scan!.agents[i];
			const mapping = mapAgentToCurtis(candidate.parse);
			const row = this.contentEl.createDiv({ cls: 'curt-claude-setup-row' });
			const check = row.createDiv({ cls: 'curt-claude-setup-check' });
			const cb = check.createEl('input', { type: 'checkbox' });
			cb.checked = !candidate.duplicate;
			if (cb.checked) this.agentChecked.add(i);
			cb.addEventListener('change', () => {
				if (cb.checked) this.agentChecked.add(i);
				else this.agentChecked.delete(i);
			});
			const body = row.createDiv({ cls: 'curt-claude-setup-row-body' });
			body.createDiv({ cls: 'curt-claude-setup-row-title', text: candidate.parse.name });
			const bits: string[] = [];
			if (candidate.duplicate) bits.push('an agent with this name exists — will be skipped');
			if (candidate.parse.description) bits.push(candidate.parse.description);
			for (const note of mapping.notes) bits.push(note);
			if (bits.length > 0) body.createDiv({ cls: 'curt-claude-setup-row-note', text: bits.join(' · ') });
		}
	}

	private renderClaudeMdSection(): void {
		this.sectionHeading('CLAUDE.md → harness profiles');
		for (const seed of this.scan!.claudeMd) {
			const row = this.contentEl.createDiv({ cls: 'curt-claude-setup-row' });
			const check = row.createDiv({ cls: 'curt-claude-setup-check' });
			const cb = check.createEl('input', { type: 'checkbox' });
			cb.checked = !this.plugin.settings.harnessProfiles.some((p) => p.name.endsWith(seed.scope === 'global' ? '(global)' : '(project)'));
			if (cb.checked) this.claudeMdChecked.add(seed.scope);
			cb.addEventListener('change', () => {
				if (cb.checked) this.claudeMdChecked.add(seed.scope);
				else this.claudeMdChecked.delete(seed.scope);
			});
			const body = row.createDiv({ cls: 'curt-claude-setup-row-body' });
			body.createDiv({
				cls: 'curt-claude-setup-row-title',
				text: seed.scope === 'global' ? 'Claude Code (global)' : 'Claude Code (project)',
			});
			body.createDiv({
				cls: 'curt-claude-setup-row-note',
				text: `${seed.path} · becomes a harness profile you can activate or ignore`,
			});
		}
	}

	private renderActions(): void {
		const actions = this.contentEl.createDiv({ cls: 'curt-import-summary-actions' });
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.close());
		const importBtn = actions.createEl('button', { cls: 'mod-cta', text: 'Import selected' });
		importBtn.addEventListener('click', () => {
			void (async () => {
				const selection: ClaudeSetupSelection = {
					mcp: [...this.mcpChecked],
					skills: [...this.skillChecked],
					agents: [...this.agentChecked],
					claudeMd: [...this.claudeMdChecked] as ClaudeSetupSelection['claudeMd'],
				};
				this.applied = await applyClaudeSetupImport(this.plugin, this.scan!, selection);
				await this.onOpen();
			})();
		});
	}

	private renderResult(): void {
		const { contentEl } = this;
		const r = this.applied!;
		const headline = r.importedMcp + r.importedSkills + r.importedAgents + r.importedProfiles > 0
			? `Imported ${r.importedMcp} MCP server(s), ${r.importedSkills} skill(s), ${r.importedAgents} agent(s), ${r.importedProfiles} harness profile(s)`
			: 'Nothing imported';
		contentEl.createDiv({ cls: 'curt-import-summary-headline', text: headline });
		const skipParts: string[] = [];
		if (r.skippedMcp) skipParts.push(`${r.skippedMcp} MCP`);
		if (r.skippedSkills) skipParts.push(`${r.skippedSkills} skill(s)`);
		if (r.skippedAgents) skipParts.push(`${r.skippedAgents} agent(s)`);
		if (skipParts.length > 0) {
			contentEl.createDiv({ cls: 'curt-claude-setup-sub', text: `Skipped (already present): ${skipParts.join(', ')}` });
		}
		for (const note of r.notes) {
			const row = contentEl.createDiv({ cls: 'curt-claude-setup-note' });
			setIcon(row.createDiv({ cls: 'curt-claude-setup-note-icon' }), 'info');
			row.createSpan({ text: note });
		}
		if (r.importedMcp > 0) {
			contentEl.createDiv({
				cls: 'curt-claude-setup-sub',
				text: 'All MCP servers imported disabled — review each one under Settings → MCP servers, then enable.',
			});
		}
		this.renderDoneButton();
	}

	private renderDoneButton(): void {
		const actions = this.contentEl.createDiv({ cls: 'curt-import-summary-actions' });
		const done = actions.createEl('button', { cls: 'mod-cta', text: 'Done' });
		done.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
