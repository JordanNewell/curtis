# Changelog

All notable changes to Curtis AI Chat are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Changed

- **License: MIT → BUSL-1.1.** Curtis is no longer open source. The repo ships under the Business Source License 1.1 with an Additional Use Grant: free to use, modify, and redistribute; production use — personal or business — is permitted for everyone except those offering Curtis, or a derivative of it, as a competing product or service, which needs a commercial license. Each version converts to Apache-2.0 four years after its release. Badges, docs, and copy updated to match, including the in-plugin about panel. Note for ChatGPT plan sign-in: OpenAI limits plan usage to open-source apps, so that provider is now best-effort — the API-key path is unaffected.

## [2.0.0] — 2026-10-11

Agents, autonomy, and the open-agent stack: named agents and swarm specialists put any model to work in the vault, a terminal pane and opt-in command tool run shells, scheduled runs put prompts on a cadence, and an MCP server plus public plugin API open the vault to outside AI apps. The same release folds in skills (open Agent Skills standard), harness profiles, one-click import from Claude Code, hybrid vault retrieval with on-device local embeddings, a prompt library, outbound webhook events, and a full backup/restore — plus voice engines: a neural read-aloud voice on the OpenAI key and dictation on Groq or any OpenAI-compatible endpoint. Alongside: chat import with the portable `.curt` format, multi-pane chat, memory provenance and recaps, 53 built-in providers with subscription sign-in, inline autocomplete, and deep request controls for every provider.

### Added

- **Neural read-aloud engine** — Settings → Voice gains a Read-aloud engine: "System voices" stays the default (offline, free); "Neural (OpenAI key)" speaks through OpenAI `/v1/audio/speech` on the provider key you already have — ten voices (alloy through shimmer), a model field (`gpt-4o-mini-tts` default; `tts-1`/`tts-1-hd`), and an optional Reading style that steers `gpt-4o-mini-tts` ("warm narration"). The same sentence player — pause, skip, rate, karaoke — rides either engine, and auto-speak now plays through the same controller, so it follows the selected engine too. Clips cache (LRU of ~20 sentences; skip-back replays instantly) and the next sentence is prefetched while the current one plays, so per-chunk latency hides behind playback; rate applies client-side. Failure posture: one Notice, then system voices for the session — playback never dies mid-message. Billed per character; the settings row says so. Docs: [VOICE.md](docs/VOICE.md).
- **Dictation anywhere** — the mic is no longer welded to OpenAI. Settings → Voice → Dictation endpoint: OpenAI (the provider key, `whisper-1`), Groq (preset fills `api.groq.com/openai/v1` + `whisper-large-v3-turbo` — far cheaper and faster), or any custom OpenAI-compatible host (base URL with or without a trailing `/v1`). Non-OpenAI endpoints use a dedicated Dictation API key — a separate secret (OS keychain when available, stripped from backups like every credential) — and a missing key is an error naming the exact settings field. A new Auto-send after dictation toggle sends the message the moment text lands. Docs: [VOICE.md](docs/VOICE.md).

- **Import from Claude Code** — one click adopts an existing Claude Code setup: **MCP servers** from `~/.claude.json` (user scope) and the vault's `.mcp.json` import as disabled Streamable HTTP servers (legacy SSE imports disabled with a bridge note; stdio servers get a ready-to-run `mcp-proxy` bridge command — its `env` values display only, never persisted), **vault skills** from `~/.claude/skills`, `~/.agents/skills`, and `<vault>/.claude/skills` copy verbatim into `AI/Skills/`, **subagent files** from `~/.claude/agents/` become named agents (frontmatter body → persona, `description` → the new agent description field, `tools` → coarse tool-ceiling mapping with unrecognized names reported rather than guessed, Claude `model` aliases noted and routing left to follow the active lane), and **CLAUDE.md** (global or vault-root) becomes a harness profile seed. Every leg imports disabled — MCP servers off, agents with remote invocation off — and nothing is ever overwritten: duplicates by URL or name are skipped and reported. Desktop only (the scan is a pure local file read; no network, no telemetry). Round-trip export: the agent editor gains "Copy as a Claude agent file", Settings → Agents gains "Export agents as Claude files" writing `AI/Exports/Claude agents/`, and named agents gain a `description` field (also shown in the agent picker). Command palette: "Import Claude setup"; Settings → Conversations → Import from Claude. Docs: [IMPORT.md](docs/IMPORT.md), [AGENTS.md](docs/AGENTS.md).
- **Local (on-device) embeddings** — vault retrieval gains an embedding engine that runs inside Obsidian itself via transformers.js (WebGPU on desktop, WASM on mobile): no API key, no sidecar app, fully offline after the one-time model download (~30 MB, cached). Default model `Xenova/bge-small-en-v1.5` (384-dim, int8). A model picker offers a vetted shortlist (BGE small/base/large, MiniLM-L6, GTE small, Multilingual E5 small/base) plus live Hugging Face search for any feature-extraction repo with transformers.js weights; pooling is applied per model family and E5 query/passage prefixes are handled automatically, with hub-search picks marked unvetted. **Local model precision** is the desktop power dial — q8 default (runs anywhere), fp16 and fp32 tiers that require WebGPU; precision is part of the index's model identity, so switching it asks for a rebuild and vectors from different precisions never mix. The runtime initializes lazily on first use, and engine sessions are managed: one resident at a time (the previous session's weights are disposed on switch), builds freeze their engine identity so a mid-build settings flip can't mix vectors into one index, and dead sessions (GPU resets) re-initialize on the next attempt. A companion setting, **Index storage**, moves `rag-index.json` between the plugin folder and the synced `.curtis/` vault folder: build the index on desktop, let it travel with the user's own sync, and mobile only embeds the query. Flipping the location carries the index across; the existing provider/model mismatch guard already keeps vectors from different engines from mixing.

