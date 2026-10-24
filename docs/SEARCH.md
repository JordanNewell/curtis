# Cross-conversation search

> Find any message across every conversation, past and present.

Every conversation is a markdown file in `AI/Conversations/` (see [IMPORT.md](IMPORT.md#where-chats-live)). Cross-conversation search scans those vault conversation files in memory, fuzzy-matching against **every conversation title and every message body** at once, then jumps you straight to the result.

Because chats live as files you own, this search runs over your own records — not a hidden database on someone else's server. There is nothing to configure and nothing to trust: the same text Obsidian can see, Curtis can search. This answers "what did I decide about X three weeks ago"; for questions about your *notes*, use [vault retrieval](VAULT_RETRIEVAL.md) instead — that searches the vault, this searches your chat history.

## Opening the search

Two ways:

- **Keyboard:** "Search conversations" command — assignable via Settings → Hotkeys (no default)
- **Mouse:** click the magnifier icon in the chat header

The picker uses Obsidian's `FuzzySuggestModal`, so matching is forgiving — partial words, out-of-order terms, and abbreviations all work.

## How results appear

Each result is one (conversation, message) pair. The picker shows:

```
2026-07-21 Standup — Three decisions: ship v3.0.1 by Friday, defer the memory rewrite...
Q3 planning notes — Revenue target was set at $4.2M based on last quarter's run-rate...
Bug triage — Fixing the OAuth scope bug required rotating the Linear client secret...
```

The format is `<conversation title> — <first 100 chars of the matching message>`. The conversation title (or its date if untitled) leads so you can recognize context before reading the snippet.

Click a result (or `Enter` on a highlighted one) and:

1. The conversation loads in the chat view.
2. The view scrolls to the matching message.

## Performance

The search loads your vault conversation files and iterates every conversation and every message in memory. For users with thousands of messages this is fast (sub-100ms) but not instant — there's no index, just a linear scan with substring matching. Practical limits:

- **~10,000 messages:** results appear within a keystroke or two.
- **~100,000 messages:** you'll feel a small delay on each search open (~200–400ms). Still usable.
- **Beyond that:** consider exporting older conversations via `/export` and clearing them with `/clear` to keep working memory manageable.

## What gets searched

- ✅ Conversation titles (or the auto-generated date title if untitled)
- ✅ User message text
- ✅ Assistant message text
- ❌ Image attachments (binary, not text-searchable)
- ❌ Memory facts (those live in `AI/Curtis Memory.md` — use Obsidian's native search)
- ❌ Tool-call payloads and results

## Tips

- **Restrict by date:** title your conversations with a date prefix (`2026-07-23 Standup`) so date queries match in the title field first.
- **Match model names:** provider/model identifiers are stored on each assistant message — searching `claude` will surface every Claude-written message across all conversations.
- **No query, just browse:** open the picker without typing to scroll through every conversation chronologically.
