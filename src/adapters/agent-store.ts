// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// AgentStore + ClaimsFilePort adapters over the plugin's settings (data.json)
// and the vault/workspace, for @curtisai/agents' AgentManager.
//
// CRITICAL: SettingsAgentStore.getAgents() must return the LIVE
// settings.agents array BY REFERENCE — the manager pushes created agents
// into it and mutates its elements in place. A defensive copy typechecks
// but silently drops creates and updates.

import { TFile, type App } from 'obsidian';
import type { Agent } from '@curtisai/shared';
import type { AgentStore, ClaimsFilePort } from '@curtisai/agents';
import type CurtisPlugin from '../main';

export class SettingsAgentStore implements AgentStore {
	constructor(private readonly plugin: CurtisPlugin) {}

	/** The LIVE roster array — never a copy (see file header). */
	getAgents(): Agent[] {
		return this.plugin.settings.agents;
	}

	/** Swap the whole roster (deleteAgent filters). */
	replaceAgents(agents: Agent[]): void {
		this.plugin.settings.agents = agents;
	}

	get activeProvider(): string {
		return this.plugin.settings.activeProvider;
	}

	get activeModel(): string {
		return this.plugin.settings.activeModel;
	}

	get enableMemory(): boolean {
		return this.plugin.settings.enableMemory;
	}

	get pcpFilePath(): string {
		return this.plugin.settings.pcpFilePath;
	}

	save(): void | Promise<void> {
		void this.plugin.saveSettings();
	}
}

export class VaultClaimsFilePort implements ClaimsFilePort {
	constructor(private readonly app: App) {}

	/** null for missing paths AND folders. */
	async readFile(path: string): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return null;
		return this.app.vault.read(file);
	}

	/** false for folders. */
	fileExists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
	}

	/** MAY throw when the folder already exists (manager tolerates it). */
	async createFolder(path: string): Promise<void> {
		await this.app.vault.createFolder(path);
	}

	/** Throws if the path exists (vault.create semantics — never silently
	 *  overwrite). Creates the parent folder first when missing. */
	async createFile(path: string, content: string): Promise<void> {
		const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
		await this.app.vault.create(path, content);
	}

	async openInWorkspace(path: string): Promise<void> {
		await this.app.workspace.openLinkText(path, '', false);
	}
}
