# Curtis AI Chat — feature gallery

Auto-captured 2026-10-14 from a live Obsidian session on the demo vault (real UI, real stores, real shells).
Stills marked **seeded** render fixture conversations through the real view; **live** scenes ran through the plugin’s real pipelines — streaming over a local OpenAI-compatible mock endpoint, or real tool execution in the vault.

| Category | Feature coverage |
|---|---|
| **Scheduled runs** | 2 stills, 0 videos — docs/SCHEDULED_RUNS.md |
| **Voice & notifications** | 2 stills, 0 videos — docs/VOICE.md, docs/NOTIFICATIONS.md |
| **Settings surface** | 21 stills, 0 videos — docs/RUNBOOK.md |

---

## Scheduled runs

### Scheduled runs — Run now

The settings card with a daily job, then a real manual fire: the headless run lands as a markdown note and the row shows its status.

- 🖼️ [`scheduled/scheduled-runs-card.png`](scheduled/scheduled-runs-card.png)
- 🖼️ [`scheduled/scheduled-runs-card-after.png`](scheduled/scheduled-runs-card-after.png)

## Settings surface

### Settings — every group

The full settings surface: providers, generation, agent, agents, skills, terminal, chat UI, voice, notes, conversations, MCP, GCP, about.

- 🖼️ [`settings/active-provider.png`](settings/active-provider.png)
- 🖼️ [`providers/providers-configuration.png`](providers/providers-configuration.png)
- 🖼️ [`settings/generation.png`](settings/generation.png)
- 🖼️ [`settings/autocomplete.png`](settings/autocomplete.png)
- 🖼️ [`settings/agent.png`](settings/agent.png)
- 🖼️ [`settings/agents.png`](settings/agents.png)
- 🖼️ [`settings/skills.png`](settings/skills.png)
- 🖼️ [`settings/terminal.png`](settings/terminal.png)
- 🖼️ [`settings/chat-ui.png`](settings/chat-ui.png)
- 🖼️ [`voice/voice-settings.png`](voice/voice-settings.png)
- 🖼️ [`settings/notes.png`](settings/notes.png)
- 🖼️ [`settings/conversations.png`](settings/conversations.png)
- 🖼️ [`settings/about.png`](settings/about.png)
- 🖼️ [`context/memory-settings.png`](context/memory-settings.png)
- 🖼️ [`context/memory-edit-modal.png`](context/memory-edit-modal.png)
- 🖼️ [`providers/provider-ollama.png`](providers/provider-ollama.png)
- 🖼️ [`providers/custom-provider-modal.png`](providers/custom-provider-modal.png)

### Settings — MCP client + Curtis’s own MCP server + GCP

MCP servers you already run can be added as agent tools; Curtis can also SERVE the vault itself over localhost MCP; GCP connects read-only Cloud Storage.

- 🖼️ [`mcp/mcp-client-servers.png`](mcp/mcp-client-servers.png)
- 🖼️ [`mcp/mcp-add-server-modal.png`](mcp/mcp-add-server-modal.png)
- 🖼️ [`mcp/mcp-server-settings.png`](mcp/mcp-server-settings.png)
- 🖼️ [`settings/gcp-connection.png`](settings/gcp-connection.png)

## Voice & notifications

### Voice I/O + notifications

Whisper dictation in, read-aloud with the sentence player; desktop toasts when a reply lands while you are away (in-app notice on mobile).

- 🖼️ [`voice/voice-settings.png`](voice/voice-settings.png)
- 🖼️ [`voice/notification-settings.png`](voice/notification-settings.png)

---

Manifest with per-capture timing and status: [shots-manifest.json](shots-manifest.json).