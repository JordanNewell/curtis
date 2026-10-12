// Regenerate assets/feature-gallery/INDEX.md from the files on disk.
//
// The capture runs recorded a manifest, but partial re-runs overwrote step
// entries and lost history — so the index is built from the tree itself,
// with titles/descriptions from the static map below (kept in step with
// scripts/capture-feature-gallery.mjs).
//
// Usage: node scripts/write-gallery-index.mjs

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const GALLERY = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'feature-gallery');

/** folder → { title, blurb, docs } */
const CATEGORIES = {
	chat: { title: 'Chat core', blurb: 'Conversations, markdown rendering, history, pickers, mentions, images, memory chip — the daily-driver surface.', docs: 'docs/SLASH_COMMANDS.md · docs/MENTIONS.md · docs/IMAGES.md · docs/SEARCH.md' },
	agent: { title: 'Agent & tools', blurb: 'Tool-call cards and real vault tool runs through the agent loop (read_note / create_note / list_notes executed live).', docs: 'docs/AGENT.md' },
	arena: { title: 'Multi-model arena', blurb: 'One prompt streamed to two models side by side — picker, per-column stop, promote-to-chat. Dark and light.', docs: 'docs/ARENA.md' },
	multipane: { title: 'Multi-pane chat', blurb: 'A second chat as a titled tab, or its own OS window — each pane with its own conversation and model.', docs: 'docs/MULTIPANE.md' },
	swarm: { title: 'Swarm mode', blurb: 'A leader chat (badge) spawns Scout, a named-agent follower, in its own pane; the report lands back in the leader thread. Real spawn_agent run.', docs: 'docs/SWARM.md' },
	scheduled: { title: 'Scheduled runs', blurb: 'A daily job in the settings card, fired for real with "Run now" — the headless run lands as a markdown note.', docs: 'docs/SCHEDULED_RUNS.md' },
	terminal: { title: 'Terminal pane', blurb: 'A desktop shell in its own window or tab — fresh shell per command, real output.', docs: 'docs/TERMINAL.md' },
	mcp: { title: 'MCP — client and server', blurb: 'Add external MCP servers as agent tools; Curtis itself serves the vault over localhost MCP; both in settings.', docs: 'docs/MCP_SERVER.md' },
	import: { title: 'Import / export', blurb: 'ChatGPT/Claude imports through the OS file picker, the summary report, Claude Code setup import. Chats land as markdown notes.', docs: 'docs/IMPORT.md' },
	writing: { title: 'Writing tools', blurb: 'Right-click selection actions in the editor, the Cursor-style diff-rewrite modal, and autocomplete ghost text (Tab to accept).', docs: 'docs/SELECTION_ACTIONS.md · docs/DIFF_REWRITE.md · docs/AUTOCOMPLETE.md' },
	voice: { title: 'Voice & notifications', blurb: 'Whisper dictation and read-aloud settings, the composer mic, and completion notifications.', docs: 'docs/VOICE.md · docs/NOTIFICATIONS.md' },
	context: { title: 'Context & memory', blurb: 'Long-term memory (settings + edit modal + the chat chip) and vault retrieval (semantic_search card).', docs: 'docs/MEMORY.md · docs/VAULT_RETRIEVAL.md' },
	providers: { title: 'Providers', blurb: 'The provider configuration surface — 53 built-ins, local Ollama (no key by design), custom OpenAI-compatible endpoints.', docs: 'docs/PROVIDERS.md' },
	settings: { title: 'Settings surface', blurb: 'Every settings group, from Generation to About.', docs: 'docs/RUNBOOK.md' },
	themes: { title: 'Themes', blurb: 'The same conversation full-window in default dark/light plus nine community themes, and composer close-ups in three flagships.', docs: 'default + Minimal, Things, AnuPpuccin, Sanctum, Tokyo Night, Nord, Cybertron, border, Royal Velvet' },
	mobile: { title: 'Phone (390×844 @2x)', blurb: 'The same features reflowed to phone width: chat, pickers, slash menu, arena, themes, settings, and a send video.', docs: 'mobile pass, emulated at phone size' },
	videos: { title: 'Motion demos', blurb: 'Short captures of live flows — streamed replies, slash→model, mentions, search, agent tools, a real shell, arena duels, live theme switches, diff-rewrite accept, autocomplete accept, memory edits.', docs: 'MP4 (+GIF for README embedding)' },
};

