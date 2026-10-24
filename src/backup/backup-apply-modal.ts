// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Backup apply — post-import step for a full-backup zip. Conversations
// already landed through the normal pipeline; this modal is the opt-in gate
// for the remaining sections. Prompts and harnesses merge by id (existing
// entries win) and default on; settings replace wholesale — with local
// credentials preserved — so they default off and say so.

import { App, Modal, Notice, Setting } from 'obsidian';
import type CurtisPlugin from '../main';
import type { BackupBundle } from './backup-format';
import { applyBackupBundle, type BackupApplyResult } from './backup';

export class BackupApplyModal extends Modal {
	private readonly plugin: CurtisPlugin;
	private readonly bundles: BackupBundle[];
	private opts = { promptLibrary: true, harnessProfiles: true, settings: false };

	constructor(app: App, plugin: CurtisPlugin, bundles: BackupBundle[]) {
		super(app);
		this.modalEl.addClass('curtis-modal');
		this.plugin = plugin;
		this.bundles = bundles;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('curt-import-summary');

		contentEl.createDiv({ cls: 'curt-import-summary-title', text: 'Backup imported' });
		contentEl.createDiv({
			cls: 'curt-import-summary-headline',
			text: 'Conversations are in. Apply the rest of this backup?',
		});

		const prompts = this.bundles.reduce((n, b) => n + b.promptLibrary.length, 0);
		const harnesses = this.bundles.reduce((n, b) => n + b.harnessProfiles.length, 0);
		const hasSettings = this.bundles.some((b) => b.settings);

		if (prompts > 0) {
			new Setting(contentEl)
				.setName(`Prompt library (${prompts})`)
				.setDesc('Adds prompts whose ids are new here. Prompts you already have are never overwritten.')
				.addToggle((t) => t.setValue(this.opts.promptLibrary).onChange((v) => (this.opts.promptLibrary = v)));
		}
		if (harnesses > 0) {
			new Setting(contentEl)
				.setName(`Harness profiles (${harnesses})`)
				.setDesc('Adds harness profiles whose ids are new here. Existing profiles are kept as-is.')
				.addToggle((t) => t.setValue(this.opts.harnessProfiles).onChange((v) => (this.opts.harnessProfiles = v)));
		}
		if (hasSettings) {
			new Setting(contentEl)
				.setName('Settings, agents & scheduled jobs')
				.setDesc('Replaces this vault\'s settings with the backup\'s (providers, agents, scheduled jobs, preferences). API keys and other credentials are never exported and your local ones are kept.')
				.addToggle((t) => t.setValue(this.opts.settings).onChange((v) => (this.opts.settings = v)));
		}

		const actions = contentEl.createDiv({ cls: 'curt-import-summary-actions' });
		const skip = actions.createEl('button', { text: 'Chats only' });
		skip.addEventListener('click', () => this.close());
		const apply = actions.createEl('button', { cls: 'mod-cta', text: 'Apply selected' });
		apply.addEventListener('click', () => {
			void (async () => {
				let combined: BackupApplyResult = { promptsAdded: 0, promptsSkipped: 0, harnessesAdded: 0, harnessesSkipped: 0, settingsApplied: false };
				for (const bundle of this.bundles) {
					const r = await applyBackupBundle(this.plugin, bundle, this.opts);
					combined = {
						promptsAdded: combined.promptsAdded + r.promptsAdded,
						promptsSkipped: combined.promptsSkipped + r.promptsSkipped,
						harnessesAdded: combined.harnessesAdded + r.harnessesAdded,
						harnessesSkipped: combined.harnessesSkipped + r.harnessesSkipped,
						settingsApplied: combined.settingsApplied || r.settingsApplied,
					};
				}
				this.close();
				const parts: string[] = [];
				if (combined.promptsAdded) parts.push(`${combined.promptsAdded} prompt${combined.promptsAdded === 1 ? '' : 's'}`);
				if (combined.harnessesAdded) parts.push(`${combined.harnessesAdded} harness${combined.harnessesAdded === 1 ? 'es' : ''}`);
				if (combined.settingsApplied) parts.push('settings');
				if (parts.length === 0) {
					new Notice('Nothing new to apply');
				} else {
					new Notice(`Applied: ${parts.join(', ')}`, 8000);
				}
			})();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
