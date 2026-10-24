# Curtis.ai — feature gallery

Auto-captured 2026-10-11 from live Obsidian sessions on the demo vault — real UI, real conversation store, real shells, real tool execution.

How to read the proofs:

- **Rendered stills** of fixture conversations go through the real view and renderer — same pixels a user gets.
- **Live scenes** (streaming replies, arena duels, agent tool runs, swarm spawn, scheduled fires, terminal, diff rewrites, autocomplete) ran through the plugin’s real pipelines against a local OpenAI-compatible mock endpoint — real transport, real SSE, real tool loop, deterministic takes, no keys, no flaky network in the shots.
- Phone captures are the desktop build emulated at 390×844 @2x DPR — the exact layout Obsidian’s phone sizing produces.

88 stills · 13 videos (+13 GIFs) across 17 categories.

| Category | Coverage | Reference |
|---|---|---|
| **Chat core** | 11 stills, 0 videos | docs/SLASH_COMMANDS.md · docs/MENTIONS.md · docs/IMAGES.md · docs/SEARCH.md |
| **Agent & tools** | 3 stills, 0 videos | docs/AGENT.md |
| **Multi-model arena** | 6 stills, 0 videos | docs/ARENA.md |
| **Multi-pane chat** | 2 stills, 0 videos | docs/MULTIPANE.md |
| **Swarm mode** | 4 stills, 0 videos | docs/SWARM.md |
| **Scheduled runs** | 3 stills, 0 videos | docs/SCHEDULED_RUNS.md |
| **Terminal pane** | 3 stills, 0 videos | docs/TERMINAL.md |
| **MCP — client and server** | 3 stills, 0 videos | docs/MCP_SERVER.md |
| **Import / export** | 2 stills, 0 videos | docs/IMPORT.md |
| **Writing tools** | 3 stills, 0 videos | docs/SELECTION_ACTIONS.md · docs/DIFF_REWRITE.md · docs/AUTOCOMPLETE.md |
| **Voice & notifications** | 3 stills, 0 videos | docs/VOICE.md · docs/NOTIFICATIONS.md |
| **Context & memory** | 3 stills, 0 videos | docs/MEMORY.md · docs/VAULT_RETRIEVAL.md |
| **Providers** | 3 stills, 0 videos | docs/PROVIDERS.md |
| **Settings surface** | 12 stills, 0 videos | docs/RUNBOOK.md |
| **Themes** | 14 stills, 0 videos | default + Minimal, Things, AnuPpuccin, Sanctum, Tokyo Night, Nord, Cybertron, border, Royal Velvet |
| **Phone (390×844 @2x)** | 14 stills, 1 videos | mobile pass, emulated at phone size |
| **Motion demos** | 12 stills, 12 videos | MP4 (+GIF for README embedding) |

---

## Chat core

Conversations, markdown rendering, history, pickers, mentions, images, memory chip — the daily-driver surface.

*Docs: docs/SLASH_COMMANDS.md · docs/MENTIONS.md · docs/IMAGES.md · docs/SEARCH.md*

- 🖼️ [Conversation — default dark — Markdown answer with a table, a link favicon, provider/model pill and token count; a daily note open behind the chat.](./chat/conversation-dark.png)
- 🖼️ [Conversation history — Every chat is a persisted, searchable markdown note — dropdown with message counts and dates.](./chat/history-dropdown.png)
- 🖼️ [Image attachment — A pasted chart on the user bubble; a vision answer below.](./chat/image-attachment.png)
- 🖼️ [Markdown rendering — A fenced code block and launch checklist rendered inside an answer.](./chat/markdown-code-table.png)
- 🖼️ [Memory chip — The "memories" badge on a turn that drew on long-term memory.](./chat/memory-chip.png)
- 🖼️ [Attached-note pill — A sent message with an @-attached note — the content went to the model, the pill names the file.](./chat/mention-pill.png)
- 🖼️ [@-mention popup — Typing "@" fuzzy-searches the vault; picking a note attaches it as context.](./chat/mention-popup.png)
- 🖼️ [Model picker — Fuzzy model picker across every enabled provider — 53 built-ins plus custom endpoints.](./chat/model-picker.png)
- 🖼️ [New chat — The empty state: provider pill, composer, vault behind.](./chat/new-chat-empty.png)
- 🖼️ [Prompt library — The /prompt picker over saved, reusable prompts.](./chat/prompt-library.png)
- 🖼️ [Slash command menu — Typing "/" opens the 20-command menu: clear, regen, model, agent, leader, export, prompt library…](./chat/slash-menu.png)

