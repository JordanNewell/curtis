// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Slash command parser + registry. The ChatView intercepts the input on Send:
// if the trimmed text starts with `/`, dispatch via handleSlashCommand, which
// either consumes it (returns true) or lets the send fall through (false).

import { App, Notice, TFile } from 'obsidian';
import type { ConversationStore } from './conversation-store';
import { downloadConversationMarkdown } from './export';
import { runRecap } from './recap';
import { createNote, renderConversationAsMarkdown, saveMessageAsNote } from '../vault/notes';
import { SlashHelpModal } from '../ui/modals/slash-help-modal';
import { AgentPickerModal } from '../ui/modals/agent-picker-modal';
import { PromptPickerModal } from '../ui/modals/prompt-picker-modal';
import { confirmAction } from '../ui/modals/confirm-modal';
import type CurtisPlugin from '../main';

export interface SlashCommand {
	/** Command name without leading slash. Lowercase. */
	name: string;
	/** Display usage, e.g. "/note [name]". */
	usage: string;
	description: string;
	/** Returns true if handled (send suppressed). */
	run: (ctx: SlashContext) => Promise<boolean> | boolean;
}

export interface SlashContext {
	plugin: CurtisPlugin;
	app: App;
	/** The full input string including the slash. */
	raw: string;
	/** Arguments (everything after the command word). */
	args: string;
	/** Conversation the invoking pane is bound to — commands act on it, not
	 *  on the store's global current pointer (multi-pane support). */
	conversationId?: string | null;
	/** Switch the invoking pane's (and the workspace-default) provider/model. */
	setModel?: (providerId: string, modelId: string) => void;
	/** The invoking pane's resolved send lane (conversation agent or pane
	 *  picker) — same resolution sendMessage uses; null when nothing is
	 *  authenticated. */
	resolveSendLane?: () => { providerId: string; modelId: string } | null;
	/** Helper to replace the input box value. */
	setInput: (text: string) => void;
	/** Helper to focus the input. */
	focusInput: () => void;
	/** Regenerate the last assistant response. */
	regenerate: () => void;
	/** Re-render the current conversation. */
	refresh: () => void;
	/** Start a new chat. */
	newChat: () => void;
}

const findConv = (store: ConversationStore, conversationId?: string | null) =>
	conversationId ? store.getConversation(conversationId) : store.getCurrentConversation();

