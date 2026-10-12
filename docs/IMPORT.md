# Chat import & the `.curt` format

Move your chat history from other AI tools into Curtis and continue without missing a beat. New in v2.0.

Curtis chats are plain markdown files in your vault, so "importing" means writing those files — imported conversations land in `AI/Conversations/` like any other chat: searchable in Obsidian, synced across devices, and readable by the agent. Continuing an imported chat sends its full history to **whatever provider you have active** — the original provider/model is kept as display metadata on each message.

## Import from Claude Code (desktop)

Beyond chat history, Curtis can adopt your whole Claude Code setup in one pass — command palette: **"Import Claude setup"**, or Settings → Conversations → **Import from Claude**. Desktop only (it reads config files outside the vault); the scan is a pure local file read, nothing is sent anywhere.

| What's scanned | Where | What happens |
|---|---|---|
| MCP servers | `~/.claude.json` (user scope) + `<vault>/.mcp.json` (project) | HTTP servers import as **disabled** Curtis MCP servers — review, then enable. Legacy SSE servers import disabled with a bridge note. stdio servers can't run in Curtis (no child processes) — the checklist shows a ready-to-run `mcp-proxy` bridge command instead; the command may display the entry's `env` values, which are **never** written to any Curtis config. |
| Skills | `~/.claude/skills`, `~/.agents/skills`, `<vault>/.claude/skills` | Skill folders (a folder with a `SKILL.md`) are copied verbatim into `AI/Skills/`. They're the open [Agent Skills](https://agentskills.io) standard — validation happens in [Skills](SKILLS.md), and invalid files surface in Settings → Skills with the reason. |
| Subagents | `~/.claude/agents/*.md`, `<vault>/.claude/agents/*.md` | Each frontmatter markdown file becomes a Curtis [named agent](AGENTS.md): body → persona, `description` → the agent's description, `tools` → coarse tool-ceiling mapping (unrecognized names are reported, never guessed), `model` alias → noted, routing left empty so the agent follows your active lane. Agents import with **remote invocation off**. |
| CLAUDE.md | `~/.claude/CLAUDE.md`, `<vault>/CLAUDE.md` | Offered as a harness profile ("Claude Code (global/project)") — activate it or ignore it; nothing is auto-switched. |

Everything imports disabled: nothing connects, nothing runs, until you turn it on. Existing items are never overwritten — duplicates by URL (MCP) or name (agents, skills) are skipped and reported. Re-running the import is safe. Export goes the other way too: the agent editor has "Copy as a Claude agent file", and Settings → Agents → "Export agents as Claude files" writes every agent into `AI/Exports/Claude agents/`.