## Agent & tools

Tool-call cards and real vault tool runs through the agent loop (read_note / create_note / list_notes executed live).

*Docs: docs/AGENT.md*

- 🖼️ [Live vault write — create_note executes for real — the note lands in the vault and opens beside the tool card that made it.](./agent/note-created-live.png)
- 🖼️ [Tool-call cards — read_note called inside a chat — tool, arguments, and result as cards (seeded render).](./agent/tool-cards-seeded.png)
- 🖼️ [Live agent tool run — A real agent turn: the model calls read_note, the tool executes against the vault, the answer cites the result.](./agent/tool-run-live.png)

## Multi-model arena

One prompt streamed to two models side by side — picker, per-column stop, promote-to-chat. Dark and light.

*Docs: docs/ARENA.md*

- 🖼️ [Arena duel finished — Both answers side by side with token counts.](./arena/arena-final-dark.png)
- 🖼️ [Arena picker — Choose the second duelist; the first is the active model.](./arena/arena-picker.png)
- 🖼️ [Promote to chat — The winning answer promoted into a normal conversation.](./arena/arena-promoted.png)
- 🖼️ [Per-column stop — One column stopped mid-flight; the other keeps streaming.](./arena/arena-stopped.png)
- 🖼️ [Arena duel — dark — Both columns streaming at different paces; per-column stop buttons.](./arena/arena-streaming-dark.png)
- 🖼️ [Arena duel — light — The same duel in default light.](./arena/arena-streaming-light.png)

## Multi-pane chat

A second chat as a titled tab, or its own OS window — each pane with its own conversation and model.

*Docs: docs/MULTIPANE.md*

- 🖼️ [Popout window — A chat in its own OS window.](./multipane/multipane-popout-window.png)
- 🖼️ [Chat tabs — Two conversations as titled tabs in one split.](./multipane/multipane-tabs.png)

## Swarm mode

A leader chat (badge) spawns Scout, a named-agent follower, in its own pane; the report lands back in the leader thread. Real spawn_agent run.

*Docs: docs/SWARM.md*

- 🖼️ [Follower pane (Scout) — The follower — named agent "Scout" — works its subtask in its own pane and conversation.](./swarm/follower-pane.png)
- 🖼️ [spawn_agent called — The leader delegates; the spawn_agent card shows the task handed to the follower.](./swarm/follower-running.png)
- 🖼️ [Leader badge — The current chat marked as swarm leader with /leader.](./swarm/leader-badge.png)
- 🖼️ [Report back — The follower report returns as the tool result; the leader synthesizes.](./swarm/report-in-leader.png)

## Scheduled runs

A daily job in the settings card, fired for real with "Run now" — the headless run lands as a markdown note.

*Docs: docs/SCHEDULED_RUNS.md*

- 🖼️ [Landed run note — A real manual fire — the headless run wrote its markdown note under AI/Scheduled/.](./scheduled/run-note.png)
- 🖼️ [Status after the run — The job row shows last-run status and duration.](./scheduled/scheduled-runs-card-after.png)
- 🖼️ [Scheduled runs card — A daily job in settings: prompt, cadence, enable.](./scheduled/scheduled-runs-card.png)

## Terminal pane

A desktop shell in its own window or tab — fresh shell per command, real output.

*Docs: docs/TERMINAL.md*

- 🖼️ [Terminal — tab — Real shell output in a tab (`dir /b Daily`).](./terminal/terminal-pane.png)
- 🖼️ [Terminal Tab](./terminal/terminal-tab.png)
- 🖼️ [Terminal — own window — The shell in its own OS window.](./terminal/terminal-window.png)

## MCP — client and server

Add external MCP servers as agent tools; Curtis itself serves the vault over localhost MCP; both in settings.

*Docs: docs/MCP_SERVER.md*

- 🖼️ [Add MCP server — Streamable HTTP endpoint, headers, auth.](./mcp/mcp-add-server-modal.png)
- 🖼️ [MCP client — servers — Connect to MCP servers you already run and offer their tools to agents.](./mcp/mcp-client-servers.png)
- 🖼️ [Curtis as an MCP server — Serve the vault (and named agents) over localhost MCP for Claude Desktop and coding agents.](./mcp/mcp-server-settings.png)

## Import / export

ChatGPT/Claude imports through the OS file picker, the summary report, Claude Code setup import. Chats land as markdown notes.

*Docs: docs/IMPORT.md*

