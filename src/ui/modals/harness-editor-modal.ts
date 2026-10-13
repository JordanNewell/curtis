// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Harness Editor Modal — create or edit a user-defined harness profile:
// the base contract composed under every system prompt (identity, context
// mechanics, operating principles). Mirrors CustomActionEditorModal: validate
// on submit, hand the record back — settings owns persistence and ids.

import { App, Modal, Setting } from 'obsidian';
import type { HarnessProfile } from '@curtis/shared';

export class HarnessEditorModal extends Modal {
	private name = '';
	private description = '';
	private prompt = '';
	private onSubmit: (profile: HarnessProfile) => void;
	private existing?: HarnessProfile;
	private errorEl: HTMLElement | null = null;

	constructor(
		app: App,
		onSubmit: (profile: HarnessProfile) => void,
		existing?: HarnessProfile
	) {
		super(app);
		this.onSubmit = onSubmit;
		this.existing = existing;
		if (existing) {
			this.name = existing.name;
			this.description = existing.description;
			this.prompt = existing.prompt;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.existing ? 'Edit harness profile' : 'New harness profile' });
		contentEl.createEl('p', {
			cls: 'ai-setting-hint',
			text: 'The base contract composed under every conversation\'s system prompt, before your additional instructions and any agent persona. It replaces the built-in Curtis contract while selected — keep the mechanics (attached-note accuracy, tool-list honesty) or the model will drift.',
		});

		new Setting(contentEl)
			.setName('Name')
			.setDesc('Shown in the harness profile picker')
			.addText((t) => {
				t.setPlaceholder('My harness')
					.setValue(this.name)
					.onChange((v) => (this.name = v));
			});

		new Setting(contentEl)
			.setName('Description')
			.setDesc('One line describing what this harness is for')
			.addText((t) => {
				t.setPlaceholder('Coding-focused harness with terse output rules')
					.setValue(this.description)
					.onChange((v) => (this.description = v));
			});

		new Setting(contentEl)
			.setName('Prompt')
			.setDesc('The full base contract. Layered first — your additional instructions and agent personas come after it.')
			.addTextArea((t) => {
				t.setValue(this.prompt).onChange((v) => (this.prompt = v));
				t.inputEl.rows = 14;
				t.inputEl.addClass('ai-harness-editor-prompt');
			});

		const buttonRow = contentEl.createDiv({ cls: 'ai-modal-button-row' });
		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel', cls: 'ai-modal-btn-secondary' });
		cancelBtn.addEventListener('click', () => this.close());
		const saveBtn = buttonRow.createEl('button', {
			text: this.existing ? 'Save' : 'Create profile',
			cls: 'mod-cta ai-modal-btn-primary',
		});
		saveBtn.addEventListener('click', () => this.submit());
	}

	private submit(): void {
		const name = this.name.trim();
		const prompt = this.prompt;
		if (!name || !prompt.trim()) {
			this.showError('Name and prompt are required.');
			return;
		}
		const profile: HarnessProfile = {
			// Edits keep their id; new profiles get a fresh unique one.
			id: this.existing?.id ?? `harness_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			name,
			description: this.description.trim(),
			prompt,
		};
		this.onSubmit(profile);
		this.close();
	}

	private showError(message: string): void {
		this.errorEl?.remove();
		this.errorEl = this.contentEl.createEl('p', { cls: 'ai-modal-error', text: message });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
