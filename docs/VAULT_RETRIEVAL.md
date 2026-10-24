# Vault retrieval (RAG)

> Curtis embeds your notes once, then quietly hands the model the relevant excerpts with every message — and `semantic_search` becomes an agent tool.

This feature is retrieval-augmented generation (RAG) in plain terms. A model can only reason about what is in its prompt, and your vault is far too large to fit in one. So instead of pasting notes by hand, Curtis does the fetching for you: before each send it searches an index of your notes for passages relevant to your message and puts those excerpts in the prompt. The model answers from your records without you locating anything.

The search runs two ways at once. An **embedding** turns a passage of text into a list of numbers (a vector) such that passages with similar meaning land close together — so "launch notes for the telescope project" can find a note that never uses those words. **BM25** is the other channel: a classic keyword index that matches exact words, names, and identifiers — the things embeddings are worst at. Running both and merging the rankings is **hybrid retrieval**, and it matters because real queries are half meaning, half exact terms.

Vault retrieval is how Curtis answers questions about notes it hasn't been pointed at. Your notes are chunked, embedded, and indexed; on each send, excerpts from the notes most relevant to your message are injected into the prompt automatically. Retrieval is hybrid — semantic and lexical at once — so "that thread about the Kepler launch" finds the note titled *Rocketry log* by meaning, and "the Zebra migration RFC" finds it by exact words.

**Off by default.** Settings → Curtis.ai → **Vault retrieval** → enable. Building the index is a separate, explicit step (below).

## The two halves

| Piece | What it does |
|---|---|
| **Auto-injected context** | Every send (with the feature on and an index built), Curtis searches the index for your latest message and injects the top excerpts into the system prompt — path-addressed, marked as partial, with an instruction to use `read_note` for the full file. Notes already attached via `@`-mention are skipped (their full contents are already there). Low-scoring chunks are dropped as noise, and at most 2 chunks per note are taken so one long file can't crowd out the rest. |
| **`semantic_search` agent tool** | The model can also search the index itself — hybrid, so conceptual and exact-keyword queries both work. Appears and disappears with the toggle (hot-reloads; no restart). |

## Hybrid retrieval

Every search runs two channels over the same chunks and fuses them:

- **Dense (cosine)** — the query is embedded and compared against every chunk vector. Strong on paraphrase and conceptual queries; blind to rare terms, exact identifiers, and anything the embedding model never saw.
- **Lexical (BM25)** — a field-weighted keyword index built locally over the chunk text, with note title (×3) and path (×2) fields outranking body hits. Strong on exact names, tags, acronyms, and filenames — precisely where embeddings are weakest.

The two rankings are combined with **Reciprocal Rank Fusion** (k = 60): each chunk earns `1/(60 + rank)` per channel it appears in. Fusion works on ranks, not scores, so it's indifferent to the fact that cosine and BM25 scores live on incomparable scales — no calibration, no weights to tune. A chunk that appears high in both channels wins; a query that only one channel can answer (an exact filename BM25 finds, a paraphrase only embeddings catch) still gets its results, just unfused.

The lexical index is always on when retrieval is on, has no settings, and costs nothing: it's a few hundred lines of local code over text the plugin already holds — no extra API calls, no background service, no new files on disk (it's rebuilt in memory from the chunk contents stored in `rag-index.json`, and kept fresh by the same live-edit watcher). The tokenizer handles no-space scripts: CJK text indexes as character unigrams plus bigrams.

## Building and maintaining the index

Press **Rebuild index** in the settings group. Progress shows per note; the status row reports notes, chunks, and when it was built.

- **Rebuilds are incremental** — unchanged notes are skipped, so a warm rebuild only pays embeddings for edited notes.
- **Edits are followed live** — save a note and it re-embeds after a short debounce. With retrieval disabled or no index built, nothing ever runs in the background: zero idle token spend.
- **Changed embedding provider/model?** Curtis detects the mismatch and the status row tells you to rebuild — vectors from different models don't mix.

## Local (on-device) embeddings