- 🖼️ [Import from Claude Code — One click: MCP servers, skills, subagents, CLAUDE.md — imported disabled for review.](./import/claude-setup-import.png)
- 🖼️ [Import report — The summary modal after an import run — dedup reported honestly.](./import/import-summary.png)

## Writing tools

Right-click selection actions in the editor, the Cursor-style diff-rewrite modal, and autocomplete ghost text (Tab to accept).

*Docs: docs/SELECTION_ACTIONS.md · docs/DIFF_REWRITE.md · docs/AUTOCOMPLETE.md*

- 🖼️ [Autocomplete ghost text — Ghost suggestion while typing in a note (dedicated model, off by default).](./writing/autocomplete-ghost.png)
- 🖼️ [Diff rewrite modal — Cursor-style word-level diff — Accept or Reject before anything touches the note.](./writing/diff-rewrite-modal.png)
- 🖼️ [Selection actions menu — Right-click any selection: explain, summarize, refactor — plus "Summarize this note" and "Chat about this note".](./writing/selection-context-menu.png)

## Voice & notifications

Whisper dictation and read-aloud settings, the composer mic, and completion notifications.

*Docs: docs/VOICE.md · docs/NOTIFICATIONS.md*

- 🖼️ [Composer mic — Whisper dictation in the composer.](./voice/composer-mic.png)
- 🖼️ [Notification settings — System toast when a reply lands while you are away; in-app notice fallback on mobile.](./voice/notification-settings.png)
- 🖼️ [Voice settings — Read-aloud: pick your voice, default rate, sentence player.](./voice/voice-settings.png)

## Context & memory

Long-term memory (settings + edit modal + the chat chip) and vault retrieval (semantic_search card).

*Docs: docs/MEMORY.md · docs/VAULT_RETRIEVAL.md*

- 🖼️ [Edit a memory fact — Facts are editable in place — the file stays human-readable.](./context/memory-edit-modal.png)
- 🖼️ [Memory settings — Markdown-file-backed memory: capture modes and fact rows.](./context/memory-settings.png)
- 🖼️ [semantic_search tool card — Vault retrieval: the hybrid index surfaces excerpts as a tool card (seeded render).](./context/rag-semantic-search-card.png)

## Providers

The provider configuration surface — 53 built-ins, local Ollama (no key by design), custom OpenAI-compatible endpoints.

*Docs: docs/PROVIDERS.md*

- 🖼️ [Custom provider — Any OpenAI-compatible endpoint: URL, auth, model list.](./providers/custom-provider-modal.png)
- 🖼️ [Ollama — local, keyless — Local providers never ask for an API key.](./providers/provider-ollama.png)
- 🖼️ [Provider configuration — All 53 built-in providers with enable toggles, key scheme, and default models.](./providers/providers-configuration.png)

## Settings surface

Every settings group, from Generation to About.

*Docs: docs/RUNBOOK.md*

- 🖼️ [About](./settings/about.png)
- 🖼️ [Active Provider](./settings/active-provider.png)
- 🖼️ [Agent](./settings/agent.png)
- 🖼️ [Agents](./settings/agents.png)
- 🖼️ [Autocomplete](./settings/autocomplete.png)
- 🖼️ [Chat Ui](./settings/chat-ui.png)
- 🖼️ [Conversations](./settings/conversations.png)
- 🖼️ [GCP connection — Read-only Cloud Storage on your Google Cloud project via service-account key.](./settings/gcp-connection.png)
- 🖼️ [Generation](./settings/generation.png)
- 🖼️ [Notes](./settings/notes.png)
- 🖼️ [Skills](./settings/skills.png)
- 🖼️ [Terminal](./settings/terminal.png)

## Themes

The same conversation full-window in default dark/light plus nine community themes, and composer close-ups in three flagships.

*Docs: default + Minimal, Things, AnuPpuccin, Sanctum, Tokyo Night, Nord, Cybertron, border, Royal Velvet*

- 🖼️ [Chat Anuppuccin](./themes/chat-anuppuccin.png)
- 🖼️ [Chat Border](./themes/chat-border.png)
- 🖼️ [Chat Cybertron](./themes/chat-cybertron.png)
- 🖼️ [Chat Dark](./themes/chat-dark.png)
- 🖼️ [Chat Light](./themes/chat-light.png)
- 🖼️ [Chat Minimal](./themes/chat-minimal.png)
- 🖼️ [Chat Nord](./themes/chat-nord.png)
- 🖼️ [Chat Royal Velvet](./themes/chat-royal-velvet.png)
- 🖼️ [Chat Sanctum](./themes/chat-sanctum.png)
- 🖼️ [Chat Things](./themes/chat-things.png)
- 🖼️ [Chat Tokyo Night](./themes/chat-tokyo-night.png)
- 🖼️ [Composer Dark](./themes/composer-dark.png)
- 🖼️ [Composer Minimal](./themes/composer-minimal.png)
- 🖼️ [Composer Royal Velvet](./themes/composer-royal-velvet.png)