/** Specific file overrides: relative path → [title, description]. Anything
 *  unmapped gets a prettified filename as the title. */
const FILES = {
	'chat/conversation-dark.png': ['Conversation — default dark', 'Markdown answer with a table, a link favicon, provider/model pill and token count; a daily note open behind the chat.'],
	'chat/markdown-code-table.png': ['Markdown rendering', 'A fenced code block and launch checklist rendered inside an answer.'],
	'chat/history-dropdown.png': ['Conversation history', 'Every chat is a persisted, searchable markdown note — dropdown with message counts and dates.'],
	'chat/model-picker.png': ['Model picker', 'Fuzzy model picker across every enabled provider — 53 built-ins plus custom endpoints.'],
	'chat/slash-menu.png': ['Slash command menu', 'Typing "/" opens the 20-command menu: clear, regen, model, agent, leader, export, prompt library…'],
	'chat/prompt-library.png': ['Prompt library', 'The /prompt picker over saved, reusable prompts.'],
	'chat/mention-popup.png': ['@-mention popup', 'Typing "@" fuzzy-searches the vault; picking a note attaches it as context.'],
	'chat/mention-pill.png': ['Attached-note pill', 'A sent message with an @-attached note — the content went to the model, the pill names the file.'],
	'chat/image-attachment.png': ['Image attachment', 'A pasted chart on the user bubble; a vision answer below.'],
	'chat/memory-chip.png': ['Memory chip', 'The "memories" badge on a turn that drew on long-term memory.'],
	'chat/new-chat-empty.png': ['New chat', 'The empty state: provider pill, composer, vault behind.'],
	'agent/tool-cards-seeded.png': ['Tool-call cards', 'read_note called inside a chat — tool, arguments, and result as cards (seeded render).'],
	'agent/tool-run-live.png': ['Live agent tool run', 'A real agent turn: the model calls read_note, the tool executes against the vault, the answer cites the result.'],
	'agent/note-created-live.png': ['Live vault write', 'create_note executes for real — the note lands in the vault and opens beside the tool card that made it.'],
	'arena/arena-picker.png': ['Arena picker', 'Choose the second duelist; the first is the active model.'],
	'arena/arena-streaming-dark.png': ['Arena duel — dark', 'Both columns streaming at different paces; per-column stop buttons.'],
	'arena/arena-stopped.png': ['Per-column stop', 'One column stopped mid-flight; the other keeps streaming.'],
	'arena/arena-final-dark.png': ['Arena duel finished', 'Both answers side by side with token counts.'],
	'arena/arena-promoted.png': ['Promote to chat', 'The winning answer promoted into a normal conversation.'],
	'arena/arena-streaming-light.png': ['Arena duel — light', 'The same duel in default light.'],
	'multipane/multipane-tabs.png': ['Chat tabs', 'Two conversations as titled tabs in one split.'],
	'multipane/multipane-popout-window.png': ['Popout window', 'A chat in its own OS window.'],
	'swarm/leader-badge.png': ['Leader badge', 'The current chat marked as swarm leader with /leader.'],
	'swarm/follower-running.png': ['spawn_agent called', 'The leader delegates; the spawn_agent card shows the task handed to the follower.'],
	'swarm/follower-pane.png': ['Follower pane (Scout)', 'The follower — named agent "Scout" — works its subtask in its own pane and conversation.'],
	'swarm/report-in-leader.png': ['Report back', 'The follower report returns as the tool result; the leader synthesizes.'],
	'scheduled/scheduled-runs-card.png': ['Scheduled runs card', 'A daily job in settings: prompt, cadence, enable.'],
	'scheduled/run-note.png': ['Landed run note', 'A real manual fire — the headless run wrote its markdown note under AI/Scheduled/.'],
	'scheduled/scheduled-runs-card-after.png': ['Status after the run', 'The job row shows last-run status and duration.'],
	'terminal/terminal-window.png': ['Terminal — own window', 'The shell in its own OS window.'],
	'terminal/terminal-pane.png': ['Terminal — tab', 'Real shell output in a tab (`dir /b Daily`).'],
	'mcp/mcp-client-servers.png': ['MCP client — servers', 'Connect to MCP servers you already run and offer their tools to agents.'],
	'mcp/mcp-add-server-modal.png': ['Add MCP server', 'Streamable HTTP endpoint, headers, auth.'],
	'mcp/mcp-server-settings.png': ['Curtis as an MCP server', 'Serve the vault (and named agents) over localhost MCP for Claude Desktop and coding agents.'],
	'import/import-summary.png': ['Import report', 'The summary modal after an import run — dedup reported honestly.'],
	'import/imported-conversation-note.png': ['Imported chat as a note', 'Every imported conversation lands as a markdown note under AI/Conversations/.'],
	'import/claude-setup-import.png': ['Import from Claude Code', 'One click: MCP servers, skills, subagents, CLAUDE.md — imported disabled for review.'],
	'writing/selection-context-menu.png': ['Selection actions menu', 'Right-click any selection: explain, summarize, refactor — plus "Summarize this note" and "Chat about this note".'],
	'writing/diff-rewrite-modal.png': ['Diff rewrite modal', 'Cursor-style word-level diff — Accept or Reject before anything touches the note.'],
	'writing/autocomplete-ghost.png': ['Autocomplete ghost text', 'Ghost suggestion while typing in a note (dedicated model, off by default).'],
	'voice/composer-mic.png': ['Composer mic', 'Whisper dictation in the composer.'],
	'voice/voice-settings.png': ['Voice settings', 'Read-aloud: pick your voice, default rate, sentence player.'],
	'voice/notification-settings.png': ['Notification settings', 'System toast when a reply lands while you are away; in-app notice fallback on mobile.'],
	'context/memory-settings.png': ['Memory settings', 'Markdown-file-backed memory: capture modes and fact rows.'],
	'context/memory-edit-modal.png': ['Edit a memory fact', 'Facts are editable in place — the file stays human-readable.'],
	'context/rag-semantic-search-card.png': ['semantic_search tool card', 'Vault retrieval: the hybrid index surfaces excerpts as a tool card (seeded render).'],
	'providers/providers-configuration.png': ['Provider configuration', 'All 53 built-in providers with enable toggles, key scheme, and default models.'],
	'providers/provider-ollama.png': ['Ollama — local, keyless', 'Local providers never ask for an API key.'],
	'providers/custom-provider-modal.png': ['Custom provider', 'Any OpenAI-compatible endpoint: URL, auth, model list.'],
	'settings/gcp-connection.png': ['GCP connection', 'Read-only Cloud Storage on your Google Cloud project via service-account key.'],
	'mobile/chat-top.png': ['Phone — conversation', 'The full chat at 390×844: bubbles, pills, day separators, composer.'],
	'mobile/chat-bottom.png': ['Phone — composer', 'The input zone and last reply at phone width.'],
	'mobile/history.png': ['Phone — history', 'Conversation history as a sheet.'],
	'mobile/model-picker.png': ['Phone — model picker', 'Model switching at phone width.'],
	'mobile/slash-menu.png': ['Phone — slash menu', 'The 20-command menu reflowed.'],
	'mobile/mention-popup.png': ['Phone — @-mention', 'Note search at phone width.'],
	'mobile/arena-picker.png': ['Phone — arena picker', 'Pick the second duelist on mobile.'],
	'mobile/arena-streaming.png': ['Phone — arena duel', 'Columns stack and stream at phone width.'],
	'mobile/theme-light.png': ['Phone — default light', 'Default light at phone width.'],
	'mobile/theme-minimal.png': ['Phone — Minimal', 'Minimal at phone width.'],
	'mobile/theme-royal-velvet.png': ['Phone — Royal Velvet', 'Royal Velvet at phone width.'],
	'mobile/settings-providers.png': ['Phone — provider settings', 'The provider list emulated at phone width.'],
	'mobile/settings-scheduled.png': ['Phone — scheduled runs', 'The jobs card emulated at phone width.'],
	'mobile/videos/phone-chat-send.mp4': ['Phone — send + stream (video)', 'Typing, sending, and a streamed reply at phone width.'],
};

