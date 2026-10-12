// Curtis — RAG lexical index: field-weighted BM25 over the same chunks the
// embedding index holds, fused with cosine rankings via RRF.
//
// Pure class + functions, no Obsidian imports — trivially testable. The index
// lives in memory only and mirrors the embedding index: chunk content already
// persists inside rag-index.json, so lexical search adds no persistence, no
// API calls, and no background work beyond tokenizing text already held.

/** BM25 term-frequency saturation. */
const K1 = 1.2;
/** BM25 document-length normalization. */
const B = 0.75;
/** Field weights: title and path hits outrank plain body hits (BM25F-lite). */
const TITLE_WEIGHT = 3;
const PATH_WEIGHT = 2;

/** ASCII alphanumeric runs, or maximal CJK runs (per code point). */
const TOKEN_RE = /[a-z0-9]+|[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;

/**
 * Tokenize for indexing and queries: lowercased ASCII alphanumeric runs, plus
 * CJK runs as per-character unigrams and consecutive bigrams — no-space
 * scripts only carry a word boundary every few characters, so unigrams alone
 * undermatch and bigrams alone break single-character queries. No stopword
 * list: BM25's IDF demotes common terms on its own.
 */
export function tokenize(text: string): string[] {
	const tokens: string[] = [];
	const lower = text.toLowerCase();
	const re = TOKEN_RE;
	re.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(lower)) !== null) {
		const run = m[0];
		const c = run.charCodeAt(0);
		if ((c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a)) {
			tokens.push(run);
			continue;
		}
		for (let i = 0; i < run.length; i++) {
			tokens.push(run[i]);
			if (i + 1 < run.length) tokens.push(run[i] + run[i + 1]);
		}
	}
	return tokens;
}

/** A chunk to index lexically — EmbeddingChunk satisfies this structurally. */
export interface Bm25Doc {
	id: string;
	content: string;
}

export interface Bm25Hit {
	id: string;
	score: number;
}

/**
 * Incremental BM25 index keyed by chunk id. Document frequency is maintained
 * per add/remove (via each doc's term set), so IDF stays correct without full
 * rebuilds; setFile(path, chunks) replaces everything previously indexed for
 * that path, which is the only shape the embedding index mutates in.
 */
export class Bm25Index {
	/** term -> (docId -> weighted term frequency). */
	private postings = new Map<string, Map<string, number>>();
	/** docId -> weighted term frequencies (its terms, for df decrement). */
	private docTf = new Map<string, Map<string, number>>();
	/** docId -> weighted token count. */
	private docLen = new Map<string, number>();
	/** docId -> owning file path. */
	private docFile = new Map<string, string>();
	/** path -> doc ids (for whole-file replacement/removal). */
	private fileDocs = new Map<string, Set<string>>();
	/** term -> number of docs containing it. */
	private df = new Map<string, number>();
	private n = 0;
	private totalLen = 0;

	get size(): number {
		return this.n;
	}

	setFile(path: string, chunks: Bm25Doc[]): void {
		this.removeFile(path);
		if (chunks.length === 0) return;
		// Title (basename minus extension) and path segments are indexed as
		// weighted fields: chunks are anonymous slices, and "the note named X"
		// is the single most common lexical query shape in a vault.
		const base = path.slice(path.lastIndexOf('/') + 1);
		const dot = base.lastIndexOf('.');
		const title = dot > 0 ? base.slice(0, dot) : base;
		const titleTokens = tokenize(title);
		const pathTokens = tokenize(path);
		const ids = new Set<string>();
		for (const chunk of chunks) {
			const tf = new Map<string, number>();
			let len = 0;
			const addField = (tokens: string[], weight: number): void => {
				for (const t of tokens) {
					tf.set(t, (tf.get(t) || 0) + weight);
					len += weight;
				}
			};
			addField(titleTokens, TITLE_WEIGHT);
			addField(pathTokens, PATH_WEIGHT);
			addField(tokenize(chunk.content), 1);
			for (const [term, freq] of tf) {
				let docs = this.postings.get(term);
				if (!docs) {
					docs = new Map();
					this.postings.set(term, docs);
				}
				docs.set(chunk.id, freq);
				this.df.set(term, (this.df.get(term) || 0) + 1);
			}
			this.docLen.set(chunk.id, len);
			this.docTf.set(chunk.id, tf);
			this.docFile.set(chunk.id, path);
			this.totalLen += len;
			this.n += 1;
			ids.add(chunk.id);
		}
		this.fileDocs.set(path, ids);
	}

	removeFile(path: string): void {
		const ids = this.fileDocs.get(path);
		if (!ids) return;
		for (const id of ids) {
			const len = this.docLen.get(id) || 0;
			const tf = this.docTf.get(id);
			this.docLen.delete(id);
			this.docTf.delete(id);
			this.docFile.delete(id);
			this.totalLen -= len;
			this.n -= 1;
			// df is per doc-containing-term: strip this doc's postings and
			// decrement counters so IDF reflects the live corpus.
			if (tf) {
				for (const term of tf.keys()) {
					const docs = this.postings.get(term);
					if (!docs || !docs.delete(id)) continue;
					const left = (this.df.get(term) || 1) - 1;
					if (left <= 0) {
						this.df.delete(term);
						this.postings.delete(term);
					} else {
						this.df.set(term, left);
					}
				}
			}
		}
		this.fileDocs.delete(path);
	}

	clear(): void {
		this.postings.clear();
		this.docTf.clear();
		this.docLen.clear();
		this.docFile.clear();
		this.fileDocs.clear();
		this.df.clear();
		this.n = 0;
		this.totalLen = 0;
	}

	/** Top-N chunks by BM25 score for a raw query string. */
	search(query: string, topN: number): Bm25Hit[] {
		if (this.n === 0) return [];
		const tokens = tokenize(query);
		if (tokens.length === 0) return [];
		const avgdl = this.totalLen / this.n;
		const scores = new Map<string, number>();
		for (const term of tokens) {
			const docs = this.postings.get(term);
			if (!docs) continue;
			const df = this.df.get(term) || 0;
			const idf = Math.log(1 + (this.n - df + 0.5) / (df + 0.5));
			for (const [id, tf] of docs) {
				const dl = this.docLen.get(id) || 1;
				const denom = tf + K1 * (1 - B + B * (dl / avgdl));
				const s = idf * ((tf * (K1 + 1)) / denom);
				scores.set(id, (scores.get(id) || 0) + s);
			}
		}
		const hits = [...scores.entries()].map(([id, score]) => ({ id, score }));
		hits.sort((a, b) => b.score - a.score);
		return hits.slice(0, Math.max(1, topN));
	}
}

/**
 * Reciprocal Rank Fusion: combine ranked id lists into one score map using
 * only ranks — 1/(k + rank), 1-based — so incomparable scales (bounded
 * cosine vs corpus-scale BM25) never mix directly. Absence from a list
 * contributes 0, so any empty channel degrades gracefully to the other.
 */
export function rrfFuse(rankLists: string[][], k = 60): Map<string, number> {
	const fused = new Map<string, number>();
	for (const list of rankLists) {
		for (let i = 0; i < list.length; i++) {
			const id = list[i];
			fused.set(id, (fused.get(id) || 0) + 1 / (k + i + 1));
		}
	}
	return fused;
}