export const SLASH_COMMANDS: SlashCommand[] = [
	{
		name: 'clear',
		usage: '/clear',
		description: 'Start a new chat',
		run: (ctx) => {
			ctx.newChat();
			return true;
		},
	},
	{
		name: 'regen',
		usage: '/regen',
		description: 'Regenerate the last assistant response',
		run: (ctx) => {
			ctx.regenerate();
			return true;
		},
	},
	{
		name: 'regenerate',
		usage: '/regenerate',
		description: 'Alias of /regen',
		run: (ctx) => {
			ctx.regenerate();
			return true;
		},
	},
	{
		name: 'title',
		usage: '/title <text>',
		description: 'Rename the current conversation',
		run: (ctx) => {
			const conv = findConv(ctx.plugin.conversationStore, ctx.conversationId);
			const title = ctx.args.trim();
			if (!conv) return true;
			if (!title) {
				new Notice('Usage: /title <new name>');
				return true;
			}
			ctx.plugin.conversationStore.renameCurrentConversation(title, conv.id);
			ctx.refresh();
			new Notice(`Renamed to "${title}"`);
			return true;
		},
	},
	{
		name: 'leader',
		usage: '/leader',
		description: 'Toggle leader mode — this chat can spawn follower agents',
		run: (ctx) => {
			const conv = findConv(ctx.plugin.conversationStore, ctx.conversationId);
			if (!conv) return true;
			const isLeader = conv.role === 'leader';
			ctx.plugin.conversationStore.setConversationRole(conv.id, isLeader ? undefined : 'leader');
			ctx.refresh();
			new Notice(isLeader
				? 'Leader mode off — this chat is a normal chat again'
				: `Leader mode on — this chat can now spawn up to ${ctx.plugin.settings.swarmMaxFollowers} follower agent(s) per message`);
			return true;
		},
	},
	{
		name: 'copy',
		usage: '/copy',
		description: 'Copy the last assistant response',
		run: async (ctx) => {
			const last = ctx.plugin.conversationStore.getLastAssistantMessage(ctx.conversationId ?? undefined);
			if (!last) {
				new Notice('No assistant message to copy');
				return true;
			}
			try {
				await navigator.clipboard.writeText(last.content);
				new Notice('Copied last response');
			} catch {
				new Notice('Copy failed');
			}
			return true;
		},
	},
	{
		name: 'note',
		usage: '/note [name]',
		description: 'Save the last assistant response as a new note',
		run: async (ctx) => {
			const last = ctx.plugin.conversationStore.getLastAssistantMessage(ctx.conversationId ?? undefined);
			if (!last) {
				new Notice('No assistant message to save');
				return true;
			}
			const folder = ctx.plugin.settings.noteSaveFolder;
			const file = await saveMessageAsNote(ctx.app, last, folder, {
				open: true,
				name: ctx.args.trim() || undefined,
			});
			if (file instanceof TFile) new Notice(`Saved: ${file.basename}`);
			return true;
		},
	},
	{
		name: 'save-all',
		usage: '/save-all [name]',
		description: 'Export the whole conversation to a single note',
		run: async (ctx) => {
			const conv = findConv(ctx.plugin.conversationStore, ctx.conversationId);
			if (!conv || conv.messages.length === 0) {
				new Notice('Nothing to export');
				return true;
			}
			const folder = ctx.plugin.settings.noteSaveFolder;
			const body = renderConversationAsMarkdown(conv.messages, conv.title);
			const name = ctx.args.trim() || conv.title;
			const file = await createNote(ctx.app, folder, name, body, { open: true });
			if (file instanceof TFile) new Notice(`Exported: ${file.basename}`);
			return true;
		},
	},
	{
		name: 'export',
		usage: '/export',
		description: 'Download current conversation as a markdown file',
		run: (ctx) => {
			const conv = findConv(ctx.plugin.conversationStore, ctx.conversationId);
			if (!conv || conv.messages.length === 0) {
				new Notice('Nothing to export');
				return true;
			}
			downloadConversationMarkdown(conv, {
				providerName: (id) => ctx.plugin.providerRegistry.getProvider(id)?.name,
			});
			new Notice(`Exported: ${conv.title}`);
			return true;
		},
	},
	{
		name: 'paste',
		usage: '/paste',
		description: 'Paste from clipboard into the input',
		run: async (ctx) => {
			try {
				const text = await navigator.clipboard.readText();
				ctx.setInput(text);
				ctx.focusInput();
			} catch {
				new Notice('Clipboard read denied (allow clipboard access)');
			}
			return true;
		},
	},
	{
		name: 'prompt',
		usage: '/prompt [name]',
		description: 'Insert a saved prompt (bare = picker; replaces the input)',
		run: (ctx) => {
			const insert = (content: string): void => {
				ctx.setInput(content);
				ctx.focusInput();
			};
			const q = ctx.args.trim().toLowerCase();
			if (!q) {
				new PromptPickerModal(ctx.app, ctx.plugin, (entry) => insert(entry.content)).open();
				return true;
			}
			const entries = ctx.plugin.settings.promptLibrary;
			let best: { entry: (typeof entries)[number]; score: number } | null = null;
			for (const entry of entries) {
				const score = fuzzyScore(q, entry.name.toLowerCase());
				if (score > 0 && (!best || score > best.score)) best = { entry, score };
			}
			if (!best) {
				const names = entries.map((e) => e.name).join(', ');
				new Notice(`No prompt matching "${q}"${names ? ` — available: ${names}` : ' — save one in Settings → Prompt library'}`);
				return true;
			}
			insert(best.entry.content);
			return true;
		},
	},
	{
		name: 'model',
		usage: '/model <name>',
		description: 'Switch active model (fuzzy match)',
		run: (ctx) => {
			const q = ctx.args.trim().toLowerCase();
			if (!q) {
				new Notice('Usage: /model <name>');
				return true;
			}
			const providers = ctx.plugin.providerRegistry.getAllEnabledProviders();
			let best: { providerId: string; modelId: string; score: number } | null = null;
			for (const { id, provider } of providers) {
				for (const m of provider.models) {
					const hay = `${provider.name} ${m.name} ${m.id}`.toLowerCase();
					const score = fuzzyScore(q, hay);
					if (score > 0 && (!best || score > best.score)) {
						best = { providerId: id, modelId: m.id, score };
					}
				}
			}
			if (!best) {
				new Notice(`No model matching "${q}"`);
				return true;
			}
			if (ctx.setModel) {
				ctx.setModel(best.providerId, best.modelId);
			} else {
				ctx.plugin.settings.activeProvider = best.providerId;
				ctx.plugin.settings.activeModel = best.modelId;
				void ctx.plugin.saveSettings();
			}
			const provider = ctx.plugin.providerRegistry.getProvider(best.providerId);
			new Notice(`Model: ${provider?.name} / ${best.modelId}`);
			ctx.refresh();
			return true;
		},
	},
	{
		name: 'provider',
		usage: '/provider <name>',
		description: 'Switch active provider (fuzzy match)',
		run: (ctx) => {
			const q = ctx.args.trim().toLowerCase();
			if (!q) {
				new Notice('Usage: /provider <name>');
				return true;
			}
			const providers = ctx.plugin.providerRegistry.getAllEnabledProviders();
			let best: { id: string; score: number } | null = null;
			for (const { id, provider } of providers) {
				const score = fuzzyScore(q, `${provider.name} ${id}`.toLowerCase());
				if (score > 0 && (!best || score > best.score)) {
					best = { id, score };
				}
			}
			if (!best) {
				new Notice(`No provider matching "${q}"`);
				return true;
			}
			const provider = ctx.plugin.providerRegistry.getProvider(best.id);
			const firstModel = provider?.models[0]?.id;
			if (ctx.setModel && best.id && firstModel) {
				ctx.setModel(best.id, firstModel);
			} else {
				ctx.plugin.settings.activeProvider = best.id;
				if (firstModel) ctx.plugin.settings.activeModel = firstModel;
				void ctx.plugin.saveSettings();
			}
			new Notice(`Provider: ${provider?.name}`);
			ctx.refresh();
			return true;
		},
	},
	{
		name: 'agent',
		usage: '/agent [name|off]',
		description: 'Bind a named agent to this chat (bare = picker)',
		run: (ctx) => {
			const conv = findConv(ctx.plugin.conversationStore, ctx.conversationId);
			if (!conv) {
				new Notice('No conversation — send a message first');
				return true;
			}
			const arg = ctx.args.trim();
			if (!arg) {
				new AgentPickerModal(ctx.app, ctx.plugin, (agent) => {
					ctx.plugin.conversationStore.setConversationAgent(conv.id, agent?.id);
					new Notice(agent
						? `${agent.emoji} ${agent.name} — this chat now runs on ${agent.modelId}`
						: 'Agent cleared — default assistant');
					ctx.refresh();
				}).open();
				return true;
			}
			if (arg.toLowerCase() === 'off') {
				ctx.plugin.conversationStore.setConversationAgent(conv.id, undefined);
				ctx.refresh();
				new Notice('Agent cleared — default assistant');
				return true;
			}
			const agent = ctx.plugin.agents.findByRef(arg);
			if (!agent) {
				const names = ctx.plugin.agents.getAgents().map((a) => a.name).join(', ');
				new Notice(`No agent matching "${arg}"${names ? ` — available: ${names}` : ' — create one in Settings → Agents'}`);
				return true;
			}
			ctx.plugin.conversationStore.setConversationAgent(conv.id, agent.id);
			ctx.refresh();
			new Notice(`${agent.emoji} ${agent.name} — this chat now runs on ${agent.modelId}`);
			return true;
		},
	},
	{
		name: 'skill',
		usage: '/skill [name]',
		description: 'Attach a skill to this chat so its full instructions ride every send (bare = list)',
		run: async (ctx) => {
			if (!ctx.plugin.settings.skillsEnabled) {
				new Notice('Skills are off — enable them in Settings → Skills');
				return true;
			}
			const conv = findConv(ctx.plugin.conversationStore, ctx.conversationId);
			if (!conv) {
				new Notice('No conversation — send a message first');
				return true;
			}
			const { skills } = await ctx.plugin.skills.getSnapshot();
			if (ctx.plugin.settings.skillsEnabled && skills.length === 0) {
				new Notice(`No skills found — add folders with a SKILL.md under ${ctx.plugin.skills.folder()}, or use "Open skills folder" in Settings → Skills`);
				return true;
			}
			const arg = ctx.args.trim();
			const attached = conv.skillIds ?? [];
			if (!arg) {
				const lines = skills.map((s) =>
					`${attached.includes(s.name) ? '[x]' : '[ ]'} ${s.name} — ${s.description}`
				);
				new Notice(`Skills (${attached.length}/${skills.length} attached):\n${lines.join('\n')}`, 10000);
				return true;
			}
			if (arg.toLowerCase() === 'off') {
				ctx.plugin.conversationStore.setConversationSkills(conv.id, undefined);
				ctx.refresh();
				new Notice('Skills detached');
				return true;
			}
			const skill = await ctx.plugin.skills.findSkill(arg);
			if (!skill) {
				new Notice(`No skill matching "${arg}" — available: ${skills.map((s) => s.name).join(', ')}`);
				return true;
			}
			const next = attached.includes(skill.name)
				? attached.filter((id) => id !== skill.name)
				: [...attached, skill.name];
			ctx.plugin.conversationStore.setConversationSkills(conv.id, next);
			ctx.refresh();
			new Notice(next.includes(skill.name)
				? `Skill attached: ${skill.name} — its instructions ride every send`
				: `Skill detached: ${skill.name}`);
			return true;
		},
	},
	{
		name: 'system',
		usage: '/system <text>',
		description: 'Set the system prompt (empty resets to default)',
		run: (ctx) => {
			const text = ctx.args.trim();
			if (!text) {
				ctx.plugin.settings.systemPrompt =
					'You are a helpful AI assistant integrated into Obsidian. Help the user with writing, analysis, coding, and knowledge management.';
				new Notice('System prompt reset to default');
			} else {
				ctx.plugin.settings.systemPrompt = text;
				new Notice('System prompt updated');
			}
			void ctx.plugin.saveSettings();
			return true;
		},
	},
	{
		name: 'stats',
		usage: '/stats',
		description: 'Show conversation stats (tokens, messages)',
		run: (ctx) => {
			const stats = ctx.plugin.conversationStore.getStats();
			// Autocomplete usage is session-only (in-memory) — surfaced here so
			// its background cost is observable without leaving the vault.
			const auto = ctx.plugin.autocompleteUsage;
			const autoLine = auto.requests > 0
				? `\nAutocomplete: ${auto.requests} req · ${auto.tokens.toLocaleString()} tokens (this session)`
				: '';
			new Notice(
				`${stats.totalConversations} conv · ${stats.totalMessages} msgs · ${stats.totalTokens.toLocaleString()} tokens${autoLine}`,
				5000
			);
			return true;
		},
	},
	{
		name: 'help',
		usage: '/help',
		description: 'Show all slash commands',
		run: (ctx) => {
			new SlashHelpModal(ctx.app).open();
			return true;
		},
	},
	{
		name: 'remember',
		usage: '/remember <fact>',
		description: 'Manually save a durable fact to memory',
		run: async (ctx) => {
			const text = ctx.args.trim();
			if (!text) {
				new Notice('Usage: /remember <fact>');
				return true;
			}
			await ctx.plugin.memoryStore.addFact(text);
			new Notice('Saved to memory');
			return true;
		},
	},
	{
		name: 'forget',
		usage: '/forget <substring>',
		description: 'Delete the first memory whose content matches the substring',
		run: async (ctx) => {
			const q = ctx.args.trim().toLowerCase();
			if (!q) {
				new Notice('Usage: /forget <substring>');
				return true;
			}
			const facts = ctx.plugin.memoryStore.getFacts();
			const hit = facts.find((f) => f.content.toLowerCase().includes(q));
			if (!hit) {
				new Notice('No matching memory');
				return true;
			}
			await ctx.plugin.memoryStore.deleteFact(hit.id);
			new Notice(`Forgot: ${hit.content.slice(0, 60)}`);
			return true;
		},
	},
	{
		name: 'memory',
		usage: '/memory',
		description: 'Show remembered facts or open the memory file',
		run: async (ctx) => {
			const facts = ctx.plugin.memoryStore.getFacts();
			if (facts.length === 0) {
				new Notice('Memory is empty');
				return true;
			}
			const sub = ctx.args.trim().toLowerCase();
			if (sub === 'open') {
				await ctx.plugin.memoryStore.ensureFile();
				await ctx.app.workspace.openLinkText(ctx.plugin.settings.memoryFilePath, '', false);
				return true;
			}
			if (sub === 'clear') {
				const count = facts.length;
				const ok = await confirmAction(
					ctx.app,
					'Clear memory?',
					`This deletes all ${count} remembered fact${count === 1 ? '' : 's'}. This cannot be undone.`,
					'Clear memory'
				);
				if (!ok) return true;
				await ctx.plugin.memoryStore.clear();
				new Notice(`Memory cleared — ${count} fact${count === 1 ? '' : 's'} deleted`);
				return true;
			}
			// Default: show a Notice with a short summary.
			const sample = facts.slice(-8).map((f) => `• ${f.content}${f.category ? ` [${f.category}]` : ''}`).join('\n');
			new Notice(`Memory (${facts.length} facts):\n${sample}`, 8000);
			return true;
	},
},
{
	name: 'recap',
	usage: '/recap',
	description: 'Summarize this conversation and log it to the journal',
		run: async (ctx) => {
			// Recap on the pane's lane when the context can resolve it —
			// otherwise runRecap falls back to settings.active*.
			const lane = ctx.resolveSendLane?.() ?? undefined;
			await runRecap(ctx.plugin, ctx.conversationId, ctx.refresh, lane);
			return true;
		},
},
];

