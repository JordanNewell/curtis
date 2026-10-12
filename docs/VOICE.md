# Voice I/O

> Talk to Curtis. Listen to Curtis. Hands-free.

Two voice features, each with a choice of engines:

- **Speech-to-text (STT)** — click the mic button, talk, transcribed text lands in the chat input. Transcribe on your **OpenAI key** (Whisper), on **Groq** (`whisper-large-v3-turbo`, cheaper and faster), or on any **custom OpenAI-compatible endpoint**.
- **Text-to-speech (TTS)** — click the speaker button on any assistant message to hear it read aloud through a sentence player with karaoke highlighting. Use the **system voices** (built in, offline, free) or a **neural voice** on your OpenAI key (OpenAI `/v1/audio/speech`) that sounds dramatically better.

Voice settings live in **Settings → Curtis.ai → Voice** and persist across restarts: auto-speak, the engine, the voice, the default rate, and sentence highlighting.

## Speech-to-text (dictation)

### Requirements

- Dictation on **OpenAI** (default): an **OpenAI API key** configured under Settings → Curtis.ai → Provider Configuration (the OpenAI card must be enabled).
- Dictation on **Groq** or a **custom endpoint**: a dedicated **Dictation API key** (Settings → Voice) — it is separate from every provider key and stored in the OS keychain when available.
- A browser/Electron environment with `MediaRecorder` support (all desktop Obsidian, most modern mobile).

### How to use

1. Click the **microphone icon** 🎙️ in the composer row
2. Obsidian may prompt for microphone permission — allow it
3. Speak your message
4. Click the mic icon again (or the stop button) to end recording
5. The recording is transcribed and the text appears in the chat input
6. Edit if needed, then send as normal — or switch on **Auto-send after dictation** (Settings → Voice) and the message sends itself the moment text lands

### Endpoints

| Endpoint | Auth | Model |
|---|---|---|
| **OpenAI** (default) | The OpenAI provider key | `whisper-1` |
| **Groq** | The dictation key | `whisper-large-v3-turbo` (preset fills this in) |
| **Custom** | The dictation key | Any model the host serves |

Custom hosts must expose an OpenAI-compatible `/audio/transcriptions` route; the base URL works with or without a trailing `/v1`.

### Technical details

- Audio is captured via `MediaRecorder` with a codec preference of `audio/webm;codecs=opus`, falling back to `audio/webm`, `audio/ogg;codecs=opus`, or `audio/mp4` based on what the platform supports
- The audio blob is POSTed as `multipart/form-data`
- Uses raw `fetch()` rather than Obsidian's `requestUrl` because transcription APIs require `multipart/form-data` bodies, which `requestUrl` doesn't support

## Text-to-speech

### Engines

| Engine | Quality | Cost | Needs |
|---|---|---|---|
| **System voices** (default) | Platform-dependent | Free, offline, no key | `speechSynthesis` (built into every modern browser and Electron) |
| **Neural (OpenAI)** | Far more natural | Billed per character on your OpenAI key | OpenAI provider key |

The neural engine reads through the same sentence player with the same controls, pauses, skips, and karaoke highlighting as the system voices — only the audio source changes. Clips are cached (an LRU of ~20 sentences), the next sentence is prefetched while the current one plays, and skip-back replays instantly from cache.

If a neural request fails (network, quota, bad key), Curtis Notices once and **falls back to the system voice for the session** — the player never dies mid-message. A missing OpenAI key does the same, silently after one notice.

**Neural settings:** voice (alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer), model (`gpt-4o-mini-tts` — steerable — or the `tts-1` / `tts-1-hd` pair), and an optional **Reading style** ("warm narration", "explain like a colleague") that steers `gpt-4o-mini-tts`; `tts-1` models ignore it.

### How to use

- **One message** — hover any assistant message and click the **speaker icon** 🔊
- **Auto-speak** — toggle it in the composer row or under Settings → Voice. Every new assistant response is read aloud automatically, and the toggle survives restarts. Auto-speak uses whatever engine is selected (no player bar, no highlighting).

### Settings → Voice

| Setting | What it does |
|---|---|
| **Auto-speak responses** | Speak each assistant response as it completes. The same toggle lives in the composer row. |
| **Read-aloud engine** | System voices (offline) or the neural engine on your OpenAI key. |
| **Neural voice / Neural model / Reading style** | Shown when the neural engine is selected. |
| **Read-aloud voice** | (System engine) Pick a specific system voice from a dropdown of everything the OS reports. "System default (auto)" lets Curtis pick. Voices load asynchronously on some platforms — the list fills in when the OS delivers it. |
| **Read-aloud rate** | Default speaking speed, 0.5×–2×. The player's rate button overrides it for the current playback only. Works for both engines. |
| **Highlight spoken sentence** | Karaoke follow-along (below). |
| **Dictation endpoint / base URL / API key / model** | Where recordings are transcribed (see STT above). |
| **Auto-send after dictation** | Send the message as soon as a dictation lands. |

