# Skills

Skills are reusable capability packages from the **open [Agent Skills](https://agentskills.io) standard** — the same format used by Claude Code, Cursor, Copilot, Gemini CLI, OpenCode, and other compatible agents. A skill is a folder with a `SKILL.md`: frontmatter metadata plus markdown instructions. Because the format is shared, skills move in both directions: drop a community skill into your vault, hand your vault skill to any other agent.

Why package instructions at all: any procedure you find yourself re-explaining — how you want PDFs handled, how your weekly review runs — can be written once, kept as plain markdown in your vault, and loaded whenever a task matches. The `description` line is the index the model reads; the body is the procedure it follows.

Enable them under **Settings → Curtis.ai → Skills**.

## Getting skills in

Three ways, all ending in the same vault folder:

1. **One-click import** (desktop) — **Import from Claude** scans `~/.claude/skills`, `~/.agents/skills`, and the vault's `.claude/skills`, and copies every skill folder into `AI/Skills/`. See [IMPORT.md](IMPORT.md#import-from-claude-code-desktop).
2. **Copy the folder in yourself** — any skills-compatible agent's folder works; drop it under `AI/Skills/`.
3. **Write one** — Settings → Skills → Open / create makes a starter to edit.

Because the format is the open standard, skills also move out the same way: take any `AI/Skills/<name>/` folder and hand it to Claude Code, Cursor, or Copilot.

## Format

```
AI/Skills/
└── pdf-processing/
    ├── SKILL.md          # required: metadata + instructions
    ├── references/       # optional: docs the agent reads on demand
    ├── assets/           # optional: templates, data files
    └── scripts/          # optional: code (run it via run_command if enabled)
```

`SKILL.md` is YAML frontmatter + markdown body:

```markdown
---
name: pdf-processing
description: Extract PDF text, fill forms, merge files. Use when handling PDFs.
---

# Instructions

1. ...
```

Spec rules the loader enforces: `name` (1–64 chars, lowercase letters/digits/single hyphens) must match the folder name; `description` (1–1024 chars) says what the skill does **and when to use it** — that line is what the model reads when deciding to load the skill. Unknown frontmatter fields are tolerated, never rejected, so future spec revisions keep working. Files that fail validation show up in Settings → Skills with the reason and are never injected.

## How the model gets them

Loading follows **progressive disclosure**: the model always sees a one-line index, and pays the context cost of the full text only when a task calls for it. Three stages:

1. **Discovery** — every enabled skill's name + description rides the system prompt as a compact index (~100 tokens per skill) in chats, arena runs, headless runs, and swarm followers. All of them, on every provider.
2. **Activation** — the full instructions load only when needed:
   - The model calls the **`load_skill`** tool (agent mode) when a task matches a description.
   - You attach it explicitly with **`/skill <name>`** — works in plain mode with no tools at all.
   - A caller pre-activates it through the **plugin API** (`chat`/`runAgent` `skills` option) — scheduled runs and MCP clients included.
3. **Execution** — bundled `references/` and `assets/` stay unread until a loaded skill points at them; the agent fetches them with the ordinary note tools using the real vault paths.

A per-skill override (`Settings → Skills`) can force **Always in context** instead — the full body rides every request. Use it for skills you want applied unconditionally; leave the rest on demand so context stays lean.

## Where skills apply

Everywhere inference runs: normal chats, arena mode, swarm leaders and followers, scheduled runs, the MCP server's `run_agent`, and the plugin API. Agents can pin skills (`skillIds` on the agent) so a specialist always runs with its procedure loaded. Deliberate exceptions: autocomplete, selection actions, recap, and memory extraction keep their minimal prompts and never see skills.

## Controls

| Control | Where |
|---|---|
| Master toggle | Settings → Skills → Enable skills |
| Skills folder | Settings → Skills (default `AI/Skills/`) |
| Starter skill | Settings → Skills → Open / create |
| One-click import (desktop) | Import from Claude — see [IMPORT.md](IMPORT.md#import-from-claude-code-desktop) |
| Per-skill enable + load mode | Settings → Skills rows |
| Pin to an agent | Agent editor → Skills — rides every run of that agent, swarm followers included; advertised on the swarm roster |
| Leader attaches per subtask | `spawn_agent`'s `skills` parameter |
| Attach to this chat | `/skill <name>` (`/skill` bare = list, `/skill off` = detach all) |
| Pre-activate headlessly | `api.chat(prompt, { skills: [...] })`, `api.runAgent(name, task, { skills: [...] })` |

`load_skill` counts as a vault-class tool: an agent with vault tools off can't pull skill bodies either.

## Authoring tips

- Write the `description` for a model, not a human: say what it does **and** the trigger — "Use when the user asks to …".
- Keep `SKILL.md` under ~500 lines; move depth into `references/` files and point at them.
- To duplicate a skill, rename the folder **and** the `name` field together.
- Skills are instruction content, same trust class as the rest of your vault — the injection fence still applies to note contents and tool output, and skill text is user-authored by definition.