/** Very small fuzzy scorer: returns 0 if no chars match, higher = better. */
function fuzzyScore(needle: string, haystack: string): number {
	let score = 0;
	let ni = 0;
	for (let i = 0; i < haystack.length && ni < needle.length; i++) {
		if (haystack[i] === needle[ni]) {
			score += i === 0 || haystack[i - 1] === ' ' || haystack[i - 1] === '/' || haystack[i - 1] === '-' ? 3 : 1;
			ni++;
		}
	}
	return ni === needle.length ? score : 0;
}

/**
 * Try to handle `raw` as a slash command. Returns true if consumed.
 * Caller passes helpers via ctx.
 */
export async function handleSlashCommand(raw: string, ctx: SlashContext): Promise<boolean> {
	const trimmed = raw.trim();
	if (!trimmed.startsWith('/')) return false;
	const space = trimmed.indexOf(' ');
	const name = (space === -1 ? trimmed.slice(1) : trimmed.slice(1, space)).toLowerCase();
	const args = space === -1 ? '' : trimmed.slice(space + 1);
	const cmd = SLASH_COMMANDS.find((c) => c.name === name);
	if (!cmd) return false; // Unknown command — fall through to send
	try {
		return await cmd.run({ ...ctx, raw, args });
	} catch (e) {
		console.error(`[Curtis] /${name} failed:`, e);
		new Notice(`/${name} failed: ${(e as Error).message}`);
		return true;
	}
}

/** Suggestions for the autocomplete dropdown as the user types `/…`. */
export function slashSuggestions(prefix: string): SlashCommand[] {
	const q = prefix.toLowerCase();
	if (!q.startsWith('/')) return [];
	const head = q.slice(1).split(/\s/)[0];
	if (!head) return SLASH_COMMANDS;
	return SLASH_COMMANDS.filter((c) => c.name.startsWith(head));
}
