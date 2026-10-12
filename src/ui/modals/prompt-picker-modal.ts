// Prompt Picker Modal — fuzzy-searchable prompt library selector. `onChoose`
// receives the picked entry; the "Create new prompt…" tail saves through
// settings and routes the fresh entry to onChoose, so a create-from-picker
// flow inserts it immediately (mirrors AgentPickerModal).

import { App, FuzzySuggestModal, Notice, setIcon } from 'obsidian';
import type { PromptLibraryEntry } from '../../types';
import type CurtisPlugin from '../../main';
import { PromptEditorModal } from './prompt-editor-modal';

type PromptPick = { kind: 'entry'; entry: PromptLibraryEntry } | { kind: 'create' };

export class PromptPickerModal extends FuzzySuggestModal<PromptPick> {
	private plugin: CurtisPlugin;
	private onChoose: (entry: PromptLibraryEntry) => void;

	constructor(
		app: App,
		plugin: CurtisPlugin,
		onChoose: (entry: PromptLibraryEntry) => void
	) {
		super(app);
		this.plugin = plugin;
		this.onChoose = onChoose;
		this.setPlaceholder('Search prompts…');
		this.emptyStateText = 'No prompts yet';
	}

	getItems(): PromptPick[] {
		const entries = this.plugin.settings.promptLibrary;
		if (entries.length === 0) return [{ kind: 'create' }];
		return [
			...entries.map((entry): PromptPick => ({ kind: 'entry', entry })),
			{ kind: 'create' },
		];
	}

	getItemText(item: PromptPick): string {
		if (item.kind === 'entry') return item.entry.name;
		return 'Create new prompt…';
	}

	renderSuggestion(item: { item: PromptPick }, el: HTMLElement): void {
		el.empty();
		el.addClass('ai-prompt-suggestion');
		const pick = item.item;
		if (pick.kind === 'entry') {
			el.createSpan({ cls: 'ai-agent-suggestion-name', text: pick.entry.name });
			el.createSpan({
				cls: 'ai-agent-suggestion-sub',
				text: pick.entry.content.slice(0, 120).replace(/\s+/g, ' '),
			});
		} else {
			const icon = el.createSpan({ cls: 'ai-agent-suggestion-emoji' });
			setIcon(icon, 'plus');
			el.createSpan({ cls: 'ai-agent-suggestion-name', text: 'Create new prompt…' });
		}
	}

	onChooseItem(pick: PromptPick): void {
		if (pick.kind === 'entry') {
			this.onChoose(pick.entry);
			return;
		}
		new PromptEditorModal(this.app, (saved) => {
			void (async () => {
				this.plugin.settings.promptLibrary.push(saved);
				await this.plugin.saveSettings();
				new Notice(`Saved prompt "${saved.name}"`);
				this.onChoose(saved);
			})();
		}).open();
	}
}
