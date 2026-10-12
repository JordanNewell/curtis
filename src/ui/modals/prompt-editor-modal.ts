// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Prompt Editor Modal — form for adding/editing prompt library entries.
// Mirrors CustomActionEditorModal: validate on submit, hand the record back
// to the caller (settings owns persistence and the id).

import { App, Modal, Setting } from 'obsidian';
import type { PromptLibraryEntry } from '../../types';

export class PromptEditorModal extends Modal {
	private name = '';
	private content = '';
	private onSubmit: (entry: PromptLibraryEntry) => void;
	private existing?: PromptLibraryEntry;
	private errorEl: HTMLElement | null = null;

	constructor(
		app: App,
		onSubmit: (entry: PromptLibraryEntry) => void,
		existing?: PromptLibraryEntry
	) {
		super(app);
		this.onSubmit = onSubmit;
		this.existing = existing;
		if (existing) {
			this.name = existing.name;
			this.content = existing.content;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.existing ? 'Edit prompt' : 'New prompt' });

		new Setting(contentEl)
			.setName('Name')
			.setDesc('Shown in the /prompt picker')
			.addText((t) => {
				t.setPlaceholder('Weekly review')
					.setValue(this.name)
					.onChange((v) => (this.name = v));
			});

		new Setting(contentEl)
			.setName('Prompt')
			.setDesc('The text inserted into the chat input when picked — edit before sending if the run needs specifics')
			.addTextArea((t) => {
				t.setPlaceholder('Review my AI/ folder for the week and draft a summary note with open questions…')
					.setValue(this.content)
					.onChange((v) => (this.content = v));
				t.inputEl.rows = 10;
				t.inputEl.addClass('ai-prompt-editor-content');
			});

		const buttonRow = contentEl.createDiv({ cls: 'ai-modal-button-row' });
		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel', cls: 'ai-modal-btn-secondary' });
		cancelBtn.addEventListener('click', () => this.close());
		const saveBtn = buttonRow.createEl('button', {
			text: this.existing ? 'Save' : 'Add prompt',
			cls: 'mod-cta ai-modal-btn-primary',
		});
		saveBtn.addEventListener('click', () => this.submit());
	}

	private submit(): void {
		const name = this.name.trim();
		const content = this.content;
		if (!name || !content.trim()) {
			this.showError('Name and prompt are required.');
			return;
		}
		const now = Date.now();
		const entry: PromptLibraryEntry = this.existing
			? { ...this.existing, name, content, updatedAt: now }
			: {
				id: `prompt_${now}_${Math.random().toString(36).slice(2, 8)}`,
				name,
				content,
				createdAt: now,
			};
		this.onSubmit(entry);
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
