// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Curtis — RAG index manager: build, persist, and query the vault embedding index.
//
// Storage: `rag-index.json`, either in the plugin dir (default) or the synced
// `.curtis/` vault folder (Settings → Vault retrieval → Index storage), via
// the vault adapter. Dot folders are invisible to vault search and the file
// is never merged into settings. Vectors are stored int8-quantized (base64)
// to keep the file viable for real vaults: cosine similarity is
// scale-invariant per vector, so the omitted per-vector scale does not
// affect ranking.
//
// In memory the index is EmbeddingChunk[] (full float vectors); StoredChunk
// (quantized) exists only at the persistence boundary.
//
// Rebuilds are incremental: files whose mtime+size are unchanged AND whose
// chunk settings match the stored ones are skipped entirely, so warm rebuilds
// only pay for edited notes. Live edits are followed up via vault events
// (scheduleFileUpdate / removeFile / renameFile) — all of which no-op when
// vault retrieval is disabled or the index was never built, so idle vaults
// never spend embeddings tokens in the background.
//
// Search is hybrid: brute-force cosine (dense) fused with a field-weighted
// BM25 pass over the same chunks (lexical) via Reciprocal Rank Fusion. The
// BM25 mirror lives in memory only and never touches the network or disk.

import { TFile, debounce } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';
import type { EmbeddingChunk, RetrievalResult } from '../types';
import type CurtisPlugin from '../main';
import { resolveApiKey } from '../core/secrets';
import { EmbeddingError, embedTexts, embeddingsUrlFromChatUrl, type EmbeddingEndpoint } from './embeddings';
import {
	embedTextsLocal,
	isLocalEmbeddingProvider,
	localModelIdentity,
	type EmbedUsage,
	type LocalDtype,
} from './local-embeddings';
import { ragIndexPaths, RAG_VAULT_DIR } from './index-paths';
import { chunkText, type TextChunk } from './chunker';
import { Bm25Index, rrfFuse } from './bm25';
import { toBase64, fromBase64 } from '../utils/base64';

/** Chunks scoring below this are treated as noise and never injected. */
const MIN_SCORE = 0.1;
/** Max chunks taken from a single note before others get a chance (diversity). */
const PER_FILE_CAP = 2;
/** Candidates each channel (cosine, BM25) contributes to RRF fusion. */
const FUSE_DEPTH = 50;
/** RRF constant — 60 per Cormack et al. (SIGIR 2009); large k mutes rank position. */
const RRF_K = 60;
/** Debounce for re-embedding a note after an edit. */
const EDIT_DEBOUNCE_MS = 1500;
/** Relevance pulse floor — deliberately far above MIN_SCORE: a false
 *  "we discussed this" is embarrassing, a missed one is invisible, so the
 *  pulse trades recall for precision. */
const PULSE_MIN_SCORE = 0.8;

/** Quantized on-disk chunk shape. */
interface StoredChunk {
	id: string;
	content: string;
	start: number;
	end: number;
	/** int8-quantized embedding, offset-binary packed into base64. */
	v: string;
}

interface StoredFile {
	mtime: number;
	size: number;
	chunks: StoredChunk[];
}

interface RagIndexFile {
	version: 1;
	provider: string;
	model: string;
	chunkSize: number;
	chunkOverlap: number;
	lastBuilt: number;
	files: Record<string, StoredFile>;
}

/** In-memory per-file record. */
interface IndexedFile {
	mtime: number;
	size: number;
	chunks: EmbeddingChunk[];
}

export interface RagIndexStatus {
	fileCount: number;
	chunkCount: number;
	lastBuilt: number | null;
	embeddingProvider: string;
	embeddingModel: string;
	/** Index was built with a different embedding provider/model — vectors are unusable until rebuilt. */
	modelMismatch: boolean;
	/** Chunk settings changed (search still works; rebuild applies them). */
	settingsChanged: boolean;
	building: boolean;
}

/** A conversation file the relevance pulse matched for the active note. */
export interface PulseMatch {
	/** Vault path of the conversation markdown file. */
	filePath: string;
	/** Best cosine similarity between the note's and the conversation's chunks. */
	score: number;
}

/** The resolved embeddings engine for one embed call. */
type EmbeddingTarget =
	| { kind: 'local'; model: string; dtype: LocalDtype }
	| { kind: 'api'; endpoint: EmbeddingEndpoint };

export class RagIndexManager {
	private app: App;
	private manifest: PluginManifest;
	private plugin: CurtisPlugin;