const titleize = (rel) => {
	const base = rel.split('/').pop().replace(/\.(png|mp4|gif)$/, '');
	return base.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
};

function walk(dir, out = []) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (/\.(png|mp4|gif)$/.test(e.name) && e.name !== 'INDEX.md') out.push(p);
	}
	return out;
}

const files = walk(GALLERY)
	.map((p) => relative(GALLERY, p).split('\\').join('/'))
	.sort();

const byCategory = new Map();
for (const f of files) {
	const cat = f.includes('/') ? f.split('/')[0] : 'root';
	if (!byCategory.has(cat)) byCategory.set(cat, []);
	byCategory.get(cat).push(f);
}

const lines = [
	'# Curtis AI Chat — feature gallery',
	'',
	`Auto-captured ${new Date().toISOString().slice(0, 10)} from live Obsidian sessions on the demo vault — real UI, real conversation store, real shells, real tool execution.`,
	'',
	'How to read the proofs:',
	'',
	'- **Rendered stills** of fixture conversations go through the real view and renderer — same pixels a user gets.',
	'- **Live scenes** (streaming replies, arena duels, agent tool runs, swarm spawn, scheduled fires, terminal, diff rewrites, autocomplete) ran through the plugin’s real pipelines against a local OpenAI-compatible mock endpoint — real transport, real SSE, real tool loop, deterministic takes, no keys, no flaky network in the shots.',
	'- Phone captures are the desktop build emulated at 390×844 @2x DPR — the exact layout Obsidian’s phone sizing produces.',
	'',
	`${files.filter((f) => f.endsWith('.png')).length} stills · ${files.filter((f) => f.endsWith('.mp4')).length} videos (+${files.filter((f) => f.endsWith('.gif')).length} GIFs) across ${byCategory.size - (byCategory.has('root') ? 1 : 0)} categories.`,
	'',
	'| Category | Coverage | Reference |',
	'|---|---|---|',
];
for (const [cat, meta] of Object.entries(CATEGORIES)) {
	const list = byCategory.get(cat) ?? [];
	if (!list.length) continue;
	const vids = list.filter((f) => f.endsWith('.mp4')).length;
	lines.push(`| **${meta.title}** | ${list.length - vids} stills, ${vids} videos | ${meta.docs} |`);
}
lines.push('', '---', '');

for (const [cat, meta] of Object.entries(CATEGORIES)) {
	const list = byCategory.get(cat);
	if (!list?.length) continue;
	lines.push(`## ${meta.title}`, '', meta.blurb, '', `*Docs: ${meta.docs}*`, '');
	for (const f of list) {
		if (f.endsWith('.gif')) continue;
		const [title, desc] = FILES[f] ?? [titleize(f), ''];
		const label = desc ? `${title} — ${desc}` : title;
		if (f.endsWith('.mp4')) lines.push(`- 🎬 [${label}](./${f}) (+ [GIF](./${f.replace(/\.mp4$/, '.gif')}))`);
		else lines.push(`- 🖼️ [${label}](./${f})`);
	}
	lines.push('');
}

lines.push('---', '', 'Capture harness: [`scripts/capture-feature-gallery.mjs`](../../scripts/capture-feature-gallery.mjs) — re-runnable per category with `ONLY=chat,arena node scripts/capture-feature-gallery.mjs`.');
writeFileSync(resolve(GALLERY, 'INDEX.md'), lines.join('\n'));
console.log(`[gallery-index] ${files.length} assets indexed → INDEX.md`);