- **Hybrid vault retrieval** — every RAG search now fuses two channels over the same chunks: cosine similarity (dense) and a field-weighted BM25 keyword index (lexical), combined via Reciprocal Rank Fusion (k = 60). Exact names, tags, acronyms, and filenames match as reliably as meaning does — the dense channel's known blind spot. BM25 indexes note titles (×3) and paths (×2) above body text, tokenizes CJK content as unigrams plus bigrams, and lives entirely in memory: no settings, no extra API calls, no background service, no new files on disk. Applies everywhere the index is queried — auto-injected context, the `semantic_search` agent tool, the plugin API, and the MCP server. Exposed scores are now the fused rank score normalized to [0, 1].
- **Skills** — capabilities from the open [Agent Skills](https://agentskills.io) standard, authored as folders in the vault (`AI/Skills/`, one `SKILL.md` per skill) and portable to and from Claude Code, Cursor, Copilot, Gemini CLI, and other spec-compatible agents. The loader enforces the spec (name/description frontmatter, folder-name match, unknown fields tolerated, invalid files surfaced in settings and never injected) while Curtis-specific behavior — enable state and load mode — stays in settings, so skill files remain 100% spec. Activation is progressive disclosure: every enabled skill's description rides the system prompt in every arena (chats, arena mode, swarm leaders and followers, scheduled runs, the MCP server's `run_agent`, the plugin API), and full instructions load on demand via the new `load_skill` agent tool (vault-class, so agent tool ceilings gate it), the `/skill <name>` slash command (bare lists, toggles attach; works in plain no-tools mode), a per-agent pinned-skills list, or the new `skills` option on `api.chat`/`api.runAgent`. A per-skill "Always in context" override injects the full body on every request instead. Settings → Curtis AI Chat → Skills: master toggle (hot-reloads the tool), folder picker with cache reset, open/create with a starter skill, and per-skill rows. Docs: [SKILLS.md](docs/SKILLS.md).
- **Harness profiles** — the base contract composed under every system prompt is now selectable. Settings → Generation ships two built-ins, defined in code and immune to edit/delete: "Curtis (default)", the full identity + capabilities + operating-principles contract, and "Plain assistant" — the same context mechanics and honesty rules (attached-note accuracy, tool-list honesty) with no persona, for users who want a bare assistant. The editor creates custom profiles (name, description, prompt) that replace the contract wholesale while selected; the system-prompt extension and agent personas layer on top of whichever profile is active, unchanged. An unknown or dangling profile id falls back to the Curtis contract, so a send never composes without a base. Docs: [HARNESS.md](docs/HARNESS.md).
- **Prompt library** — saved, reusable prompts inserted into the chat input: `/prompt` bare opens a fuzzy picker (with a "Create new prompt…" tail that saves and inserts in one flow), `/prompt <name>` inserts a match by prefix, and a book-marked button in the composer opens the same picker. Inserted text lands in the input editable, not auto-sent. Entries are managed in Settings → Curtis AI Chat → Prompt library; one shared library, since prompts are model-agnostic.
- **Prompt-injection fence** — every system-prompt composition now ends with an unconditional "content is data" clause: text arriving through attached notes, vault excerpts, tool results, MCP/GCP output, and fetched web pages is information to reason over, never instructions to execute; embedded directives are surfaced to the user, not acted on. It rides the compose step itself, positioned so no harness profile, extension, or persona can shed it.
- **Vault-native link style** — the harness reads the vault's own link preference (Obsidian's `useMarkdownLinks` setting) fresh on every send and instructs the model to match it when writing or editing notes: `[[wikilinks]]` in wikilink vaults, percent-encoded markdown links in markdown-link vaults — and never to invent link targets, only link notes that are known to exist.
- **Outbound webhook events** — Settings → Outbound events: POST a JSON event to a URL you configure when a chat response or a scheduled run finishes. Off by default, with an independent toggle per event (chat completions off, scheduled runs on — both inert until the master toggle is on). Payloads are metadata only (`curtis.chat.event/v1`: provider, model, duration, status, token counts, cost, conversation or job identity, and the run note's path for scheduled runs — never message text or note contents), and an optional shared-secret header (`X-Curtis-Secret`) rides every POST. Strictly one-way: the dispatcher's only transport is an outbound request — nothing in the feature listens. Delivery is fire-and-forget by construction: a failing, slow, or unconfigured endpoint logs to the console and never blocks the chat stream or the scheduler. The same events mirror as local audit receipts into curtis-ai-audit when that plugin is installed — automatic, no configuration, nothing HTTP.
- **Full backup & restore** — "Export full backup (chats, prompts, harnesses, settings)" in the command palette writes `curtis-backup-<date>-<time>.zip`: every conversation (as byte-perfect `.curt`) plus the prompt library, custom harness profiles (built-ins stay in code), and settings with API keys stripped. Import it through any import entry point — it auto-detects as a backup bundle and a dialog picks the sections to restore: conversations through the normal pipeline, prompts and harnesses merged by id (existing entries win), settings wholesale with local credentials preserved. Docs: [IMPORT.md](docs/IMPORT.md#full-backup).
- **Nine more built-in providers (44 → 53)** — Z.ai GLM (the pay-as-you-go platform endpoint; the coding-plan provider is now named "Z.ai Coding Plan"), BytePlus ModelArk (ByteDance international — Doubao's Seed family plus hosted DeepSeek/GLM), Baidu Qianfan (ERNIE, with the richest model discovery of any built-in), SiliconFlow (international open-weight aggregator), Crusoe Cloud, Poe (one key across every frontier bot, billed in Poe compute points), Featherless (22k+ open-weight models and the richest documented sampling set), Scaleway (strictly European hosting), and Reka. Every endpoint, seed model, price, sampling cap, and reasoning dialect verified against official vendor docs plus live endpoint probes on 2026-10-10. Candidates researched and rejected in the same pass: Nscale (legacy catalog retires 2026-11-02), Cloudflare Workers AI (account id embedded in the URL), Writer (nonstandard `/v1/chat` path), iFlow (undocumented backend endpoint), SenseNova and Liquid AI (no verifiable hosted API). SiliconFlow defaults `enable_thinking` on server-side — Curtis sends it explicitly so hybrid models never surprise-CoT.
- **Scheduled runs** — put a prompt or a named agent on a cadence: daily at a local time, or on a repeating interval (5 minutes to a week). Each run executes headlessly through the same agent loop as chat — vault tools, MCP tools, memory, no conversation touched — and lands as one markdown note (frontmatter carries job, schedule, status, and duration; the body is the answer, or the error plus the original task, so failed runs leave an audit trail). Runs happen only while Obsidian is open — that's a platform fact, so the semantics say so: a daily job missed while closed fires once on the next launch; interval jobs re-anchor from that catch-up instead of stacking retroactive runs; one run per job at a time. An agent used here must have "Remote invocation" enabled (the same gate as the MCP server's `run_agent`); shell access is always excluded from scheduled runs. A **Run now** button on each job card fires immediately — a manual run counts as a real fire and resets the cadence. Settings → Curtis AI Chat → Scheduled runs.
- **Link previews in chat** — external links grow a site favicon and a hostname tooltip (icons load from DuckDuckGo's icon service, one request per domain; Settings → Chat UI → Link favicons, on by default — off keeps rendering fully local), and plain vault paths the assistant mentions (`Projects/Ideas.md`) become tappable links: click opens the note, hover shows the native page-preview popover. Unknown or ambiguous paths stay plain text.
- **Smarter scrolling + small chat touches** — a long stream no longer yanks the transcript down while you've scrolled up to read; a floating jump-to-latest button appears instead and follows you back once you return to the bottom. Assistant messages gain a compact clock label in the meta row (hover for the full date); user bubbles carry the full timestamp as a hover tooltip.
- **Voice settings** — read-aloud is now configurable and persistent: pick a system voice, set a default rate (0.5–2×), and enable karaoke highlighting of the sentence being read; auto-speak survives restarts. Playback starts at your configured rate (the player's rate button stays a session-level override), and sentences are taken from the rendered message, so code blocks and UI chrome are no longer read aloud. Settings → Curtis AI Chat → Voice.
- **Desktop notifications** — an opt-in system toast when a response completes or fails while you're away from the pane: title plus a short preview, click focuses the chat (popout-aware), suppressed while the pane is visible, in-app Notice fallback on mobile or when permission is denied. Settings → Chat UI, off by default.

- **Agents as tools** — the MCP server gains `list_agents` and `run_agent`, and the plugin API gains `api.runAgent(name, task)`: external AI apps and Obsidian plugins can hire user-authored agents headlessly — persona, model routing, and tool ceilings included; results return as text. Gated per agent by a new "Remote invocation" toggle (default off) in the agent editor; runs are fresh engagements on the agent's own provider at the user's cost. Remote runs cap at two concurrent (extras are refused with a busy error), and every run is recorded — a completion Notice plus a "Recent remote runs" list under Settings → Curtis AI Chat → MCP server.
- **Subscription-plan access (41 → 44 providers)** — Curtis can now bill requests against chat subscriptions instead of API keys, for exactly the vendors that permit it. **Sign in with ChatGPT** (ChatGPT Plus/Pro) rides OpenAI's official OAuth program — no API key, no client secret: press Sign in on the provider card, authorize Curtis in the browser (desktop only; the flow runs a local loopback listener), and requests hit the standard Responses API against the plan allowance. Access tokens (~1h) refresh automatically off a ~30-day refresh token stored in the OS keychain; the model catalog is the plan's codex-flavored lineup via `/v1/models`. Plus two coding-plan providers built on the pattern Z.ai already shipped: **Kimi for Coding** (`api.kimi.com/coding/v1`, plan keys from kimi.com — not interchangeable with platform keys) and the **Alibaba Coding Plan** (fixed monthly price, dedicated `coding-intl` host that rejects standard DashScope keys). MiniMax plan keys already work on the standard MiniMax endpoint, and Perplexity Pro / Chutes subscriptions simply include ordinary API credits. Claude Pro/Max and GitHub Copilot are deliberately unsupported — Anthropic blocks subscription tokens from third-party apps at the API level and has suspended accounts that try; the providers doc now says so plainly rather than letting users find out with their account.
- **GCP connector** — connect a Google Cloud project with a service-account key and Curtis gains three read-only Cloud Storage agent tools: `gcp__storage__list_buckets`, `gcp__storage__list_objects`, and `gcp__storage__read_object`. Auth is the standard service-account JWT flow (signed with WebCrypto, so it works on desktop and mobile), the hour-long access token is cached and refreshed automatically, and the requested scope is `devstorage.read_only` — Curtis cannot write to your buckets even if asked. Text objects inline up to 20,000 characters; binaries return metadata only. Off by default, requires agent mode, the key is stored in the OS keychain when available, and per-agent tool ceilings can exclude GCP. Settings → Curtis AI Chat → GCP.
- **MCP server mode** — Curtis now serves the vault *as* MCP tools on localhost, so external AI apps (Claude Desktop, coding agents, any Streamable HTTP client) can work with your notes without opening Curtis: `list_notes`, `read_note`, `search_notes`, `get_memory`, `semantic_search` (rides the RAG index), and an opt-in `write_note`. Settings → Curtis AI Chat → MCP server. Desktop only. The server binds 127.0.0.1 only, requires a bearer token (generated on first start, regenerable), refuses non-loopback Host headers and all browser origins, and ships read-only — writes appear in the tool catalog only after "Allow writes" is switched on. Every client-supplied path passes a vault jail (absolute paths, drive letters, and `..` are rejected before a file is touched). A copy-ready `claude mcp add` command sits next to the token in settings.
- **Public plugin API** — other Obsidian plugins can now call `app.plugins.plugins['curtis-ai-chat'].api`: a headless `chat()` that runs the full agent loop (vault tools, MCP tools, memory; shell commands excluded unless explicitly allowed) and returns the final text — `chat()` and `runAgent()` both take an `onUsage` callback for per-request token metering — plus `searchNotes`, `semanticSearch`, `readNote`, `listNotes`, and `getMemory`. Desktop and mobile. Documented as a stable contract (docs/PLUGIN_API.md) — members are added, never renamed or removed.
- **Inline autocomplete** — Copilot-style ghost text while typing in any note: pause mid-word and a dimmed continuation appears after the cursor; Tab accepts, Escape dismisses, and one undo removes an accepted suggestion. Off by default (Settings → Autocomplete) — every suggestion sends the text around the cursor to the selected provider — with a dedicated model picker (small fast models recommended; requests cap at 60 tokens), a 200–1000 ms debounce, a trigger threshold, and an accept-key choice (Tab, Alt+Tab, or Ctrl+→; Tab is captured only while a suggestion is showing, so vim indent is untouched). Suggestions ride the chat transport, so local Ollama models work; requests are debounced, LRU-cached, throttled to 20/min, and a failed provider pauses suggestions for a minute (two on a rate limit) rather than retrying into a broken endpoint. IME composition is respected — no ghosts mid-composition. Session token spend shows in `/stats`. Desktop only.
- **Terminal pane** — a desktop shell in its own optional OS window ("Open terminal window"), or docked as a workspace tab. Reachable from a terminal icon in the chat top bar, the pane's "..." menu, and the command palette. Every command runs in a fresh shell; the pane carries the working directory (a successful `cd` is mirrored), keeps per-pane history on the arrow keys, and kills commands at the Settings → Terminal timeout. Shell is auto (`cmd` on Windows, `bash` with `sh` fallback elsewhere) with a `cmd` / `powershell` / `pwsh` / custom-path override. Desktop only — mobile hides the entries and renders an honest empty state.
- **Command tool** — opt-in `run_command` for agent mode (Settings → Terminal): the AI can run shell commands and receives stdout, stderr and the exit code, with output capped and truncated. Off by default, like the web tools. Every agent-initiated command passes a confirmation dialog — Deny / Run once / Always this session (session approvals clear on reload); denying tells the model to stop and ask. Commands run restricted to the vault by default (toggleable), and the same gate covers swarm followers, since they ride the agent loop.
- **Agent model override** — Settings → Agent → "Agent model" runs tool-calling turns (agent mode, leader chats, the terminal command tool) on a different provider/model than plain chat, so chat can stay light while the tool loop runs heavy. Empty follows the chat model; message bubbles attribute the model that actually answered; a named agent bound to a chat keeps its own model; swarm followers inherit the leader's effective pair; an override model without tool support falls back to the chat model with a notice.
- **Vault shell on mobile** — the terminal pane and the agent's `run_command` now work on iOS and Android via a vault shell: a curated POSIX-ish command set (`ls`, `cat`, `head`/`tail`, `wc`, `grep` with folder recursion, `find`, `sed s/old/new/[g]`, `sort`, `uniq`, `echo`, `mkdir`, `touch`, `cp`, `mv`, `rm`) implemented over the vault API — no OS processes (iOS forbids them; Obsidian's Android app has no process bridge), no permissions, and incapable of touching anything outside the vault. `rm` moves to Obsidian trash, never hard-deletes; no pipes or redirection (quoted metacharacters are literal); recursive walks cap at 2000 entries and output at the same 8000 chars as desktop. The pane keeps its input, history, cwd mirroring, and stop affordances with a vault-relative cwd; the agent tool keeps its confirmation dialog, timeout, and output caps. Desktop behavior is unchanged.

- **Swarm mode** — mark any chat as a leader (pane menu or `/leader`) and it can spawn follower agents: real, separate conversations that each take one subtask with the full vault toolset and report back to the leader. Every follower opens in its own pane so the work is watchable; stopping the leader stops the whole swarm. Settings → Agent gains "Max follower agents" (1–4, default 3), enforced per message. Followers inherit the leader's model, run one at a time, and cannot spawn further agents.
- **Advanced request parameters** — each provider card (and each of its models) gains a collapsed group of request-body overrides: Temperature, Max tokens, Top P, Top K, Min P, Seed, Stop sequences, Frequency/Presence/Repetition penalty, an "Omit temperature" toggle for models that reject sampling params (OpenAI reasoning models, post-Opus-4.6 Claude), a Reasoning-effort control (off/minimal/low/medium/high/max, mapped to each provider's dialect — `reasoning_effort` for OpenAI-style APIs, `thinking.budget_tokens` for Anthropic, `thinking` on/off for DeepSeek and Z.ai, `think` for Ollama), and an "Extra body JSON" passthrough for provider-specific fields Curtis doesn't structure (reserved keys: `model`, `messages`, `stream`, `stream_options`). Precedence: per-model over per-provider over the global Generation settings. The collapsed section shows how many overrides are set at a glance, each scope has a one-click reset, and a "Copy last request JSON" button on each provider card shows exactly what hit the wire.
- **Ollama hardware knobs** — Context window (`num_ctx`), GPU layers (`num_gpu`), CPU threads (`num_thread`), and Keep-alive on the Ollama card, sent through Ollama's native `options{}` / `keep_alive` fields — knobs that previously required a modelfile.
- **Arena up to 4 models** — rounds are no longer head-to-head: pick 2–4 models and the prompt streams to all of them side by side (3–4 way rounds wrap to two columns on narrow windows). The picker notes that each extra column multiplies token cost; promote-the-winner and per-column stop work unchanged.
- **14 more built-in providers (27 → 41)** — NVIDIA NIM, Moonshot Kimi, MiniMax, Alibaba Qwen (DashScope international), AI21 Jamba, Upstage Solar, Nebius (Token Factory), Baseten, Inference.net, OVHcloud AI Endpoints, FriendliAI, GMI Cloud, StepFun (international), and Tencent Hunyuan (TokenHub). Every endpoint, key scheme, seed-model list, and price verified against current vendor docs on 2026-10-09; each gets per-provider sampling caps and a reasoning dialect (Kimi pins temperature/top_p server-side so Curtis never sends them — the Temperature row disables on its card; Qwen toggles thinking via `enable_thinking`, Hunyuan via its `thinking` object). All 14 auto-discover their model lists at runtime — on GMI, discovery is also where contexts and prices come from, since they publish those only in the console.
- **Extended thinking (Anthropic)** — Settings → Generation gains an "Extended thinking (Anthropic)" toggle plus a token budget (1024–32000): thinking-capable Claude models stream their reasoning before the answer into a collapsible block in chat (and in arena columns) — open while streaming, collapsed when done. Reasoning never mixes into message text, survives tool-use rounds (the API requires prior thinking blocks back, so they are replayed per tool result), and is stripped from headless surfaces — recap, swarm reports, and the public plugin API (`chat()` / `runAgent()`) stream answer text only. Per-model Reasoning-effort overrides and Extra-body JSON still win when set.
- **Custom selection actions** — define your own select-and-run actions in Settings → Curtis AI Chat (name, system prompt, a `{{selection}}` template, replace or insert-below): they appear beside the built-ins in the editor context menu and get one command-palette entry each (new or renamed ones join the palette after reload; the context menu picks changes up immediately).

- **Multi-pane chat** — "Open new chat tab" opens a second chat as a full-width tab beside the active one; "Open chat in new window" opens one as a separate OS window, and the popout icon on the pane header carries that pane's conversation into the window. Each pane keeps its own conversation, provider, and model, and a new tab starts a fresh chat rather than a second view of the current one. Reachable from the command palette, an always-visible new-tab icon on the pane header, and the pane's "..." menu (popout actions are desktop-only).
- **Titled panes + rename** — the tab and window header name the bound conversation, so parallel chats are distinguishable at a glance. The title also sits quietly in the chat header; clicking it (or the pane menu's "Rename conversation") retitles the conversation and its vault file — the same path as the `/title` command.
- **Meta Muse provider** — new built-in provider against `api.meta.ai`'s OpenAI-compatible endpoint. Seeds the Muse Spark lineup (1.3, 1.2, 1.1) at 1.05M-token context, one price across the family, vision and tools on all three.
- **Chat importer** — an "Import chats from other AI tools" command plus a Settings → Conversations entry point. Auto-detects the official ChatGPT and Claude data exports (`conversations.json`, plain or zipped), `.curt` files, existing Curtis markdown transcripts, and generic role-labeled JSON/markdown. Imported chats land in the conversations folder as normal vault files; continuing one sends its full history under whatever provider is active.
- **Four entry points** — command palette, drag-and-drop onto the chat view, double-click a `.curt` file in the vault for a one-click import page, and right-click → "Import into Curtis" in the file explorer.
- **Import summary** — per-file breakdown (format, imported, already-present, failures) after each run; progress shown while a multi-file import runs.
- **`.curt` portable format** — one file, one conversation, full fidelity (ids, tokens, images survive). "Export" in the chat header now offers Download as Markdown or Save as .curt; `.curt` files in the vault open a branded landing page with one-click import. Curtis-to-Curtis moves are now a file copy.
- **Fidelity guards** — ChatGPT platform system prompts and tool-output nodes are excluded; orphan tool messages from any foreign transcript are dropped so imported history is always safe to re-send to a provider. Re-running the same export is idempotent (duplicates skipped).
- **Bulk export** — "Export all chats as .curt (zip)" command and Settings entry point writes the whole history as one importable zip of `.curt` files; import auto-detects zip-of-`.curt` batches, so vault-to-vault moves are a single file.
- **Memory provenance** — every fact captured from chat records which conversation it was learned from. Settings → Memory shows "learned <date> · from <conversation>" per fact with a jump button. The provenance rides in the memory file's hidden comment; pre-2.0 files parse unchanged.
- **Memory chips** — assistant replies show how many remembered facts were in context for that answer. The chip opens the fact list with learned dates and a "view conversation" link where provenance exists, plus a shortcut to the memory file. Chips resolve against the current memory file, so edited or deleted facts degrade honestly ("since removed") instead of showing stale text.
- **Session recaps** — `/recap` or Export → "Recap conversation" summarizes the chat into 2-3 terse bullets (worked on / decided / left open), appends the summary to the conversation, and logs it to the journal.
- **Curtis Journal** — an append-only markdown file (default `AI/Curtis Journal.md`) with one entry per recap and a link back to the conversation. Plain markdown in your vault; Curtis only ever appends. Path and on/off live in Settings → Conversations.
- **Relevance pulse** — opening a note that closely matches an indexed past conversation shows a quiet "discussed in <title> · <date>" hint under the chat header; click jumps straight into that conversation. Local-only similarity over the existing vault index (no embedding calls), with a high precision floor so it stays out of the way. On by default in Settings → Vault retrieval; requires the index.
- **First-run welcome** — new installs get a short panel in the empty state: what Curtis is, that memory is one editable file, an optional "read my vault" indexing pass with visible progress, and two starter questions whose answers flow through normal fact capture. Skippable in one click; upgrading installs never see it (settings migration marks onboarding complete).

### Changed

- **Now "Curtis AI Chat"** — the plugin formerly "Curtis". The Obsidian plugin id is unchanged (`curtis-ai-chat`), so existing installs update as usual; the name in Settings, the community directory, and the docs simply becomes Curtis AI Chat. The ribbon icon, the chat tab, and the editor context menu all carry the custom Curtis mark, and the ribbon tooltip reads "Open Curtis AI Chat".
- **Borderless composer** — the input no longer sits in a frosted card; the textarea and its controls sit directly on the pane surface. The control row keeps everything left under the typing area (attach, mic, arena, auto-speak) with send anchored at the right end.
- **Model picker moved to the top bar** — the pill now sits centered between the conversation title and the history tool, so the model in play reads at a glance and the composer row stays quiet. The anchored dropdown opens beneath it; "All models…" opens the full picker, restyled to match the plugin: rounded chrome, provider color dots, and real capability chips (vision, tools, context) instead of plain text.
- **Ollama speaks its native dialect** — requests go to `/api/chat` (NDJSON streaming) instead of the OpenAI-compatible `/v1` endpoint, which cannot pass through `options` or `keep_alive`. Saved `/v1` endpoints migrate automatically.
- **Capability gating on request parameters** — a per-provider capability matrix drops fields that provider's API rejects before the request is sent (strict APIs — OpenAI, Azure, the Perplexity Router, Fireworks — return 400 on unknown fields); unsupported controls render disabled in Settings.
- **Endpoint corrections** — fal.ai chat routes through the fal.run OpenRouter passthrough (`Authorization: Key <key>` auth, not Bearer); Perplexity moves to its documented Router endpoint.
- **Numbered untitled chats** — with several panes open, fresh chats are "New chat 2", "New chat 3", … instead of a pile of identical "New chat" tabs. The first message still titles the chat for good, so the number lives only as long as the ambiguity does.
- **Selection rewrites show a diff first** — every replace-mode selection action (summarize, fix grammar, refactor, …) opens the review modal to accept or reject instead of silently overwriting the selected text; insert-below actions keep direct apply. The unused "none" insert mode is gone.
- **Translate picks its language** — the selection action prompts for a target language on each run, pre-filled with the last one used, instead of always translating to English.
- **Terminal transcript layout** — user messages commit as echoed `❯` prompt lines instead of right-aligned bubbles: the caret you were typing with becomes the prompt glyph, nothing pops in or re-types. Assistant replies render as plain document text delivered under the streaming neon caret. A quiet card returns behind assistant text only while a chat wallpaper is active, where plain text would be unreadable.
- **Composer layout** — the input box now sits on its own full-width line with attach, mic, the Enter/Shift+Enter hint, and send/stop sharing one action row beneath it, instead of everything squeezed beside the box. The chat header splits into two rows on narrow panes (phones and narrow sidebars): new chat + active note + model picker up top, arena/auto-speak/history/export/search underneath. Wide panes keep the single-row header. The model dropdown flips above the pill when the composer leaves no room beneath it, so every item stays reachable.
- **Provider model seeds refreshed** — every built-in seed list re-verified against vendor catalogs (2026-10-09): OpenAI seeds the GPT-6 generation at 1.05M context, Gemini the 3.8 Flash family, Groq its two self-serve GPT-OSS models (Llama entries went enterprise-only), Mistral the versioned Large 4 / Medium 3.5 slugs with Devstral retired, Cohere the Command A family led by Command A Plus, xAI Grok 4.7 / 4.6 / 4.3, Cerebras its gpt-oss-120b + qwen-3.8-27b catalog, Perplexity gains `sonar-deep-research`. Runtime model discovery still fills in whatever your key can see.
- **About block badge** — the Settings → About lockup leads with the identity badge (the black-field C. mark) instead of the 16px monoline glyph; a bitmap reads better at that size. The badge ships as an inlined data URI, like the maker badge below it.

### Fixed

- **Docs accuracy pass** — stale claims corrected against the code: cross-conversation search scans vault conversation files (not `localStorage`, gone since 1.4.0) and its hotkey is assignable-only (no default); the settings panel shows the last 5 remote agent runs (not 20); fal.ai auth is `Authorization: Key <FAL_KEY>`; the diff-rewrite palette command is "Rewrite selection with AI (with diff)"; the built-in tool inventory is twelve (`load_skill` joins with Skills on), not eleven; Azure is excluded from embeddings alongside Anthropic; retired GPT-5 model examples swapped for the current GPT-6 generation; SWARM.md's "per-follower models are not offered yet" corrected — named specialists bring their own model.
- **README network-access table completed** — adds the four endpoints the site docs already disclose: icons.duckduckgo.com (link favicons, on by default), auth.openai.com (ChatGPT sign-in), Google OAuth + storage.googleapis.com (GCP connector), huggingface.co (one-time local-embedding model download); the off-by-default summary now says so explicitly. Canonical site URL (curtisai.jordannewell.com) replaces the github.io redirect.
- **MONETIZATION.md moved off the published site** into `internal/marketing/`, joining the other internal planning docs.
- **Swarm runtime hardening** — one generation per leader chat: a second pane bound to the same leader now refuses to send while a generation is in flight (a fresh send used to reset the per-message follower cap and interleave two generations into one transcript). Followers serialize across every leader — the one-follower-at-a-time rule is now a vault-wide queue, so two followers can never edit the vault at the same moment, and a follower still queued when its leader is stopped is recorded as never started instead of lingering as an empty run. The conversation store's "most recent" pointer is restored only when the user hasn't navigated away mid-run: spawning a follower no longer yanks the pointer (and any newly opened pane) back to the leader if the user had moved to another conversation, and the hand-back at run end only fires when the user is still on the follower.
- **Splitting a pane mirrored the chat** — a split (or a dragged-out clone) starts the new pane on a fresh chat instead of copying the current conversation. Deliberate same-thread views — the history dropdown, the popout icon's carry-over — still bind explicitly.
- **Composer controls picked up theme button chrome** — Obsidian 1.13 paints bare `button` elements like form buttons; the composer's icon controls now win that fight, so they render ghost-flat in any theme (and the send arrow keeps its dark ink).
- **Named `/note` saves now match bare `/note`** — saving with a name skipped the `created` frontmatter stamp and the image embeds that the unnamed path wrote; both variants now produce identical frontmatter (`source: Curtis`, provider, model, created) and embed attached images.
- **`/memory clear` asks first** — the wipe now shows a confirmation dialog (Esc cancels) and reports how many facts it removed, instead of silently emptying memory.
- **Fact-extraction race** — switching conversations while a reply was streaming could run fact extraction against the wrong conversation. Extraction now follows the conversation the reply was pinned to, which is also what gives captured facts their provenance.

### Removed

- Dead providers — **GitHub Models** (service retired 2026-07-30), **Hyperbolic** (inference API decommissioned), **Lepton AI** (acquired by NVIDIA, service shut down), **Lambda** (Inference API in wind-down). Twenty-seven built-ins remain.

## [1.6.0] — 2026-10-07

Brand and direction: a custom Curtis mark across the plugin, a theme-adaptive logo disc on the empty state, and right-to-left layout that mirrors cleanly.

### Added

- **Custom Curtis mark** — angular C with a speech-bubble tail on the 24px icon grid, filled with `currentColor` so it follows the theme. Replaces the stock bot glyph in the ribbon, tab strip, and editor context menu.
- **Dual-theme logo disc** — the empty-state hero is drawn entirely by CSS: dark master (`#0A0A0A`) for dark themes, warm off-white master (`#F5F5F3`) for light, inlined as data URIs. Crop/inline pipeline in `scripts/logo-crop.ps1` and `scripts/inline-logo.mjs`; handoff spec for the final designer master in `LOGO-SPEC.md`, visual rules in `DESIGN.md`.

### Changed

- **Right-to-left support** — all directional CSS (bubble tails, blockquote bars, list indents, code copy button, hover toolbars, dropdown anchors, image-remove button, arena thinking indicator) converted to logical properties, so the chat UI mirrors correctly under Obsidian 1.14's workspace-level RTL flip. No visual change in left-to-right use.
- **Active history marker** — the active conversation's accent bar is now a logical border instead of an inset box-shadow, so it flips with direction; padding compensates to keep rows aligned.

## [1.5.1] — 2026-10-04

Consent-first memory and a sharper arena. Extracted facts now ask before anything is saved, and the arena narrows to a two-model head-to-head that compares models under the same context a normal send carries.

### Added

- **Ask-before-saving fact capture** — memory capture gains a `confirm` mode, now the default. Extraction still runs in the background after each turn (0–3 facts, deduped against what's already saved), but proposals appear under the last message as a "Worth remembering?" bar with Save/Skip per fact. Nothing touches the memory file until you tap Save; skipped facts are not re-proposed that session. The bar is transient — sending the next message clears it. Silent capture remains available as "Save silently after each turn" in Settings → Memory → Fact capture; a one-time migration moves stored `auto` to `confirm`.
- **Per-column arena stop** — every arena column footer gets a Stop button while it streams; it halts that column only while the sibling keeps going. The main Stop button still aborts all columns. A stopped column keeps its partial text (final markdown render) and stays promotable.
- **Arena context parity** — arena sends carry the same context as a normal send: memory block, vault-retrieval excerpts, `@`-mention attachments, and images (multi-part vision content), with vision-aware error messages. Prior conversation history still deliberately doesn't ride along — arena stays single-shot, so the comparison reflects a fresh answer and promote carries exactly what the winner saw.
- **Arena screenshot capture script** (dev tooling) — `node scripts/capture-arena-shots.mjs` drives real Obsidian over CDP through the full arena flow (picker, parallel streaming, per-column stop, promote) and asserts store behavior after each step. Not shipped in the plugin bundle. Five new arena screenshots.

### Changed

- **Arena is head-to-head** — the picker selects exactly 2 models (was 2–5). Duels keep columns readable in the sidebar and make promote cheap.
- **Promote cleans the thread** — promoting a column aborts the losing column and deletes its stored answer, so the continued conversation is a clean single-model thread. Previously both answers stayed in history.
- **Memory prompt discipline** — the core system prompt now instructs the model to use remembered facts only when relevant and never volunteer observations about the user's patterns ("I've noticed you always…").

### Fixed

- **Arena conversation pinning** — arena sends pin all message writes to the conversation current at send time (same guard as the normal path), so switching conversations mid-stream no longer files columns into the wrong thread. Aborted columns no longer persist a stale snapshot; the settle path mirrors the normal send's.

## [1.5.0] — 2026-10-04

Model lists that keep up with providers. Discovery results persist and re-seed the picker on every start, Anthropic models are discovered live, and a manual "Add model" row covers providers whose `/models` listing lags what the plan actually serves.

### Added

- **Persistent model discovery** — every successful `/models` listing is saved to settings and re-seeds the picker on boot, so restarts and offline sessions never fall back to the months-old baked-in list while the background refresh is pending or unreachable. Only ids that came from an earlier discovery and vanished from today's listing are dropped; curated (built-in) ids and manual ids are never pruned by a listing, and a failed discovery changes nothing.
- **Anthropic auto-discovery** — the Claude model list is fetched from `/v1/models` (limit=1000, `anthropic-version` header). Custom endpoints and gateways are honored; the baked-in list remains the fallback and is never pruned.
- **Manual model ids** — an "Add model" row on every provider card (built-in and custom) appends hand-typed ids to the picker; they survive refreshes and are never pruned by discovery. Escape hatch for listings that lag plan routing (z.ai coding plans serve models their `/models` omits).
- **GLM-5.3** — baked into the Z.ai GLM list as Latest (GLM-5.2 demoted).

### Fixed

- **Retired/gated model errors** — "model not found" / "does not exist" / "not supported" style errors (including 404s naming the model) now read as "this model is no longer available — pick a current model" instead of "auth failed", which sent users off to re-enter perfectly valid API keys.
- **Discovery-cache lifecycle** — deleting a custom provider clears its persisted cache entry; editing one keeps the cache; a pending debounced cache write is cancelled (not fired) on unload.

### Internal

- **Model-discovery smoke test** (dev tooling) — `node scripts/models-smoke.mjs` bundles the real registry with the obsidian module stubbed to a fake in-process network and asserts the invariants: per-auth URL/header derivation, merge order and metadata preservation, curated/manual ids never pruned, vanished discovery-only ids self-clean, failed discovery touches nothing, restart seeding with zero network, edit-save keeps the cache while delete clears it. Not shipped in the plugin bundle.

## [1.4.1] — 2026-10-04

Maintenance release addressing community-plugin review feedback. No functional changes beyond the removals below.

### Removed

- **All sponsorship surface** — the Settings → Support group (and its buymeacoffee.com link), `fundingUrl` in `manifest.json`, and the site footer sponsor links. The plugin contains no reference to external sponsor domains.

### Documentation

- **README privacy pass** — clipboard access disclosed (read only when pasting into the chat input, written only on message copy, never in the background); sponsor entries dropped from the network table.

### Internal

- **Type-check hardening** — catch variables are `unknown` (`useUnknownInCatchVariables`), TypeScript lib widened from deprecated `ES5`/`ES6`/`ES7` aliases to `ES2022`. Type-check-only; emitted code unchanged.

## [1.4.0] — 2026-10-03

MCP client support. Ten built-in tools become "any tool the user already has" — Curtis connects to MCP servers the user already runs instead of a fixed catalog. Plus vault retrieval (RAG): the `enableRag`/embedding settings finally back a real implementation — previously they were UI with nothing behind it. And the storage brand promise closes its last gap: conversations move out of `localStorage` into vault markdown files, so "your data stays in your vault" is literally true.

### Added

- **Conversations as vault files** — every chat persists as one markdown note in `AI/Conversations/` (folder configurable in Settings → Conversations) instead of `localStorage`. YAML frontmatter carries conversation metadata; messages are readable `## You` / `## AI` sections with hidden per-message metadata comments (ids, timestamps, tokens, tool calls, attachments); files are named `YYYY-MM-DD <title> <id>.md` so they sort chronologically. History now syncs with the vault, survives cache clears, is indexed by native Obsidian search, and is readable by the agent's note tools. Legacy localStorage conversations import automatically on first load (id-matched, idempotent, old copy kept as backup); hand edits to a note round-trip through the vault modify watcher; deleting a conversation trashes its file; empty chats are never written, so clicking "New chat" litters nothing.
- **MCP client** — Settings → MCP servers takes any number of Streamable HTTP MCP servers; every tool they expose joins the agent's toolset namespaced `mcp__<server>__<tool>` (collision-safe, 64-char provider-safe naming), requires agent mode, rides the same `agentMaxTurns` loop cap, and is off by default. Handshake, `tools/list` pagination, and session management speak protocol 2025-06-18 with older servers negotiated down; a server-side session loss (HTTP 404) re-initializes and retries transparently. Responses arrive as JSON or buffered SSE over Obsidian's `requestUrl` — CORS-immune on desktop, works on mobile. Tool arguments pass the server's own JSON Schema through verbatim (new `ToolDefinition.inputSchema`); results render text blocks, fall back to `structuredContent`, note binary content, and truncate at 20k chars. Static per-server headers cover bearer auth; there is no MCP OAuth — servers you enter are servers you trust.
- **MCP settings group** — enable toggle, per-server cards with live connection status (state, server name/version, tool count, error text), add/edit/delete via modal, and a per-server connect/refresh action; everything indexed by Obsidian's settings search. Servers connect in the background at plugin load — a slow or dead MCP server never delays boot.
- **System prompt MCP capability line** — the core prompt tells the model what `mcp__`-prefixed tools are, to read descriptions before first use, and to never invent a server that isn't connected.
- **MCP protocol smoke test** (dev tooling) — `node scripts/mcp-smoke.mjs` bundles the real client with the `obsidian` module stubbed and runs it against a spec-shaped local server: handshake, pagination, SSE framing, `isError`, `structuredContent`, JSON-RPC error mapping, and session-expiry recovery. Not shipped in the plugin bundle.
- **Vault retrieval (RAG)** — notes are chunked (paragraph-aware, configurable size/overlap), embedded via any OpenAI-compatible `/embeddings` endpoint (local ollama/lmstudio work offline; Anthropic has no embeddings API and Azure's deployment-specific URLs/auth can't satisfy the shape — both excluded), and stored int8-quantized in `<plugin-dir>/rag-index.json`. Each send embeds the latest user message and injects the top-k excerpts into the system prompt. Turns carrying an explicit `@`-mention attachment skip retrieval (curated context wins), and retrieval failures never block the send.
- **Incremental indexing** — rebuilds skip files whose mtime+size are unchanged; vault edits/deletes/renames update the index live via vault events (debounced 1.5s). All live updates no-op when retrieval is disabled or no index exists.
- **`semantic_search` agent tool** — meaning-based vault search alongside the keyword `search_notes`; hot-reloads with the settings toggle.
- **Settings → Vault retrieval group** — enable, embedding provider/model, chunk size/overlap, results per query, index status, rebuild and delete-index actions. Plus a "Rebuild vault index" command and a capability line in the core system prompt.
- **Conversation history delete** — the history dropdown gains a per-conversation delete action (hover-revealed) that moves the conversation file to the trash, so the storage promise ("delete trashes the file") has an actual UI.

### Fixed

Full-codebase audit pass (every line of `src/` reviewed; ~40 defects fixed, all dead code removed).

- **Local HTTP providers stream again** — streaming requests were routed through Node's `https` module regardless of protocol, so every `http://` endpoint (Ollama, LM Studio, llama.cpp, LiteLLM) failed instantly. The transport now selects `http`/`https` by URL.
- **Mobile streaming fallback** — a CORS-blocked streaming `fetch` (most providers) now retries once buffered via `requestUrl` with `stream: false` rewritten into the body, instead of dying with a generic network error. Aborting a request no longer surfaces a spurious "network error" or delivers the buffered answer into a finished chat bubble.
- **`/paste` works** — the command's clipboard text was erased in the same tick it was inserted.
- **Custom provider editing** — editing a provider no longer wipes its keychain-stored API key (the blank prefill was saved as a clear), no longer leaves a duplicate stale-endpoint registry entry, and validates the URL before saving. Key fields show a "stored" placeholder when the key lives in the OS keychain.
- **Regenerate is safe** — the assistant reply is no longer truncated before the provider-auth check; an expired key can't destroy the response with no replacement.
- **Mid-stream conversation switches** — switching conversations or starting a new chat while a response streams can no longer deposit the reply into the wrong conversation (store writes pin to the originating conversation).
- **Conversation persistence races** — an external modify during the 200ms debounce window no longer reverts just-added messages; app quit flushes pending writes through the awaited workspace `quit` event; serialization failures surface a Notice instead of stranding the dirty flag.
- **MCP hardening** — tool names are actually capped at 64 chars (an oversized server tool name got the whole tools array rejected by providers); disabling MCP mid-connect can no longer resurrect tools; a failed session-expiry reconnect flips the server status to error instead of staying "Connected"; servers without the tools capability connect with an empty toolset; server `ping` frames are answered; JSON-RPC responses with the wrong id are rejected.
- **Vault retrieval correctness** — edits made while a rebuild runs are queued and indexed afterward instead of being stamped with the new mtime under old content (permanently stale); the index file is written atomically (a crash can no longer truncate it into a silent full re-embed); incremental updates skip embedding into an index built with different provider/model/chunk settings.
- **Agent tools** — `edit_note` replace reports an error when the target text is absent instead of silently succeeding, and `$&`-style patterns in replacement text are no longer interpreted; `web_search`/`read_url` failures are marked as tool errors; `read_url` truncates JSON responses like plain text; `search_notes` caps its full-content fallback scan; tool arguments are type-checked against the declared schema.
- **Provider layer** — Anthropic custom endpoints are honored (requests no longer silently go to api.anthropic.com with a proxy's key); concurrent Anthropic streams no longer corrupt each other's token counts; Gemini model discovery authenticates with `x-goog-api-key` (the native endpoint rejects Bearer keys, so discovery always failed); SSE parsing accepts `data:` without a space, CRLF, and a final unterminated event.
- **History & memory** — cross-conversation search covers all conversations (the newest-200-messages cap no longer hid older ones, titles included); edit-resend restores the message's image and note attachments; memory facts collapse newlines instead of truncating on round-trip and categories are constrained to the five values that survive the markdown file.
- **UI correctness** — "Ask AI about selection" prefills the composer with the quoted selection instead of discarding it; the TTS player no longer freezes after its first re-render and stale utterance events can't stall the chain; a fast double-click on the mic no longer wedges voice input for the session; arena columns render their final markdown independently; the folder picker's duplicate vault-root row can no longer save `/` and break conversation-folder resolution; a failed settings migration stops at the failed step and retries next boot instead of being marked done.
- **Streaming usage & cost** — OpenAI/Azure/OpenRouter streaming now requests `stream_options.include_usage`, so streamed token counts are real; responses cut off by the max-tokens limit say so; per-message and `/stats` costs are computed from provider pricing (previously stored-but-never-computed).

### Removed

Dead-code sweep: everything below was declared but had no reader or caller.

- The prompt-templates module (`src/templates/`) — no UI, no persistence, no substitution engine; its builtin prompts duplicated the shipped selection actions.
- Dead settings — chat panel width (no Obsidian API can resize a docked leaf), hotkeys (commands use Obsidian's native hotkey system), budget limit, cost-tracking toggle (cost is now always computed), and the daily-notes-assistant trio. A v5 settings migration purges them from saved data.
- Dead surface — unused EventBus/HookSystem API, unused provider response-type files, dead conversation-store methods, and the `Conversation.tags`/`starred`/`branches` fields that no code path ever wrote.

## [1.2.0] — 2026-10-03

Declarative settings + zero-warning lint. Clears every fixable finding from the plugin directory's automated review.

### Changed

- **Minimum Obsidian version is now 1.13.0** (was 1.11.4). Obsidian 1.13.6 reached the stable channel for all desktop and mobile users in August 2026, which unlocked the settings migration the README ADR had been tracking.
- **Settings tab migrated to the declarative `getSettingDefinitions()` API** — every section and row is now indexed by Obsidian's settings search (find "agent", "ollama", "temperature" from the settings search bar). Visuals are unchanged; dynamic re-renders use the sanctioned `SettingTab.update()`. Removes the deprecated `display()` path entirely. `npm run lint` is now 0 errors / 0 warnings.
- **No more runtime `atob`/`btoa`** — image data-URL handling uses a small pure-JS base64 codec (`src/utils/base64.ts`). Same behavior; nothing for static payload-hiding heuristics to flag.

### Notes

- The directory scorecard's remaining findings are disclosures inherent to the feature set (vault enumeration by agent tools, clipboard for copy/paste commands) or scan-availability gaps on Obsidian's side (malware/obfuscation/network scans "not available").

## [1.1.1] — 2026-10-03

Crash-fix patch. Both bugs were found by the project's own automated screenshot harness driving a real Obsidian session.

### Fixed

- **Plugin fails to load when the memory file exists and the vault index is cold** — `MemoryStore.ensureFile()` checked the vault index, which can lag the filesystem during boot; `vault.create()` then threw `File already exists` and killed the entire plugin `onload` (no chat, no commands, no settings tab until the file was deleted). The check now reads the filesystem via the adapter, and create races are tolerated. Anyone who reloaded Obsidian with an existing `AI/Curtis Memory.md` could hit this intermittently.
- **Chat view render crash when refreshed mid-open** — `renderCurrentConversation()` dereferenced `messagesContainer` before the view's `onOpen` finished constructing it; a `refreshChatViews()` call racing view construction (e.g. open-chat command plus a settings change in the same tick) crashed the renderer. Now guarded — the half-constructed view simply renders on its own once open.

### Added

- **Automated screenshot harness** (dev tooling) — `npm run shots` + `npm run mockups` regenerate all marketing screenshots by driving Obsidian over the Chrome DevTools Protocol with Playwright. Not shipped in the plugin bundle.

## [1.1.0] — 2026-10-02

Agent mode for every provider. The headline v1.1 roadmap item ships; the "OpenAI-compat only" restriction is gone.

### Added

- **Anthropic agent support (native tool use)** — the agent loop now speaks Anthropic's tools dialect: tools serialize to `input_schema`, assistant turns carry `tool_use` blocks, tool results return as `tool_result` user turns (with `is_error`), and responses parse `tool_use` blocks into canonical tool calls. Claude models run the full 10-tool agent loop natively.
- **`calculator` tool actually registered** — it was advertised in the system prompt and docs since v1.0 but never registered, so models calling it got "Unknown tool: calculator". Ships with a safe recursive-descent evaluator (no `eval`): `+ - * / % ^`, unary minus, decimals, parentheses.

### Changed

- **Honest agent-provider copy** — Gemini and Ollama already worked (both speak OpenAI-format tools through their OpenAI-compatible endpoints); the settings hint and docs wrongly claimed they were blocked until v1.1. All copy now states: agent works with every major provider, gated only on the model supporting tool calling. README/docs provider tables updated.
- **Directory listing description** (from `manifest.json`) now mentions agent mode, multi-model arena, and voice I/O — propagates to the community plugin directory with this release.
- **Tool count is ten** — `get_current_date` was registered but unlisted in the README's tool enumeration; now correct everywhere.
- **UI copy sentence-case pass** — 43 `obsidianmd/ui/sentence-case` lint warnings fixed across settings and modal strings. Lint floor is now 0 errors / 14 warnings (the 13 documented `display()` deprecations plus the ADR-linked settings-tab warning).

### Removed

- Dead code: `ToolRegistry.getOpenAITools()` (superseded by the shared `buildToolParametersSchema` helper, now used by both the OpenAI and Anthropic serializers).

## [1.0.5] — 2026-09-28

Hotfix: keyless local providers were blocked from chatting. Closes #6.

### Fixed

- **Local providers (Ollama, LM Studio) rejected as "unauthenticated"** — provider construction dropped the registry's `authType: 'none'` flag, so keyless providers always failed the `isAuthenticated()` key check. Model discovery worked (it never consults the provider object), but sending a message raised "No AI provider configured or authenticated" — and the settings UI has no key field for these providers by design, leaving users stuck. `authType` now flows from the registry definition into the provider, and keyless providers are always authenticated. Also fixes custom OpenAI-compatible endpoints with auth set to "None" (llama.cpp, LiteLLM, self-hosted gateways), which hit the same wall.
- **CI maintenance** — merged dependabot bumps for `actions/checkout` (4 to 7) and `actions/setup-node` (4 to 7).

## [1.0.4] — 2026-09-19

Site-only release: no plugin code shipped in `main.js` changed.

### Changed

- **Documentation site** — NEWELL-branded footer with brand attribution, per-letter favicon set (`favicon.ico`, 32/512 px, apple-touch-icon), hero and logo placement refresh. Plugin code, `manifest.json`, and `main.js` are unchanged from 1.0.3.

### Added

- Dependabot auto-merge workflow (patch/minor only, gated on CI).

## [1.0.3] — 2026-07-23

Hotfix release. The 1.0.2 manifest declared `minAppVersion: 1.13.0` (a catalyst/insider-only build), which made the plugin uninstallable for every user on stable Obsidian (latest stable is 1.12.7). This release lowers the floor to 1.11.4 by removing the only 1.13-pinned APIs.

### Fixed

- **Install failure on stable Obsidian** — `minAppVersion` lowered from `1.13.0` → `1.11.4`. The 1.0.2 settings migration to the declarative `getSettingDefinitions()` API (Obsidian 1.13+) was the trigger; this reverts to the imperative `display()` API, which works on every version including 1.13+.
- **Settings tab renders again** — `renderSettings()` → `display()` (public override), and all 12 internal `this.update()` refresh calls swapped back to `this.display()`. The 1.0.2 changelog claimed this was deferred to v1.1; the version-floor bug forced the revert early.
- **Destructive buttons** — 3 `ButtonComponent.setDestructive()` calls (1.13-only) replaced with `btn.buttonEl.addClass('mod-destructive')`. Identical styling (Obsidian applies the same CSS class internally), ancient DOM API.

### Notes

- The true API floor is **1.11.4**, set by the `SecretStorage` API used for per-provider key storage in `core/secrets.ts`. `App.loadLocalStorage/saveLocalStorage` (1.8.7) and `Workspace.revealLeaf` (1.7.2) are also in use but below the floor. Nothing 1.13-specific remains.
- The declarative settings API (`getSettingDefinitions()`) is still the intended future path. A dual-path (`getSettingDefinitions()` + `display()` fallback) was evaluated and rejected: the declarative path's re-render call (`SettingTab.update()`) is also 1.13-only and trips `no-unsupported-api` regardless of runtime guards. Migration is deferred until 1.13 reaches stable — see the [Settings API ADR](README.md#settings-api) in the README. The 13 `display is deprecated` lint warnings are expected, justified, and non-blocking for plugin review.

## [1.0.2] — 2026-07-23

Clears the remaining scorecard warnings flagged by the Obsidian plugin directory's automated review. Local lint now reproduces the scanner ruleset exactly (`npm run lint` → 0 problems).

### Fixed

- **Default hotkeys removed** — `search-conversations` and `rewrite-with-ai` no longer bind `Ctrl+Shift+F` / `Ctrl+Shift+R` by default, per the Obsidian guideline against default hotkeys that conflict with user bindings. Both are still assignable under Settings → Hotkeys. Docs updated.
- **Unnecessary type assertions** — removed redundant `as` casts in `registry.ts` (3), `events.ts` (1), and `settings.ts` (1) that the scanner flagged as no-ops.
- **`display()` → `update()`** — all 13 settings-tab refresh calls now use `update()` instead of the deprecated `display()`.
- **ESLint toolchain upgraded** — migrated to ESLint 9 flat config (`eslint.config.mjs`) with `eslint-plugin-obsidianmd`. `npm run lint` now matches the directory's review ruleset, so scorecard issues are catchable locally before release.

### Notes

- The earlier scorecard scans reflected a stale build; this release ships a clean artifact verified against the matching ruleset. The `document.createElement`, `no-unsafe-*` clusters, and `eslint-disable` flags from prior scans were already gone from source — this release confirms it in the artifact the directory scans.

## [1.0.1] — 2026-07-23

Scorecard-hardening release. Closes the remaining issues surfaced by the Obsidian plugin directory's automated review of 1.0.0.

### Fixed

- **`read_url` tool** — Jina reader JSON response now narrowed through `isRecord` at the parse boundary instead of accessing `any` fields. Eliminates the last 8 `no-unsafe-*` lint warnings (zero-warning baseline now holds on the release artifact, not just source).
- **`styles.css`** — replaced the two `!important` declarations on the read-only Curtis identity textarea with a doubled-class selector that wins on specificity. Same visual result, no `!important`.
- **README** — added a "Network access" subsection under Privacy & security enumerating every external domain the plugin may contact and that all calls are user-initiated. Addresses the scorecard's undisclosed-external-domains flag.

### Notes

- The 1.0.0 scorecard reflected a stale release build; most flags (eslint-disable comments, `document.createElement`, the bulk of the `no-unsafe-*` cluster) were already fixed in source between tagging 1.0.0 and this release. 1.0.1 ships those fixes in the artifact the directory actually scans.
- `settings.ts` still uses the imperative `display()` API (13 call sites) rather than the declarative `getSettingDefinitions()` recommended for Obsidian 1.13+. This is a deprecation warning only — the tab works. Full migration deferred to v1.1.
- `atob`/`btoa` are retained for legitimate image-attachment encoding and data-URL decoding; documented in the README network section.

## [1.0.0] — 2026-07-23

Initial public release. Eight flagship features, full TypeScript type-safety at every provider boundary, and build-provenance attestation on every release asset.

### Added — Features

- **Curtis Agent** — AI can now call tools to read/create/edit your vault notes. Built-in tools: `read_note`, `search_notes`, `create_note`, `edit_note`, `list_notes`, `get_tags`, `get_backlinks`, `get_current_note`, `calculator`. OpenAI-compat providers only for v1.0; opt-in via Settings → Agent → Enable.
- **Multi-model arena** — click the wand icon in the chat header, pick 2-5 models, send one prompt, watch responses stream side-by-side. Click "Promote to chat" on any column to continue with that model.
- **Inline diff rewrite** — select text in any note, `Ctrl+Shift+R` (or right-click → "Rewrite with AI (diff)"). AI generates an improved version, modal shows line-by-line green/red diff with Accept/Reject.
- **`@`-mention vault notes** — type `@` in the chat input, fuzzy-search vault notes, attach. Note contents are prepended to your message as invisible context for the AI.
- **Voice I/O** — mic button in chat input (records via `MediaRecorder`, transcribes via OpenAI Whisper, appends to input). Speaker button on every assistant message (uses browser's `speechSynthesis`). Auto-speak toggle in header for hands-free listening.
- **Cross-conversation search** — `Ctrl+Shift+F` opens a fuzzy-matched picker across all conversations. Click result to switch.
- **Markdown export** — download any conversation as a `.md` file (with provider display names, timestamps, image references). `/export` slash command or download icon in chat header.
- **Memory editing UI** — edit/delete individual memory facts from Settings → Memory. Previously append-only.
- **Native active-note awareness** — the chat header shows a pill for the note open in the editor. One click attaches it to the pending message. The system prompt also gains a context-precedence block so the model knows to prefer attached/active note content over re-searching.

### Added — Internals

- Full TypeScript schemas for every AI provider response shape (OpenAI-compat, Anthropic, Gemini, Ollama)
- Type-guard utilities for safe JSON boundary narrowing (`src/core/types/json-helpers.ts`)
- Shared SSE parsing utilities (`src/providers/types/sse.ts`)
- Strict ESLint config (`@typescript-eslint/recommended-requiring-type-checking`) for local verification
- Privacy section in README documenting vault access

### Fixed

- All `@typescript-eslint` lint warnings resolved (zero-warning baseline established)
- All `no-floating-promises` warnings resolved via explicit `void` operator or `await`
- All `no-unsafe-*` warnings resolved via type-guard narrowing at JSON boundaries
- Unnecessary type assertions removed throughout `providers/`, `settings.ts`, `chat/`, `commands/`

### Notes

- `fetch()` retained in `transport.ts` for mobile streaming — Obsidian's `requestUrl` does not support SSE streaming. Documented with eslint-disable + architectural rationale.
- Declarative `getSettingDefinitions()` migration attempted but reverted — Obsidian 1.13.1 runtime bug where the framework calls `display()` unconditionally despite the docs. Revisit in v1.1.