A system voice stored on one machine that doesn't exist on another (voices are platform-specific) simply falls back to auto — no error, and the settings dropdown shows "System default (auto)".

### Player controls

Clicking the speaker icon opens an inline **TTS player bar** below the assistant message. The plugin splits the message into sentences and plays each one as a separate chunk, which gives you seek-style controls the browser's native `speechSynthesis` doesn't provide on its own.

The player has these controls, left to right:

| Control | What it does |
|---|---|
| **▶ / ⏸** | Pause or resume playback |
| **⏪** | Skip back one sentence |
| **⏩** | Skip forward one sentence |
| **`n / N`** | Position indicator (current sentence / total) |
| **`1x`** | Cycle playback speed. Steps through `1 → 1.25 → 1.5 → 1.75 → 2 → 1`. This is a session-level override on top of the configured default rate — it does not rewrite the setting. |
| **×** | Stop playback and close the player |

Playback starts at your configured rate (not forced back to 1×), and changing rate re-speaks the current sentence so the change is immediate. With the neural engine, rate is applied as `playbackRate` client-side — same steps, same button.

While the player is open:

- The speaker icon on the message stays highlighted, indicating active audio.
- Only one TTS session can run at a time. Starting playback on another message stops the first.
- Closing the player or starting a new send tears down the controller and cancels any queued audio.

### Karaoke highlight

With **Highlight spoken sentence** on, the sentence being read is highlighted in the message and scrolled into view, so you can read along or jump around by eye. The highlight marks live exactly where the sentence text is, so the highlight and the audio can't drift apart. Turn the setting off and no highlight markup is created at all.

### What gets spoken

Sentences are taken from the **rendered message** — the text you see on screen. That means code blocks, tables, and UI chrome (buttons, action bars, the player itself) are silently skipped rather than read aloud.

When there's no rendered DOM to walk (programmatic playback), the message content is cleaned instead: markdown is stripped so the voice reads naturally instead of reciting punctuation.

- Code fences (` ```...``` `) become "code block"
- Inline code (`` `code` ``) is read as-is without backticks
- Bold/italic markers (`**`, `*`) are stripped
- Markdown links `[text](url)` become just the link text
- Headings (`#`) and list markers (`-`, `*`) are stripped
- Image syntax (`![alt](url)`) is removed entirely

Sentence boundaries are decided by a regex split on `.`, `!`, `?` followed by whitespace. Abbreviations and decimal numbers can throw this off — you'll occasionally hear a sentence broken mid-thought. Skipping forward is the fastest recovery.

## Privacy

| Path | Where it goes | API key needed |
|---|---|---|
| **STT → OpenAI** | `api.openai.com` | Yes (OpenAI provider key) |
| **STT → Groq / custom** | The endpoint you configure | Yes (dictation key) |
| **TTS, system voices** | Local browser engine | No |
| **TTS, neural engine** | `api.openai.com` | Yes (OpenAI provider key) |

> [!WARNING]
> **Dictation uploads your recording to the configured endpoint.** On the default OpenAI setting that's `api.openai.com`. Don't dictate sensitive content you wouldn't put in a chat message. System-voice TTS is fully local — no text ever leaves your machine. The neural engine sends each spoken sentence to OpenAI — it's the same text a chat message already goes to, but switch back to system voices if that's not what you want read aloud.

## Mobile considerations

- **`MediaRecorder` support varies** on older Android WebViews. If the mic button doesn't respond, your device may not support it. iOS 16+ and modern Android are fine.
- **`speechSynthesis` quality varies** — mobile voices are often lower-quality than desktop. Auto-speak can also be cut off by mobile background-process limits; keep Obsidian in the foreground while listening. The neural engine sidesteps mobile voice quality entirely (it's just audio playback).
- **Mic permission** — iOS Safari-based WebViews require explicit per-app permission. If granted once, it persists.

## Roadmap

The player sits on a pluggable backend seam (`TTSBackend`) — system voices and the OpenAI neural engine are the first two implementations. Next candidates:

- **Local neural voice** — a fully offline neural model in the renderer, no key, no network; the flagship privacy play
- **Streaming TTS** — begin speaking before the full response arrives, for lower perceived latency
- **Wake-word** — "Hey Curtis" hands-free activation
