# community.obsidian.md — directory copy update

**Use:** Replacement text for the plugin's directory listing fields, for the release after 2.0.0 (harness profiles, skills, prompt library, hybrid retrieval, webhooks, Claude Code import, backup/restore). Version assumed 2.1.0 — rename this folder if the bump lands differently.

**Context:** The plugin page body is a separate submission field (~940 chars), not the rendered README. The v1.0.0 text (30+ providers, 2–5 model arena, no agent layer) is retired. The listing was already accepted under id `curtis-ai-chat`; this is a copy update, not a fresh submission.

---

## Submission fields

**Plugin name:** Curtis.ai (display-name change from "Curtis AI Chat" — ship it with this submission; the directory id stays `curtis-ai-chat` forever)

**Repository URL:** https://github.com/JordanNewell/curtis-ai-chat

**Author:** Jordan Newell ([@JordanNewell](https://github.com/JordanNewell))

**Manifest version:** 2.1.0 (run `npm run version` before submitting)

**minAppVersion:** 1.13.0

**Funding URL** (donation — optional, matches `manifest.json` `fundingUrl`):

- Buy Me a Coffee: https://www.buymeacoffee.com/jordannewell
- GitHub Sponsors: https://github.com/sponsors/jordannewell

---

## Payments field — "Describe the features that require payment" (300-char limit)

Nothing is paywalled, so the answer states that first, then ties the funding URLs to it and covers the BYOK nuance (274/300 chars):

No features require payment. The plugin is entirely free, MIT-licensed. Donations are optional (Buy Me a Coffee, GitHub Sponsors). AI usage is bring-your-own-key — any costs go directly to your chosen provider (ChatGPT, Claude, Gemini, …), or nothing at all on local Ollama.

Leave **Private source repository** unchecked — the repo stays public MIT; the open-source posture is part of the trust story.

---

## Categories (directory listing, max 3)

Recommended: **AI**, **Search**, **Automation** (slugs `ai`, `search`, `automation`).

- **AI** — the cluster where every competitor sits (Copilot: ai/commands/project-management; Smart Connections: ai/links/search; Text Generator: ai/writing). Non-negotiable.
- **Search** — claims the Smart Connections lane: hybrid RAG + semantic search over the vault is a headline 2.x feature.
- **Automation** — the differentiated agentic lane (scheduled runs, agents, MCP, terminal, webhooks); no other AI plugin is categorized there (Templater owns it today).

Drop the current **Sidebar** (UI placement, not a job-to-be-done) and **Editing** (weakest claim — dedicated editing plugins and Text Generator's writing lane own it). Current listing is ai/sidebar/editing; changing categories goes through the same dashboard update.

---

## Short submission blurb (directory listing)

The directory listing description is frozen in `community-plugins.json` at last submission — it currently reads "30+ providers, agent mode with 11 vault tools…", and that frozen text is what directory search indexes. This update replaces it. Matches `manifest.json` `description` word-for-word:

AI chat + agent for Obsidian. 53 providers: ChatGPT, Claude, Gemini, DeepSeek, Ollama + local. Agent tools edit your notes, MCP client & server, skills, RAG vault search, scheduled runs, arena. Free, MIT.

---

## Long description (plugin page body, ~940 chars)

The agent layer for Obsidian. Every provider, one sidebar — 53 built-in, OpenAI to Ollama, plus custom endpoints.

**Agent mode** — the model reads, creates, and edits notes: 12 built-in tools plus any MCP server. Opt-in.

**Named agents & swarm** — personas with model routing and tool ceilings; leaders spawn followers in their own panes.

**Skills** — reusable procedures in the open Agent Skills standard, portable to/from Claude Code.

**Arena** — one prompt streamed to 2–4 models side-by-side; promote the winner to a chat.

**Memory + retrieval** — ask-before-saving facts with provenance; hybrid semantic + keyword search over your vault.

Also: scheduled runs, terminal, multi-pane chat, voice I/O, diff rewrite, autocomplete, imports from ChatGPT/Claude/Claude Code.

Conversations are markdown notes in your vault. Keys in your OS keychain. No telemetry. Local on Ollama. Free, MIT.
