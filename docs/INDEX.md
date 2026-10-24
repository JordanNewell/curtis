# Curtis.ai docs

Reference documentation for every feature. Start here, follow links to the detail you need.

> [!TIP]
> New to the plugin? The [README](../README.md#quick-start) has a 60-second quick start. Come back here when you need the details.

## Features

| Doc | What it covers |
|---|---|
| 🎭 **[HARNESS.md](HARNESS.md)** | Harness profiles — the base contract composed under every system prompt. Two built-ins (Curtis, plain assistant), custom profiles, the injection fence, and vault-native link style. |
| 🤖 **[AGENT.md](AGENT.md)** | Agent tools — the tool loop chats run on. Read/create/edit vault notes, twelve built-in tools, every provider, plus MCP servers. |
| ☁️ **[GCP.md](GCP.md)** | GCP connector — read-only Cloud Storage on your Google Cloud project via service-account key, as agent tools. |
| 🎭 **[AGENTS.md](AGENTS.md)** | Named agents — reusable worker configs: persona + model routing + tool ceilings. Bind to any chat with `/agent`, spawn as swarm specialists. |
| 🧩 **[SKILLS.md](SKILLS.md)** | Skills — the open Agent Skills standard in your vault: folders with a SKILL.md, discovered by description, loaded on demand in every arena. Portable to and from other skills-compatible agents. |
| 👑 **[SWARM.md](SWARM.md)** | Swarm mode — mark a chat as leader and it spawns follower agents that work subtasks in their own panes and report back. |
| ⏰ **[SCHEDULED_RUNS.md](SCHEDULED_RUNS.md)** | Scheduled runs — put a prompt or a named agent on a cadence (daily at a time, or every N minutes); each headless run lands as a markdown note. Fires while Obsidian is open; missed daily runs catch up on launch. |
| 🛰️ **[MCP_SERVER.md](MCP_SERVER.md)** | MCP server — serve the vault and your named agents as tools on localhost so Claude Desktop, coding agents, and any MCP client can search/read (and optionally write) your notes, or hire an agent. |
| 🧩 **[PLUGIN_API.md](PLUGIN_API.md)** | Plugin API — other Obsidian plugins call Curtis: headless agent chat, vault reads/searches, memory. |
| ⚔️ **[ARENA.md](ARENA.md)** | Multi-model arena — stream one prompt to 2–4 models in parallel. Promote-to-chat workflow. |
| 🪟 **[MULTIPANE.md](MULTIPANE.md)** | Multi-pane chat — another chat as a tab or its own OS window. Per-pane conversation, provider, model; titled tabs. |
| ⛁ **[TERMINAL.md](TERMINAL.md)** | Terminal pane — a desktop shell in its own optional window, plus the opt-in `run_command` agent tool with per-command approval. |
| 📥 **[IMPORT.md](IMPORT.md)** | Chat importer — ChatGPT/Claude exports, `.curt` files, role-labeled JSON/markdown. Plus one-click **Import from Claude Code**: MCP servers, skills, subagents, CLAUDE.md. Bulk `.curt` zip export and a full backup zip (chats + prompts + harnesses + settings, keys stripped). Every conversation is a markdown note in `AI/Conversations/`. |
| 🔗 **[LINK_PREVIEWS.md](LINK_PREVIEWS.md)** | Link previews — favicons on external links (one toggle; off keeps rendering fully local) and tappable vault paths in assistant prose. |
| 🎨 **[DIFF_REWRITE.md](DIFF_REWRITE.md)** | Inline diff rewrite — Cursor-style Accept/Reject diff modal. Assignable hotkey. |
| ✍️ **[AUTOCOMPLETE.md](AUTOCOMPLETE.md)** | Inline autocomplete — ghost-text suggestions while typing in notes. Tab to accept, dedicated model, default off. |
| 🎙️ **[VOICE.md](VOICE.md)** | Voice I/O — dictation on OpenAI, Groq, or any OpenAI-compatible endpoint; read-aloud with a sentence player: system voices or a neural engine on your OpenAI key, pick your voice, default rate, karaoke highlight, persisted auto-speak. |
| 🔔 **[NOTIFICATIONS.md](NOTIFICATIONS.md)** | Desktop notifications — a system toast when a response finishes or fails while you're away from the pane; click to jump back to the exact chat. Off by default; in-app notice fallback on mobile. |
| @ **[MENTIONS.md](MENTIONS.md)** | `@`-mention vault notes — fuzzy-search, attach as context. Active-note pill. |
| 🔍 **[SEARCH.md](SEARCH.md)** | Cross-conversation search — fuzzy search across all conversations + messages. Assignable hotkey. |
| 🖼️ **[IMAGES.md](IMAGES.md)** | Image attachments — paste, drag, or paperclip. Vision-capable models. |
| 🧠 **[MEMORY.md](MEMORY.md)** | Long-term memory — markdown-file-backed. Auto-capture, manual recall, edit UI. |
| 📐 **[VAULT_RETRIEVAL.md](VAULT_RETRIEVAL.md)** | Vault retrieval (RAG) — hybrid index over your notes (embeddings fused with BM25 keyword search); relevant excerpts auto-injected into every prompt, plus the `semantic_search` agent tool. Off by default; local embeddings supported. |
| ✂️ **[SELECTION_ACTIONS.md](SELECTION_ACTIONS.md)** | Inline note transformations — explain, summarize, refactor, etc. Right-click in any note. |
| ⌨️ **[SLASH_COMMANDS.md](SLASH_COMMANDS.md)** | 21 slash commands — `/clear`, `/regen`, `/prompt`, `/model`, `/memory`, `/agent`, `/skill`, `/leader`, `/export`, etc. Plus the prompt library behind `/prompt`. |
| ❓ **[FAQ.md](FAQ.md)** | FAQ & troubleshooting — the questions that actually come up: tool calling not working, missing models, what leaves your machine, where chats live, silent TTS, unfired schedules. |

## Configuration

| Doc | What it covers |
|---|---|
| 🔌 **[PROVIDERS.md](PROVIDERS.md)** | 53 built-in providers, custom endpoints, per-provider auth and quirks, advanced request parameters. Agent compatibility column. |

## Project

| Doc | What it covers |
|---|---|
| 📦 **[README](../README.md)** | Overview, install, quick start, feature summary, mobile notes. |
| 📝 **[CHANGELOG](../CHANGELOG.md)** | All notable changes per release. Keep-a-Changelog format. |
| 🛠️ **[CONTRIBUTING](../CONTRIBUTING.md)** | Dev setup, project structure, code style, audit checklist, how to add providers/tools/commands. |
| 🎛️ **[RUNBOOK](RUNBOOK.md)** | The complete field guide — every feature and all 24 settings groups with runtime details, defaults, and tips; slash-command/hotkey cheat sheets, the numbers wall, troubleshooting, and the maintainer's mission-control appendix. |
| ⚖️ **[LICENSE](../LICENSE)** | BUSL-1.1. Free to use; competing products need a commercial license; converts to Apache-2.0 four years per version. |

## By use case

**"I want to chat with my notes."**
→ [MENTIONS.md](MENTIONS.md) for `@`-attaching notes, [AGENT.md](AGENT.md) for vault-modifying tools

**"I want to compare models."**
→ [ARENA.md](ARENA.md) for parallel streaming, [PROVIDERS.md](PROVIDERS.md) for the full provider list

**"I want two chats at once."**
→ [MULTIPANE.md](MULTIPANE.md) for splits and popout windows

**"I want agents working for me in parallel."**
→ [SWARM.md](SWARM.md) for leader mode and follower agents

**"I want Curtis to run while I'm away."**
→ [SCHEDULED_RUNS.md](SCHEDULED_RUNS.md) for a prompt or agent on a daily/interval cadence, [NOTIFICATIONS.md](NOTIFICATIONS.md) to get pinged when a background response lands

**"I want Claude Desktop (or any AI app) working in my vault."**
→ [MCP_SERVER.md](MCP_SERVER.md) for serving the vault over localhost MCP

**"I'm writing an Obsidian plugin that needs AI."**
→ [PLUGIN_API.md](PLUGIN_API.md) for the public `api` object

**"I want Curtis to read my cloud files."**
→ [GCP.md](GCP.md) for the GCP connector and its read-only Cloud Storage tools

**"I want different AI workers with different jobs."**
→ [AGENTS.md](AGENTS.md) for named agents — personas, model routing, tool ceilings

**"I want to teach Curtis a reusable procedure."**
→ [SKILLS.md](SKILLS.md) for vault skills — write once, load on demand, portable to other agents

**"I want a shell next to my notes — or agents that can run one."**
→ [TERMINAL.md](TERMINAL.md) for the terminal pane and the command tool

**"I'm bringing my history over from ChatGPT or Claude."**
→ [IMPORT.md](IMPORT.md) for the importer and the `.curt` format

**"I use Claude Code and want my setup here."**
→ [IMPORT.md](IMPORT.md#import-from-claude-code-desktop) for the one-click bring-over — MCP servers, skills, subagents, CLAUDE.md

**"I want my chats as real files — synced, searchable, hand-editable."**
→ [IMPORT.md](IMPORT.md#where-chats-live) for the `AI/Conversations/` storage format

**"I'm moving to a new machine or a second vault."**
→ [IMPORT.md](IMPORT.md#full-backup) for the full backup zip — chats, prompts, harnesses, settings (keys stripped) — or [IMPORT.md](IMPORT.md#bulk-export) for chats only

**"I want AI to edit my writing."**
→ [DIFF_REWRITE.md](DIFF_REWRITE.md) for diff-reviewed rewrites, [SELECTION_ACTIONS.md](SELECTION_ACTIONS.md) for direct-write transformations

**"I want fully offline AI."**
→ [PROVIDERS.md](PROVIDERS.md#local-providers-ollama-lm-studio) for Ollama / LM Studio setup

**"I want voice input/output."**
→ [VOICE.md](VOICE.md)

**"I want Curtis to remember things about me."**
→ [MEMORY.md](MEMORY.md)

**"I want Curtis to know my notes without me pointing at them."**
→ [VAULT_RETRIEVAL.md](VAULT_RETRIEVAL.md) for the hybrid retrieval index and auto-injected context

**"Something isn't working."**
→ [FAQ.md](FAQ.md) for quick answers and fixes

**"I'm developing the plugin."**
→ [CONTRIBUTING.md](../CONTRIBUTING.md)

## Resources

- **[Model Context Protocol](https://modelcontextprotocol.io)** — the spec behind MCP client mode and Curtis's own MCP server
- **[Obsidian plugin docs](https://docs.obsidian.md)** — plugin API, `SecretStorage`, the declarative settings API Curtis builds on
- **[Provider documentation](PROVIDERS.md#built-in-providers)** — every built-in provider's endpoint, key scheme, and console link, verified per release
- **[Curtis Porter](https://github.com/JordanNewell/curtis-ai-chat-porter)** — standalone converter: any chat export → `.curt` and vault-ready markdown (chat history only — skills, agents, and MCP import in-plugin, since those are shared formats that need no translation)
- **[llms.txt](llms.txt)** — a terse, LLM-readable summary of the product and its network posture
- **[Issues & discussions](https://github.com/JordanNewell/curtis/issues)** — bug reports, feature ideas, show & tell