	private files = new Map<string, IndexedFile>();
	/** Lexical mirror of `files` — same chunks, tokenized in memory. */
	private bm25 = new Bm25Index();
	private indexProvider = '';
	private indexModel = '';
	private indexChunkSize = 0;
	private indexChunkOverlap = 0;
	private lastBuilt = 0;
	private loaded = false;
	private loadPromise: Promise<void> | null = null;
	private building = false;
	private buildPromise: Promise<void> | null = null;
	private warnedModelMismatch = false;
	private warnedNoEndpoint = false;

	private pendingUpdates = new Map<string, TFile>();
	private updateTimer: number | null = null;

	constructor(app: App, manifest: PluginManifest, plugin: CurtisPlugin) {
		this.app = app;
		this.manifest = manifest;
		this.plugin = plugin;
	}

	private get filePath(): string {
		const location = this.plugin.settings.ragIndexLocation === 'vault' ? 'vault' : 'plugin';
		return ragIndexPaths(location, this.pluginDir).active;
	}

	/** Manifest dir is optional in the API types but always set for an
	 *  installed plugin; '' only ever appears in synthetic test manifests. */
	private get pluginDir(): string {
		return this.manifest.dir ?? '';
	}

	// ---- Lifecycle ---------------------------------------------------------

	async ensureLoaded(): Promise<void> {
		if (this.loaded) return;
		if (!this.loadPromise) {
			this.loadPromise = this.doLoad().finally(() => {
				this.loadPromise = null;
			});
		}
		return this.loadPromise;
	}