**Why [Curtis Porter](https://github.com/JordanNewell/curtis-ai-chat-porter) isn't part of this.** Porter solves a translation problem: it converts *proprietary chat exports* (ChatGPT/Claude `conversations.json`) into Curtis's conversation format, for people who aren't in Obsidian yet. The Claude Code legs need no translation — skills and subagents are already shared open formats, so "conversion" is a file copy plus a small field map that has to run where the destinations live (the vault and Curtis's settings stores). It lives in the plugin, on the far side of the install line from Porter. The mapping logic is nevertheless written to the same Obsidian-free standard as the conversation serializer, so a future Porter command could scaffold a fresh vault with skills and agents pre-staged before first launch — if that ever earns its keep.

## Where chats live

Every conversation — new, imported, or spawned by the [swarm](SWARM.md) — persists as one markdown note in **`AI/Conversations/`** (change the folder under Settings → Conversations). The file is the storage: there is no database. Edit it by hand and Curtis picks up your edits; delete it and the chat is gone.

The layout is stable and human-readable:

- **Frontmatter** — `curtis: conversation`, plus the id, created/updated timestamps, and the provider/model the chat is currently on ([swarm](SWARM.md) chats record `role: leader` / `follower`, and a follower keeps its `leaderId`)
- **`# Title`** — the conversation title
- **One section per message** — `## You`, `## AI`, `## Tool`, or `## System`, each opening with a small `<!-- curtis:msg {...} -->` HTML comment that carries the machine metadata: id, timestamp, role, and where applicable the provider/model, token and cost figures, image and attachment references, tool-call records, and which memories a reply used

The serializer/parser for this format is deliberately Obsidian-free, so external tools can read and write it — [Curtis Porter](https://github.com/JordanNewell/curtis-ai-chat-porter) does exactly that. History that predates conversation files (the old localStorage store) imports itself into the folder once on upgrade; the original copy is left in place.

## Supported sources (auto-detected)

You never pick a format. Drop or select a file and Curtis figures out what it is:

| Source | What it looks like | Notes |
|---|---|---|
| **ChatGPT export** | `conversations.json`, plain or still zipped | From [chat.openai.com](https://chat.openai.com) → Settings → Data controls → Export. Branch artifacts and platform system prompts are dropped; the model used is recorded per answer. |
| **Claude export** | `conversations.json` | From [claude.ai](https://claude.ai) → Settings → Privacy → Export data. |
| **`.curt` file** | Curtis's portable format | Full fidelity — ids, token stats, images survive byte-perfect. |
| **Curtis markdown** | A transcript with `curtis: conversation` frontmatter | Move chats between vaults by copying files. |
| **Generic JSON** | `[{"role": "user", "content": ...}, ...]` or `{messages: [...]}` | Also accepts `from: human/bot/gpt` style keys. |
| **Generic markdown** | Role headings (`## You`) or bold labels (`**User:**`) | Best-effort. Documents without a confident user+assistant split are rejected, not guessed. |

Tool-call output from foreign transcripts is not imported — without tool-calls linkage those messages would make providers reject the request when Curtis re-sends the history.

## Four ways to import

1. **Command** — "Import chats from other AI tools" in the command palette (multi-select picker, works for whole export zips).
2. **Drag-and-drop** — drop a supported file onto the chat view.
3. **`.curt` in the vault** — double-click a `.curt` file for a one-click import page.
4. **Right-click** — "Import into Curtis" on any `.curt` / `.json` / `.zip` / `.md` / `.txt` file in the file explorer.

Also in **Settings → Conversations → Import chats from other AI tools**.

Re-running an import is idempotent: conversations already present are skipped, so you can't double-import an export.

## Bulk export

"Export all chats as .curt (zip)" — command palette, or Settings → Conversations — writes every conversation as a `.curt` file into one zip (`curtis-chats-<date>.zip`, named `<date> <title> <id6>.curt` inside). Whole-history backup, vault-to-vault move, machine-to-machine transfer. The zip is itself importable: drop it into another vault's import flow and it's auto-detected as a batch of `.curt` files — already-present conversations are skipped, so re-importing is safe.

The zip also feeds [Curtis Porter](https://github.com/JordanNewell/curtis-ai-chat-porter), the standalone converter for people not in Obsidian yet — it turns any export into `.curt` and vault-ready markdown, local-first.

## Full backup

**Export full backup (chats, prompts, harnesses, settings)** — command palette — writes `curtis-backup-<date>-<time>.zip`: every conversation plus the prompt library, your custom harness profiles (built-ins live in code and don't ride along), and settings with API keys stripped. Where the bulk `.curt` zip moves your chat history, the full backup moves your whole Curtis setup.

Restore by importing the zip through any import entry point — it's auto-detected as a backup bundle and a dialog asks which sections to apply:

| Section | What happens |
|---|---|
| Conversations | Import through the normal pipeline (idempotent, already-present chats skipped) |
| Prompt library | Merged by id — existing entries win |
| Harness profiles | Merged by id — existing entries win |
| Settings | Applied wholesale (agents, scheduled jobs, provider setup) with your local credentials preserved |

## The `.curt` format

One `.curt` file = one conversation. Export any chat via the header download icon → **Save as .curt (portable)**.

It's JSON with a magic field and version:

```json
{
	"curt": "curtis-conversation",
	"version": 1,
	"conversation": {
		"id": "conv_...",
		"title": "Weekly review",
		"createdAt": 1791032809819,
		"updatedAt": 1791032900000,
		"provider": "anthropic",
		"model": "claude-sonnet-4-5",
		"messages": [ ... ]
	}
}
```

Why JSON instead of the markdown+markers layout used inside the vault: a portable file must be byte-robust — no marker-escaping edge cases, and base64 images or tool-call metadata survive verbatim. Inside the vault the markdown files stay human-readable; `.curt` is the shipping container.

Use cases: moving chats between vaults or machines, archiving conversations outside the vault, sharing a chat with another Curtis user, keeping one-off copies of a conversation before a risky experiment.
