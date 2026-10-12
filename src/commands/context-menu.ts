import { Menu, Editor, MarkdownView, Notice } from 'obsidian';
import type CurtisPlugin from '../main';
import { CHAT_VIEW_TYPE, ChatView } from '../chat/view';
import { CURTIS_ICON_ID } from '../icons';

interface ContextAction {
	id: string;
	label: string;
	action: string;
	section: 'ai-top' | 'ai-mid' | 'ai-bottom';
}

const CONTEXT_ACTIONS: ContextAction[] = [
	{ id: 'ai-explain', label: 'Explain with AI', action: 'explain', section: 'ai-top' },
	{ id: 'ai-eli5', label: 'Explain like I am 5', action: 'eli5', section: 'ai-top' },
	{ id: 'ai-summarize', label: 'Summarize with AI', action: 'summarize', section: 'ai-top' },
	{ id: 'ai-tldr', label: 'TL;DR', action: 'tldr', section: 'ai-top' },
	{ id: 'ai-improve', label: 'Improve writing with AI', action: 'improve', section: 'ai-top' },
	{ id: 'ai-rewrite-diff', label: 'Rewrite with AI (diff)', action: 'rewrite-diff', section: 'ai-top' },
	{ id: 'ai-fix-grammar', label: 'Fix grammar with AI', action: 'fix-grammar', section: 'ai-top' },
	{ id: 'ai-shorten', label: 'Shorten with AI', action: 'shorten', section: 'ai-top' },
	{ id: 'ai-translate', label: 'Translate with AI', action: 'translate', section: 'ai-mid' },
	{ id: 'ai-key-points', label: 'Extract key points', action: 'key-points', section: 'ai-mid' },
	{ id: 'ai-extract-links', label: 'Extract wikilinks', action: 'extract-links', section: 'ai-mid' },
	{ id: 'ai-table', label: 'Make a table', action: 'table-from-text', section: 'ai-mid' },
	{ id: 'ai-pros-cons', label: 'Pros & cons', action: 'pros-cons', section: 'ai-mid' },
	{ id: 'ai-convert-callout', label: 'Convert to callout', action: 'convert-callout', section: 'ai-mid' },
	{ id: 'ai-review', label: 'Review code with AI', action: 'code-review', section: 'ai-mid' },
	{ id: 'ai-explain-code', label: 'Explain code with AI', action: 'explain-code', section: 'ai-mid' },
	{ id: 'ai-refactor', label: 'Refactor code with AI', action: 'refactor', section: 'ai-mid' },
	{ id: 'ai-add-tests', label: 'Add tests for code', action: 'add-tests', section: 'ai-mid' },
	{ id: 'ai-chat', label: 'Ask AI about selection', action: 'chat', section: 'ai-bottom' },
];

/** Prefill the chat composer with `text` as a markdown quote instead of
 *  opening an empty chat that silently discards what the user pointed at.
 *  Shared by "Ask AI about selection", the whole-note editor entries, and
 *  the vault-explorer file menu. Input is capped at 8000 chars — the
 *  composer is a prompt, not a document channel. */
export function prefillChatWithQuote(plugin: CurtisPlugin, text: string): void {
	const quote = text.length > 8000
		? text.slice(0, 8000) + '\n…[truncated]'
		: text;
	const prefill = `> ${quote.replace(/\n/g, '\n> ')}\n\n`;
	// Target the chat pane the user is already in (multi-pane); fall back
	// to activating the standard one.
	const activeView = plugin.app.workspace.getActiveViewOfType(ChatView);
	if (activeView) {
		activeView.setInputValue(prefill);
		return;
	}
	void plugin.activateChatView().then(() => {
		const leaf = plugin.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
		if (leaf?.view instanceof ChatView) {
			leaf.view.setInputValue(prefill);
		}
	});
}

export function registerContextMenu(plugin: CurtisPlugin): void {
	// Register workspace menu event
	plugin.registerEvent(
		plugin.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, _view: MarkdownView) => {
			const selection = editor.getSelection();

			// No selection — whole-note actions instead of silently offering
			// nothing. Skipped for empty notes; there is nothing to act on.
			if (!selection) {
				const noteText = editor.getValue();
				if (!noteText.trim()) return;

				menu.addSeparator();
				menu.addItem((item) => {
					item.setTitle('Summarize this note');
					item.setIcon(CURTIS_ICON_ID);
					item.onClick(() => void plugin.summarizeWholeNote(editor));
				});
				menu.addItem((item) => {
					item.setTitle('Chat about this note');
					item.setIcon(CURTIS_ICON_ID);
					item.onClick(() => prefillChatWithQuote(plugin, noteText));
				});
				return;
			}

			menu.addSeparator();

			// User-defined actions ride at the end of the middle group, after
			// the built-ins; their ids resolve inside processSelection.
			const customActions: ContextAction[] = plugin.settings.customSelectionActions.map((a) => ({
				id: `ai-custom-${a.id}`,
				label: a.name,
				action: a.id,
				section: 'ai-mid',
			}));

			// Group actions
			const groups: Record<string, ContextAction[]> = {
				'top': CONTEXT_ACTIONS.filter(a => a.section === 'ai-top'),
				'mid': [...CONTEXT_ACTIONS.filter(a => a.section === 'ai-mid'), ...customActions],
				'bottom': CONTEXT_ACTIONS.filter(a => a.section === 'ai-bottom'),
			};

			for (const group of Object.keys(groups)) {
				const actions: ContextAction[] = groups[group];
				for (const action of actions) {
					menu.addItem((item) => {
						item.setTitle(action.label);
						item.setIcon(CURTIS_ICON_ID);
						item.onClick(() => {
							if (action.action === 'chat') {
								prefillChatWithQuote(plugin, selection);
							} else if (action.action === 'rewrite-diff') {
								void plugin.runDiffRewrite(editor, selection);
							} else {
								void plugin.processSelection(editor, action.action);
							}
						});
					});
				}
				if (group !== 'bottom') {
					menu.addSeparator();
				}
			}

			// Direct memory capture — stores the highlighted text verbatim,
			// no model roundtrip. Skipped when memory is disabled.
			if (plugin.settings.enableMemory) {
				menu.addSeparator();
				menu.addItem((item) => {
					item.setTitle('Save to memory');
					item.setIcon('brain');
						item.onClick(() => {
							void plugin.memoryStore.addFact(selection)
								.then(() => new Notice('Saved to memory'))
								.catch((e) => {
									console.error('[Curtis] Save to memory failed:', e);
									new Notice('Could not save to memory');
								});
						});
				});
			}
		})
	);
}
