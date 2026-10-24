# Permission rationale

For the Obsidian directory-review scanner, security reviewers, and
contributors. Maps every sensitive API call site in `src/` to the feature that
requires it. Current as of 2.0.1.

Every call site below serves something you invoke directly in the UI, or an
agent tool call / MCP request inside a session you configured. Nothing here
runs unprompted in the background. The user-facing summary, including the full
outbound-network table, lives in the README under
[Privacy & security](README.md#privacy--security).

## Vault enumeration

Obsidian flags `vault.getFiles()` and `vault.getMarkdownFiles()`. The plugin
has eight `getMarkdownFiles()` sites and one `getFiles()` site:

| Call site | Feature | Scope |
|---|---|---|
| `src/core/tools.ts` — `search_notes` | Agent tool: find notes by name or content | Markdown notes; results capped |
| `src/core/tools.ts` — `list_notes` | Agent tool: list notes in a folder | Filtered to the requested folder; capped |
| `src/core/tools.ts` — `get_tags` | Agent tool: tag frequency table | Reads tags via the metadata cache; returns tag names only |
| `src/chat/view.ts` — `getMatchingNotes` | `@`-mention note autocomplete | Basenames and paths only; capped at 10 |
| `src/chat/message-renderer.ts` | `[[wiki-link]]` resolution in rendered chat messages | Paths only, to linkify |
| `src/chat/conversation-files.ts` | List saved conversations | Filtered to the plugin's conversation folder |
| `src/rag/index-manager.ts` | Vault retrieval index build (opt-in) | All markdown notes; chunks embedded by the engine configured in Settings → Vault retrieval |
| `src/mcp/server/manager.ts` | MCP resource snapshot | Local MCP server only (loopback bind, bearer token); paths and mtimes |
| `src/ui/modals/image-suggest-modal.ts` — `vault.getFiles()` | Wallpaper / image fuzzy picker | Filtered to image extensions |

All other vault access is a point lookup (`getAbstractFileByPath`) against one
specific path — a note you attached, the wallpaper file, a conversation file.

## Clipboard

Exactly one read: the `/paste` slash command (`src/chat/slash-commands.ts`),
which runs when you type it and shows a notice if permission is denied.
Pasting images with Ctrl+V goes through the DOM paste event
(`src/chat/view.ts`), not the async clipboard API.

Writes, each behind an explicit click: copy code block
(`src/chat/message-renderer.ts`), copy message and copy raw markdown
(`src/chat/message-actions.ts`), the `/copy` command
(`src/chat/slash-commands.ts`), copy install command / MCP token
(`src/settings.ts`), copy exported agent definition
(`src/ui/modals/agent-editor-modal.ts`), copy terminal selection
(`src/terminal/view.ts`), copy last request body (debug — two sites in
`src/settings.ts`).

No clipboard listeners, no polling, no background reads or writes.

## Dynamic code execution

`src/` contains no `eval()` and no `new Function`. The bundled `main.js`
contains exactly one `new Function`, inherited from `@huggingface/transformers`
(transformers.js): its ONNX/WebGPU runtime builds wrappers around exported
WebAssembly functions at load time. It backs the opt-in Local embeddings
engine for vault retrieval; model weights are a one-time download from
`huggingface.co`, then cached. No plugin-controlled or vault-derived string is
ever passed to dynamic evaluation.

## Out of scope by design

- No telemetry, analytics, or auto-update checks
- No clipboard monitoring
- No keystroke capture
- No vault reads outside the paths above; tool results travel only to the
  provider you configured — Ollama keeps everything on-device

## Keeping this document current

After touching vault, clipboard, or bundling code, re-derive the mapping:

```sh
grep -rnE "getMarkdownFiles|\.getFiles\(" src/
grep -rn "navigator.clipboard" src/
grep -rnE "eval\(|new Function" src/ main.js
```

If a new site appears, add it to the tables above or remove the call.