	private async doLoad(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			await this.consolidateIndexFile();
			if (await adapter.exists(this.filePath)) {
				const raw = await adapter.read(this.filePath);
				const parsed = parseIndexFile(raw);
				if (parsed) {
					this.indexProvider = parsed.provider;
					this.indexModel = parsed.model;
					this.indexChunkSize = parsed.chunkSize;
					this.indexChunkOverlap = parsed.chunkOverlap;
					this.lastBuilt = parsed.lastBuilt;
					for (const path of Object.keys(parsed.files)) {
						const rec = parsed.files[path];
						const chunks: EmbeddingChunk[] = [];
						for (const c of rec.chunks) {
							try {
								chunks.push({
									id: c.id,
									filePath: path,
									content: c.content,
									embedding: dequantizeVector(c.v),
									startIndex: c.start,
									endIndex: c.end,
								});
							} catch {
								// Corrupt vector — drop the chunk, keep the rest.
							}
						}
						this.files.set(path, { mtime: rec.mtime, size: rec.size, chunks });
					}
					for (const [path, rec] of this.files) {
						this.bm25.setFile(path, rec.chunks);
					}
				}
			}
		} catch (e) {
			console.error('[Curtis] Failed to load RAG index — starting empty:', e);
			this.files.clear();
			this.lastBuilt = 0;
		} finally {
			this.loaded = true;
		}
	}

	/**
	 * Reconcile the two possible index locations: if the active one has no
	 * file but the inactive one does, move it across; if both exist, keep the
	 * active one (freshest by definition of the current setting) and drop the
	 * other, so a flip can never leave two divergent indexes behind. Runs at
	 * boot (covers hand-edited settings) and on every location flip.
	 */
	private async consolidateIndexFile(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const location = this.plugin.settings.ragIndexLocation === 'vault' ? 'vault' : 'plugin';
		const { active, other } = ragIndexPaths(location, this.pluginDir);
		try {
			if (!(await adapter.exists(active)) && (await adapter.exists(other))) {
				if (active.startsWith(`${RAG_VAULT_DIR}/`)) {
					try {
						await adapter.mkdir(RAG_VAULT_DIR);
					} catch {
						// Already exists.
					}
				}
				await adapter.write(active, await adapter.read(other));
			}
			if (await adapter.exists(other)) {
				await adapter.remove(other);
			}
		} catch (e) {
			// Never fatal — the loader treats a missing index as "not built".
			console.warn('[Curtis] RAG: index relocation failed:', e);
		}
	}

	/** Settings flipped the index storage location — carry the index across. */
	async onStorageLocationChanged(): Promise<void> {
		// A build in flight persists to the NEW location when it finishes
		// (filePath is a getter) and the next boot's consolidation cleans up
		// the old file — nothing to do here.
		if (this.building) return;
		if (this.loadPromise) await this.loadPromise;
		this.schedulePersist.cancel();
		if (this.files.size > 0) {
			// Flush in-memory state to the new location first; consolidation
			// then removes the stale file at the old one.
			await this.persist();
			await this.consolidateIndexFile();
		} else {
			await this.consolidateIndexFile();
			if (this.lastBuilt === 0) {
				// Nothing was in memory (flip before any build) — adopt a
				// pre-existing index the consolidation just moved into place.
				this.loaded = false;
				await this.ensureLoaded();
			}
		}
	}

	/** Called from onunload — attempt to flush any debounced persist. */
	async dispose(): Promise<void> {
		if (this.updateTimer !== null) {
			window.clearTimeout(this.updateTimer);
			this.updateTimer = null;
		}
		if (this.files.size > 0) {
			await this.persist();
		}
	}

	// ---- Status ------------------------------------------------------------

	getStatus(): RagIndexStatus {
		const s = this.plugin.settings;
		let chunkCount = 0;
		for (const rec of this.files.values()) chunkCount += rec.chunks.length;
		const hasIndex = this.lastBuilt > 0;
		const modelMismatch =
			hasIndex &&
			(s.ragEmbeddingProvider !== this.indexProvider || this.effectiveEmbeddingModel !== this.indexModel);
		const settingsChanged =
			hasIndex &&
			!modelMismatch &&
			(s.ragChunkSize !== this.indexChunkSize || s.ragChunkOverlap !== this.indexChunkOverlap);
		return {
			fileCount: this.files.size,
			chunkCount,
			lastBuilt: this.lastBuilt || null,
			embeddingProvider: this.indexProvider,
			embeddingModel: this.indexModel,
			modelMismatch,
			settingsChanged,
			building: this.building,
		};
	}

	// ---- Rebuild -----------------------------------------------------------

	/**
	 * Full scan + incremental embed. Concurrent calls coalesce onto the
	 * in-flight build. Throws EmbeddingError when the embeddings endpoint is
	 * unusable or a batch fails — the previous index stays intact in that case
	 * (changes are committed to memory and disk only after every file succeeds).
	 */
	async rebuildAll(
		onProgress?: (done: number, total: number) => void,
		onStatus?: (message: string) => void
	): Promise<void> {
		if (this.building) return this.buildPromise ?? undefined;
		this.building = true;
		this.buildPromise = this.doRebuild(onProgress, onStatus).finally(() => {
			this.building = false;
			this.buildPromise = null;
			// Files edited while the build ran were kept queued — process them
			// now so the fresh index reflects those edits too.
			void this.flushPendingUpdates();
		});
		return this.buildPromise;
	}

	private async doRebuild(
		onProgress?: (done: number, total: number) => void,
		onStatus?: (message: string) => void
	): Promise<void> {
		await this.ensureLoaded();
		const s = this.plugin.settings;
		// Freeze the engine identity for the whole build: resolveEmbeddingTarget
		// reads live settings, so a mid-build provider or precision flip would
		// otherwise embed later files with a different engine while the stamp
		// below still claims one uniform engine. With the frozen identity, a
		// flip mid-build leaves the stamped index mismatched against the new
		// settings — the mismatch guard then demands an honest rebuild.
		const buildTarget = this.resolveEmbeddingTarget();
		if (!buildTarget) {
			throw new EmbeddingError(
				'No usable embeddings engine — pick a provider with a configured API key, run one locally (ollama, lm studio), or switch to Local (on-device).'
			);
		}
		const buildProvider = s.ragEmbeddingProvider;
		const buildModel = this.effectiveEmbeddingModel;

		const mdFiles = this.app.vault.getMarkdownFiles();
		const livePaths = new Set(mdFiles.map((f) => f.path));
		const nextFiles = new Map(this.files);
		for (const path of [...nextFiles.keys()]) {
			if (!livePaths.has(path)) nextFiles.delete(path);
		}

		interface PendingEmbed {
			file: TFile;
			stat: { mtime: number; size: number };
			pieces: TextChunk[];
		}
		const toEmbed: PendingEmbed[] = [];
		let totalChunks = 0;

		for (const file of mdFiles) {
			const rec = nextFiles.get(file.path);
			const unchanged =
				rec &&
				rec.mtime === file.stat.mtime &&
				rec.size === file.stat.size &&
				this.indexProvider === buildProvider &&
				this.indexModel === buildModel &&
				this.indexChunkSize === s.ragChunkSize &&
				this.indexChunkOverlap === s.ragChunkOverlap;
			if (unchanged) {
				totalChunks += rec.chunks.length;
				continue;
			}
			// Snapshot the stat BEFORE reading — an edit landing between read
			// and the post-embed record write would otherwise stamp the OLD
			// content with the NEW mtime, and every future rebuild would
			// wrongly consider the entry unchanged.
			const stat = { mtime: file.stat.mtime, size: file.stat.size };
			const text = await this.app.vault.cachedRead(file);
			const pieces = chunkText(text, s.ragChunkSize, s.ragChunkOverlap);
			if (pieces.length === 0) {
				nextFiles.delete(file.path);
				continue;
			}
			toEmbed.push({ file, stat, pieces });
			totalChunks += pieces.length;
		}

		let done = 0;
		for (const item of toEmbed) {
			const vectors = await this.embedWith(buildTarget, item.pieces.map((p) => p.content), (d, _t) => {
				onProgress?.(done + d, totalChunks);
			}, onStatus);
			done += item.pieces.length;
			onProgress?.(done, totalChunks);
			nextFiles.set(item.file.path, {
				mtime: item.stat.mtime,
				size: item.stat.size,
				chunks: item.pieces.map((p, i) => ({
					id: `${item.file.path}#${p.startIndex}`,
					filePath: item.file.path,
					content: p.content,
					embedding: vectors[i],
					startIndex: p.startIndex,
					endIndex: p.endIndex,
				})),
			});
		}

		this.files = nextFiles;
		this.bm25.clear();
		for (const [path, rec] of this.files) {
			this.bm25.setFile(path, rec.chunks);
		}
		this.indexProvider = buildProvider;
		this.indexModel = buildModel;
		this.indexChunkSize = s.ragChunkSize;
		this.indexChunkOverlap = s.ragChunkOverlap;
		this.lastBuilt = Date.now();
		this.warnedModelMismatch = false;
		await this.persist();
	}

	// ---- Search ------------------------------------------------------------

	/**
	 * Embed the query and return the top-k most relevant chunks, diversified
	 * so one long note can't crowd out the rest. Returns [] when the index is
	 * empty, stale (provider/model changed), or embeddings are unconfigured —
	 * retrieval failures must never block a send.
	 */
	async search(query: string, topK: number): Promise<RetrievalResult[]> {
		const q = query.trim();
		if (!q) return [];
		await this.ensureLoaded();
		if (this.files.size === 0) return [];

		const s = this.plugin.settings;
		if (s.ragEmbeddingProvider !== this.indexProvider || this.effectiveEmbeddingModel !== this.indexModel) {
			if (!this.warnedModelMismatch) {
				this.warnedModelMismatch = true;
				console.warn('[Curtis] RAG: index built with a different embedding provider/model — rebuild in Settings → Vault retrieval. Skipping retrieval.');
			}
			return [];
		}
		if (!this.resolveEmbeddingTarget()) {
			if (!this.warnedNoEndpoint) {
				this.warnedNoEndpoint = true;
				console.warn('[Curtis] RAG: no usable embeddings engine (provider missing, unauthenticated, or local model failed). Skipping retrieval.');
			}
			return [];
		}

		const queryVec = (await this.embed([q], undefined, undefined, 'query'))[0];
		if (!queryVec) return [];
		const qNorm = vectorNorm(queryVec);
		if (qNorm === 0) return [];

		const scored: RetrievalResult[] = [];
		const chunkById = new Map<string, EmbeddingChunk>();
		for (const rec of this.files.values()) {
			for (const chunk of rec.chunks) {
				chunkById.set(chunk.id, chunk);
				const score = cosine(queryVec, qNorm, chunk.embedding);
				if (score >= MIN_SCORE) scored.push({ chunk, score });
			}
		}
		scored.sort((a, b) => b.score - a.score);

		// Hybrid fusion: rank-only RRF over the cosine top slice and a local
		// BM25 pass over the same chunks. Ranks sidestep the scale mismatch
		// between bounded cosine and corpus-scale BM25 scores; an empty
		// channel (e.g. a query that tokenizes to nothing) degrades to the
		// other channel's ordering.
		const cosineTop = scored.slice(0, FUSE_DEPTH).map((r) => r.chunk.id);
		const lexicalTop = this.bm25.search(q, FUSE_DEPTH).map((h) => h.id);
		const fused = rrfFuse([cosineTop, lexicalTop], RRF_K);
		// Normalize to [0, 1] for consumers that surface the score (plugin
		// API, MCP): the best achievable is rank 1 in both channels.
		const bestPossible = 2 / (RRF_K + 1);
		const ranked: RetrievalResult[] = [];
		for (const [id, fusedScore] of fused) {
			const chunk = chunkById.get(id);
			if (chunk) ranked.push({ chunk, score: fusedScore / bestPossible });
		}
		ranked.sort((a, b) => b.score - a.score);
		return diversifyByFile(ranked, Math.max(1, topK));
	}

	// ---- Relevance pulse ------------------------------------------------------

	/**
	 * Find past conversations whose indexed content is semantically close to a
	 * note — pure local cosine over the in-memory index, no embedding call, so
	 * it is safe to run on every note switch. Conversations are ordinary vault
	 * markdown files (kept fresh by the live modify watcher), which is what
	 * makes this free: the vectors already exist. Returns [] when the index is
	 * inactive, the note isn't indexed, or nothing clears PULSE_MIN_SCORE.
	 */
	async findRelatedConversations(notePath: string, limit = 1): Promise<PulseMatch[]> {
		await this.ensureLoaded();
		if (!this.isActive()) return [];
		const noteRec = this.files.get(notePath);
		if (!noteRec) return [];

		const noteVecs = noteRec.chunks
			.map((c) => ({ v: c.embedding, norm: vectorNorm(c.embedding) }))
			.filter((x) => x.norm > 0);
		if (noteVecs.length === 0) return [];

		const s = this.plugin.settings;
		const convPrefix = `${(s.conversationsFolder || 'AI/Conversations').replace(/\/+$/, '')}/`;
		// Curtis's own artifacts are indexed too — never suggest them back.
		const excluded = new Set<string>(
			[s.memoryFilePath, s.journalFilePath].filter((p): p is string => !!p)
		);

		const matches: PulseMatch[] = [];
		for (const [path, rec] of this.files) {
			if (!path.startsWith(convPrefix) || excluded.has(path) || path === notePath) continue;
			let top = 0;
			for (const convChunk of rec.chunks) {
				const bNorm = vectorNorm(convChunk.embedding);
				if (bNorm === 0) continue;
				for (const nv of noteVecs) {
					const score = cosine(convChunk.embedding, bNorm, nv.v);
					if (score > top) top = score;
				}
			}
			if (top >= PULSE_MIN_SCORE) matches.push({ filePath: path, score: top });
		}
		matches.sort((a, b) => b.score - a.score);
		return matches.slice(0, Math.max(1, limit));
	}

	// ---- Live vault events ---------------------------------------------------

	/** Debounced re-chunk + re-embed of one edited note. */
	scheduleFileUpdate(file: TFile): void {
		if (!this.plugin.settings.enableRag) return;
		// Queue even while a rebuild runs — the rebuild may have already read
		// this file's OLD content, and dropping the event would leave the
		// stale entry indexed under the NEW mtime (permanently "unchanged").
		this.pendingUpdates.set(file.path, file);
		if (this.updateTimer !== null) window.clearTimeout(this.updateTimer);
		this.updateTimer = window.setTimeout(() => {
			this.updateTimer = null;
			void this.flushPendingUpdates();
		}, EDIT_DEBOUNCE_MS);
	}

	async removeFile(path: string): Promise<void> {
		await this.ensureLoaded();
		if (!this.isActive()) return;
		this.pendingUpdates.delete(path);
		if (this.files.delete(path)) {
			this.bm25.removeFile(path);
			this.schedulePersist();
		}
	}

	async renameFile(oldPath: string, newPath: string): Promise<void> {
		await this.ensureLoaded();
		if (!this.isActive()) return;
		const pending = this.pendingUpdates.get(oldPath);
		if (pending) {
			this.pendingUpdates.delete(oldPath);
			this.pendingUpdates.set(newPath, pending);
		}
		await this.ensureLoaded();
		const rec = this.files.get(oldPath);
		if (!rec) return;
		this.files.delete(oldPath);
		// Embeddings survive the rename — only identity changes.
		this.files.set(newPath, {
			mtime: rec.mtime,
			size: rec.size,
			chunks: rec.chunks.map((c) => ({
				id: `${newPath}#${c.startIndex}`,
				filePath: newPath,
				content: c.content,
				embedding: c.embedding,
				startIndex: c.startIndex,
				endIndex: c.endIndex,
			})),
		});
		// Path and title are indexed lexical fields, so the lexical mirror
		// must re-tokenize under the new path.
		this.bm25.removeFile(oldPath);
		this.bm25.setFile(newPath, this.files.get(newPath)!.chunks);
		this.schedulePersist();
	}

	/** Drop the entire index (memory + disk). */
	async clear(): Promise<void> {
		// Absorb an in-flight boot load first — its parsed contents would
		// otherwise land after the wipe and resurrect the deleted index.
		if (this.loadPromise) await this.loadPromise;
		this.schedulePersist.cancel();
		this.files.clear();
		this.bm25.clear();
		this.indexProvider = '';
		this.indexModel = '';
		this.indexChunkSize = 0;
		this.indexChunkOverlap = 0;
		this.lastBuilt = 0;
		this.pendingUpdates.clear();
		this.loaded = true;
		try {
			await this.app.vault.adapter.remove(this.filePath);
		} catch {
			// File already absent — nothing to clean.
		}
	}

	// ---- Internals ------------------------------------------------------------

	/** True when live incremental updates should run at all. */
	private isActive(): boolean {
		return this.plugin.settings.enableRag && this.lastBuilt > 0;
	}

	/** Normalized local-engine weight precision (defensive against missing
	 *  or future setting values). */
	private get localDtype(): LocalDtype {
		const v = this.plugin.settings.ragLocalEmbeddingDtype;
		return v === 'fp16' || v === 'fp32' ? v : 'q8';
	}

	/** The effective model identity of the selected engine — for the local
	 *  engine this includes the weight precision, so a dtype change
	 *  invalidates the index exactly like a model change. */
	private get effectiveEmbeddingModel(): string {
		const s = this.plugin.settings;
		if (isLocalEmbeddingProvider(s.ragEmbeddingProvider)) {
			return localModelIdentity(s.ragEmbeddingModel, this.localDtype);
		}
		return s.ragEmbeddingModel;
	}

	private async flushPendingUpdates(): Promise<void> {
		// Check BEFORE draining: a build in flight has likely read stale
		// content for the pending files — keep them queued for the post-build
		// flush instead of silently dropping them.
		if (this.building) return;
		await this.ensureLoaded();
		if (this.lastBuilt === 0) return; // never built — don't bootstrap a partial index
		const s = this.plugin.settings;
		// Settings drifted since the index was built (provider/model/chunking):
		// search() refuses this index until a rebuild, so embedding now would
		// be wasted spend at the wrong granularity. Keep the edits queued —
		// they are picked up by the next rebuild or its post-build flush.
		if (
			s.ragEmbeddingProvider !== this.indexProvider ||
			this.effectiveEmbeddingModel !== this.indexModel ||
			s.ragChunkSize !== this.indexChunkSize ||
			s.ragChunkOverlap !== this.indexChunkOverlap
		) {
			return;
		}
		const pending = [...this.pendingUpdates.values()];
		this.pendingUpdates.clear();
		if (pending.length === 0) return;

		const flushTarget = this.resolveEmbeddingTarget();
		if (!flushTarget) return;

		for (const file of pending) {
			// Deleted (or renamed away) while the debounce ran.
			if (!this.app.vault.getAbstractFileByPath(file.path)) continue;
			try {
				const stat = { mtime: file.stat.mtime, size: file.stat.size };
				const text = await this.app.vault.cachedRead(file);
				const pieces = chunkText(text, s.ragChunkSize, s.ragChunkOverlap);
				if (pieces.length === 0) {
					this.files.delete(file.path);
					this.bm25.removeFile(file.path);
					continue;
				}
				const vectors = await this.embedWith(flushTarget, pieces.map((p) => p.content));
				const chunks: EmbeddingChunk[] = pieces.map((p, i) => ({
					id: `${file.path}#${p.startIndex}`,
					filePath: file.path,
					content: p.content,
					embedding: vectors[i],
					startIndex: p.startIndex,
					endIndex: p.endIndex,
				}));
				this.files.set(file.path, {
					mtime: stat.mtime,
					size: stat.size,
					chunks,
				});
				this.bm25.setFile(file.path, chunks);
			} catch (e) {
				console.warn(`[Curtis] RAG: incremental update failed for ${file.path}:`, e);
			}
		}
		await this.persist();
	}

	/**
	 * Resolve the embeddings engine from settings: the on-device model, or an
	 * OpenAI-compatible endpoint. Returns null when the API route is unusable
	 * (unknown provider, Anthropic/Azure, missing key, no endpoint URL) — the
	 * local route is always usable whenever it is selected.
	 */
	private resolveEmbeddingTarget(): EmbeddingTarget | null {
		const s = this.plugin.settings;
		if (isLocalEmbeddingProvider(s.ragEmbeddingProvider)) {
			return { kind: 'local', model: s.ragEmbeddingModel, dtype: this.localDtype };
		}
		const endpoint = this.resolveEndpoint();
		return endpoint ? { kind: 'api', endpoint } : null;
	}

	/** Embed through whichever engine settings select right now. `usage`
	 *  distinguishes queries from indexed passages — e5-family local models
	 *  prefix them differently; API engines ignore it. */
	private async embed(
		inputs: string[],
		onProgress?: (done: number, total: number) => void,
		onStatus?: (message: string) => void,
		usage: EmbedUsage = 'passage'
	): Promise<number[][]> {
		const target = this.resolveEmbeddingTarget();
		if (!target) throw new EmbeddingError('No usable embeddings engine');
		return this.embedWith(target, inputs, onProgress, onStatus, usage);
	}

	/** Embed through a caller-frozen engine — build/flush paths resolve the
	 *  target once up front so a mid-run settings flip cannot mix engines
	 *  inside one index write. */
	private async embedWith(
		target: EmbeddingTarget,
		inputs: string[],
		onProgress?: (done: number, total: number) => void,
		onStatus?: (message: string) => void,
		usage: EmbedUsage = 'passage'
	): Promise<number[][]> {
		return target.kind === 'local'
			? embedTextsLocal(target.model, inputs, onProgress, onStatus, usage, target.dtype)
			: embedTexts(target.endpoint, inputs, onProgress);
	}

	/**
	 * Resolve the embeddings endpoint from settings + registry. Returns null
	 * when the provider is unknown, Anthropic (no embeddings API), the key is
	 * missing on an authenticated provider, or no endpoint URL is set.
	 */
	private resolveEndpoint(): EmbeddingEndpoint | null {
		const s = this.plugin.settings;
		const def = this.plugin.providerRegistry.getDefinition(s.ragEmbeddingProvider);
		// Azure is excluded alongside Anthropic: its embeddings need a separate
		// deployment URL, the api-version query (stripped by the URL rewrite
		// below) and the `api-key` header — the OpenAI-compat chat URL this
		// derives from can never satisfy those.
		if (!def || def.authType === 'anthropic' || def.id === 'azure-openai') return null;
		const config = s.providerConfigs[def.id];
		const chatUrl = config?.customEndpoint || def.endpoint;
		if (!chatUrl) return null;
		const apiKey = resolveApiKey(this.app, config);
		if (def.authType === 'bearer' && !apiKey) return null;
		return { url: embeddingsUrlFromChatUrl(chatUrl), apiKey, model: s.ragEmbeddingModel };
	}

	private schedulePersist = debounce(() => {
		void this.persist();
	}, 2000, true);

	/** Serializes persists. Every write shares one `.tmp` path, so two
	 *  concurrent runs (debounced autosave racing the dispose-time flush) can
	 *  interleave adapter writes and install a truncated index. Calls append
	 *  onto this chain; each resolves when its own write completes. */
	private persistChain: Promise<void> = Promise.resolve();

	private persist(): Promise<void> {
		const run = this.persistChain.then(() => this.writeIndexFile());
		// A failed write must not poison the chain — the next persist still runs.
		this.persistChain = run.catch(() => {});
		return run;
	}

	private async writeIndexFile(): Promise<void> {
		if (this.lastBuilt === 0 && this.files.size === 0) {
			// Never built — nothing worth writing.
			return;
		}
		const payload: RagIndexFile = {
			version: 1,
			provider: this.indexProvider,
			model: this.indexModel,
			chunkSize: this.indexChunkSize,
			chunkOverlap: this.indexChunkOverlap,
			lastBuilt: this.lastBuilt,
			files: {},
		};
		for (const [path, rec] of this.files) {
			payload.files[path] = {
				mtime: rec.mtime,
				size: rec.size,
				chunks: rec.chunks.map((c) => ({
					id: c.id,
					content: c.content,
					start: c.startIndex,
					end: c.endIndex,
					v: quantizeVector(c.embedding),
				})),
			};
		}
		// Write to a temp file, then rename over the target — a crash mid-write
		// must never truncate rag-index.json (a truncated index silently forces
		// a full re-embed).
		if (this.filePath.startsWith(`${RAG_VAULT_DIR}/`)) {
			try {
				await this.app.vault.adapter.mkdir(RAG_VAULT_DIR);
			} catch {
				// Already exists.
			}
		}
		const tmpPath = `${this.filePath}.tmp`;
		try {
			await this.app.vault.adapter.write(tmpPath, JSON.stringify(payload));
			try {
				await this.app.vault.adapter.rename(tmpPath, this.filePath);
			} catch {
				// Some adapters refuse to rename onto an existing file — drop the
				// target and retry (brief window where the index is absent).
				try {
					await this.app.vault.adapter.remove(this.filePath);
				} catch {
					// Target absent already.
				}
				await this.app.vault.adapter.rename(tmpPath, this.filePath);
			}
		} catch (e) {
			console.error('[Curtis] RAG: failed to persist index:', e);
			try {
				await this.app.vault.adapter.remove(tmpPath);
			} catch {
				// tmp already gone.
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Vector math + persistence helpers
// ---------------------------------------------------------------------------

function vectorNorm(v: number[]): number {
	let sum = 0;
	for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
	return Math.sqrt(sum);
}

function cosine(a: number[], aNorm: number, b: number[]): number {
	let dot = 0;
	let bSq = 0;
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		dot += a[i] * b[i];
		bSq += b[i] * b[i];
	}
	if (bSq === 0) return 0;
	return dot / (aNorm * Math.sqrt(bSq));
}

/**
 * Cap the number of chunks taken from any single note so diverse matches
 * surface. The cap relaxes only when fewer than k unique files can fill k.
 */
function diversifyByFile(sorted: RetrievalResult[], k: number): RetrievalResult[] {
	const picked: RetrievalResult[] = [];
	const deferred: RetrievalResult[] = [];
	const perFile = new Map<string, number>();
	for (const r of sorted) {
		if (picked.length >= k) break;
		const n = perFile.get(r.chunk.filePath) || 0;
		if (n >= PER_FILE_CAP) {
			deferred.push(r);
			continue;
		}
		perFile.set(r.chunk.filePath, n + 1);
		picked.push(r);
	}
	for (const r of deferred) {
		if (picked.length >= k) break;
		picked.push(r);
	}
	return picked;
}

/** Quantize a float vector to offset-binary int8, packed as base64. */
function quantizeVector(v: number[]): string {
	const bytes = new Uint8Array(v.length);
	let maxAbs = 0;
	for (let i = 0; i < v.length; i++) {
		const a = Math.abs(v[i]);
		if (a > maxAbs) maxAbs = a;
	}
	const scale = maxAbs > 0 ? maxAbs / 127 : 1;
	for (let i = 0; i < v.length; i++) {
		const q = Math.max(-127, Math.min(127, Math.round(v[i] / scale)));
		bytes[i] = q + 128;
	}
	return toBase64(bytes);
}

/** Dequantize — scale-invariant copy of the original direction. */
function dequantizeVector(encoded: string): number[] {
	const bytes = fromBase64(encoded);
	const out = new Array<number>(bytes.length);
	for (let i = 0; i < bytes.length; i++) {
		out[i] = (bytes[i] - 128) / 127;
	}
	return out;
}

/** Lenient parse of the on-disk index. Returns null on any shape problem. */
function parseIndexFile(raw: string): RagIndexFile | null {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!data || typeof data !== 'object') return null;
	const d = data as Partial<RagIndexFile>;
	if (d.version !== 1) return null;
	if (typeof d.provider !== 'string' || typeof d.model !== 'string') return null;
	if (!d.files || typeof d.files !== 'object') return null;

	const files: Record<string, StoredFile> = {};
	for (const path of Object.keys(d.files)) {
		const rec: Partial<StoredFile> | undefined = d.files[path];
		if (!rec || !Array.isArray(rec.chunks)) continue;
		const chunks: StoredChunk[] = [];
		for (const c of rec.chunks) {
			if (
				c &&
				typeof c.id === 'string' &&
				typeof c.content === 'string' &&
				typeof c.v === 'string' &&
				typeof c.start === 'number' &&
				typeof c.end === 'number'
			) {
				chunks.push({ id: c.id, content: c.content, start: c.start, end: c.end, v: c.v });
			}
		}
		files[path] = {
			mtime: typeof rec.mtime === 'number' ? rec.mtime : 0,
			size: typeof rec.size === 'number' ? rec.size : 0,
			chunks,
		};
	}
	return {
		version: 1,
		provider: d.provider,
		model: d.model,
		chunkSize: typeof d.chunkSize === 'number' ? d.chunkSize : 0,
		chunkOverlap: typeof d.chunkOverlap === 'number' ? d.chunkOverlap : 0,
		lastBuilt: typeof d.lastBuilt === 'number' ? d.lastBuilt : 0,
		files,
	};
}