Selecting **Local (on-device)** as the embedding provider swaps API calls for a small transformer running inside Obsidian via [transformers.js](https://huggingface.co/docs/transformers.js) — WebGPU where the platform has it (desktop), WASM everywhere else, including mobile. The default model is `Xenova/bge-small-en-v1.5`: 384-dim, int8-quantized, ~30 MB.

**Browse models** (next to the model field) opens a picker with a vetted shortlist — BGE small (default), MiniLM-L6, GTE small, BGE base and BGE large (768/1024-dim, desktop tier), and Multilingual E5 small/base for non-English vaults — plus a live search over the Hugging Face hub for any other feature-extraction repo with transformers.js weights. Curated entries carry their run spec: pooling is per family (BGE pools CLS; MiniLM/GTE/E5 pool mean), and E5 models get their `query:`/`passage:` instruction prefixes applied automatically. Hub-search picks are unvetted — the spec is inferred from the repo name, and the picker says so. Heavy models get a warning on mobile.

**Local model precision** is the desktop power dial: q8 (default, ~30 MB, runs anywhere including WASM/mobile), fp16 (best quality, needs WebGPU), fp32 (reference quality, needs WebGPU). Precision is part of the index's model identity — switching it asks for a rebuild, because q8 and fp16 vectors must never mix in one index. fp16/fp32 without WebGPU fails with a clear message instead of silently downgrading.

Engine sessions are managed: only one model session stays resident at a time — switching model or precision disposes the previous session's weights — a build freezes its engine identity at the start so a mid-build settings flip can't mix engines into one index (the finished index simply shows as mismatched and asks for a rebuild), and a session that dies under you (GPU reset, sleep/wake) is evicted and re-initializes on the next attempt.

- **First use downloads the model once** from the Hugging Face hub and caches it; afterwards, indexing and queries run fully offline. The rebuild notice reports the download while it streams.
- **Desktop is fast; mobile is slow once, fast after.** A full-vault build over WASM takes minutes on a phone — a query embeds a single chunk and feels instant. The desktop→mobile recipe below skips the phone build entirely.
- The engine initializes lazily: nothing loads until the first embed.

## Settings

| Setting | What it does |
|---|---|
| **Enable vault retrieval** | Master toggle. Hot-reloads the agent tool. |
| **Relevance pulse** | When the note you open closely matches a past conversation, a "discussed in …" hint appears under the chat header. Local-only similarity — no API calls. Deliberately tuned for precision: a false "we discussed this" is worse than a missed one. |
| **Embedding provider** | **Local (on-device)** runs the embedding model inside Obsidian — WebGPU on desktop, WASM on mobile, no API key, offline after a one-time model download. Or any OpenAI-compatible `/embeddings` endpoint; **Ollama and LM Studio work fully offline.** Anthropic has no embeddings API and is excluded; Azure OpenAI is too — its deployment-specific URLs and auth don't fit the shared `/embeddings` shape. |
| **Embedding model** | Endpoint model ID, or — with the local engine — a Hugging Face repo id with ONNX weights (default `Xenova/bge-small-en-v1.5`; Browse picks from a vetted shortlist plus live hub search). |
| **Local model precision** | On-device weight precision: q8 default (runs anywhere), fp16/fp32 desktop tiers (need WebGPU). Precision changes require a rebuild. |
| **Chunk size / overlap** | Characters per chunk (default 500) and overlap between chunks (default 50). |
| **Results per query** | How many excerpts to inject per send: 3 / 5 / 8 / 12. |
| **Index storage** | Plugin folder (default) or the synced `.curtis/` vault folder. Vault folder lets the index travel with your own sync — index on desktop, query on mobile. |

## Storage & privacy

The index lives in `rag-index.json` — a single file, vectors int8-quantized to keep real vaults viable — in one of two places, chosen by **Index storage**:

- **Plugin folder** (default): next to `data.json`. Not a vault note: invisible to Obsidian search, never synced as content, never merged into settings.
- **Vault folder** (`.curtis/rag-index.json`): rides your own vault sync (iCloud, Syncthing, Obsidian Sync). Build the index on desktop and the phone inherits it — with the same provider and model selected on both, mobile only ever embeds the query, never a full build. Flipping the setting carries the index to its new home (and adopts one that sync just delivered).

- **Embedding egress is whatever engine you picked.** Local (on-device): none, after the one-time model download. API providers: **embedding sends note contents to the endpoint you configure** — pick Ollama/LM Studio and the whole pipeline is local.
- Injected excerpts travel to your chat provider like any other prompt text.
- Excerpts are always partial and path-labeled; the model is told to read the full note when it needs more.

## See also

→ [AGENT.md](AGENT.md) — the `semantic_search` tool in the agent toolset
→ [MCP_SERVER.md](MCP_SERVER.md) — the MCP server exposes the same semantic search to external clients
→ [MEMORY.md](MEMORY.md) — facts Curtis remembers vs. notes it retrieves
