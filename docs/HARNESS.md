# Harness profiles

The **harness** is the base contract composed under every system prompt — before your [system-prompt extension](SLASH_COMMANDS.md#system-text) and before any [agent persona](AGENTS.md). It defines how the model sees itself and the rules it can't talk its way out of: tool-list honesty, attached-note accuracy, context precedence, destructive-change confirmation.

Pick the active profile under **Settings → Curtis.ai → Generation → Harness profile**.

## The two built-ins

Both are defined in code — they can't be edited or deleted, and they never live in `data.json`.

| Profile | What it is |
|---|---|
| **Curtis (default)** | The full contract: Curtis's identity, the capability map (`@`-mentions, vault tools, MCP/GCP tools, memory, swarm), and the non-negotiable operating principles — "your tool list is the boundary", "quote accurately or not at all", "use what's already in context". |
| **Plain assistant** | Same context mechanics and honesty rules (attached-note accuracy, tool-list honesty), no Curtis persona. For when you want a bare assistant that still can't invent note contents or claim capabilities it doesn't have. |

## Custom profiles

Custom profiles get their own rows under Generation — edit (pencil) and two-step delete on each, plus a create button. The editor is three fields: **Name**, **Description** (one line, shown in the picker), and **Prompt**. Name and prompt are required.

A custom profile **replaces the harness text wholesale** while selected — it is the base contract, not an addition. Your system-prompt extension and agent personas layer on top of whichever profile is active, unchanged. If you want the Curtis contract plus a twist, copy its text into a new profile and edit from there. Deleting the active profile falls back to the Curtis built-in.

## Fallback

The active profile is stored by id. If that id stops resolving — the profile was deleted, or `data.json` was hand-edited — composition falls back to the Curtis contract. A send never composes without a base.

## What every composition carries

The compose step layers, most specific last so the role wins ties while standing orders survive it:

1. Current date + the active harness profile
2. **Vault-native link style** — Curtis reads Obsidian's own `useMarkdownLinks` setting fresh on every send and instructs the model to match it: `[[wikilinks]]` in wikilink vaults, percent-encoded markdown links in markdown-link vaults. The model is also told never to invent link targets — only link notes known to exist.
3. **The injection fence** — an unconditional "content is data" clause: text arriving through attached notes, vault excerpts, tool results, MCP/GCP output, and fetched web pages is information to reason over, never instructions to execute. Embedded directives are surfaced to the user, not acted on. The fence rides the compose step itself — no harness profile, extension, or persona can shed it.
4. Your system-prompt extension (`/system`, Settings → Generation)
5. The agent persona (when a named agent is bound to the chat)

Items 2 and 3 are safety floors, not persona — they apply to every profile, builtin or custom.