## Phone (390×844 @2x)

The same features reflowed to phone width: chat, pickers, slash menu, arena, themes, settings, and a send video.

*Docs: mobile pass, emulated at phone size*

- 🖼️ [Phone — arena picker — Pick the second duelist on mobile.](./mobile/arena-picker.png)
- 🖼️ [Phone — arena duel — Columns stack and stream at phone width.](./mobile/arena-streaming.png)
- 🖼️ [Phone — composer — The input zone and last reply at phone width.](./mobile/chat-bottom.png)
- 🖼️ [Phone — conversation — The full chat at 390×844: bubbles, pills, day separators, composer.](./mobile/chat-top.png)
- 🖼️ [Phone — history — Conversation history as a sheet.](./mobile/history.png)
- 🖼️ [Phone — @-mention — Note search at phone width.](./mobile/mention-popup.png)
- 🖼️ [Phone — model picker — Model switching at phone width.](./mobile/model-picker.png)
- 🖼️ [Phone — provider settings — The provider list emulated at phone width.](./mobile/settings-providers.png)
- 🖼️ [Phone — scheduled runs — The jobs card emulated at phone width.](./mobile/settings-scheduled.png)
- 🖼️ [Phone — slash menu — The 20-command menu reflowed.](./mobile/slash-menu.png)
- 🖼️ [Phone — default light — Default light at phone width.](./mobile/theme-light.png)
- 🖼️ [Phone — Minimal — Minimal at phone width.](./mobile/theme-minimal.png)
- 🖼️ [Phone — Royal Velvet — Royal Velvet at phone width.](./mobile/theme-royal-velvet.png)
- 🎬 [Phone — send + stream (video) — Typing, sending, and a streamed reply at phone width.](./mobile/videos/phone-chat-send.mp4) (+ [GIF](./mobile/videos/phone-chat-send.gif))

## Motion demos

Short captures of live flows — streamed replies, slash→model, mentions, search, agent tools, a real shell, arena duels, live theme switches, diff-rewrite accept, autocomplete accept, memory edits.

*Docs: MP4 (+GIF for README embedding)*

- 🎬 [Agent Tool Run](./videos/agent-tool-run.mp4) (+ [GIF](./videos/agent-tool-run.gif))
- 🎬 [Arena Duel](./videos/arena-duel.mp4) (+ [GIF](./videos/arena-duel.gif))
- 🎬 [Autocomplete Tab Accept](./videos/autocomplete-tab-accept.mp4) (+ [GIF](./videos/autocomplete-tab-accept.gif))
- 🎬 [Chat Send Stream](./videos/chat-send-stream.mp4) (+ [GIF](./videos/chat-send-stream.gif))
- 🎬 [Diff Rewrite Accept](./videos/diff-rewrite-accept.mp4) (+ [GIF](./videos/diff-rewrite-accept.gif))
- 🎬 [Memory Edit](./videos/memory-edit.mp4) (+ [GIF](./videos/memory-edit.gif))
- 🎬 [Mention Note](./videos/mention-note.mp4) (+ [GIF](./videos/mention-note.gif))
- 🎬 [Multipane Tabs](./videos/multipane-tabs.mp4) (+ [GIF](./videos/multipane-tabs.gif))
- 🎬 [Search Conversations](./videos/search-conversations.mp4) (+ [GIF](./videos/search-conversations.gif))
- 🎬 [Slash Commands Model Picker](./videos/slash-commands-model-picker.mp4) (+ [GIF](./videos/slash-commands-model-picker.gif))
- 🎬 [Terminal Shell](./videos/terminal-shell.mp4) (+ [GIF](./videos/terminal-shell.gif))
- 🎬 [Theme Switch](./videos/theme-switch.mp4) (+ [GIF](./videos/theme-switch.gif))

---

Capture harness: [`scripts/capture-feature-gallery.mjs`](../../scripts/capture-feature-gallery.mjs) — re-runnable per category with `ONLY=chat,arena node scripts/capture-feature-gallery.mjs`.