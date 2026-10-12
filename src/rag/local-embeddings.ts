// Curtis — Local (on-device) embeddings via transformers.js.
//
// The runtime and model weights load lazily: nothing initializes until this
// provider actually embeds. Weights (~30 MB int8 for the default bge-small
// model) download once from the Hugging Face hub and are cached by the
// WebView; the ONNX runtime uses WebGPU where available and falls back to
// WASM everywhere else — including Obsidian mobile.
//
// This module is deliberately Obsidian-free so the batching logic stays
// unit-testable under node; the plugin layer surfaces status via callbacks
// (Notices in the rebuild flow).

export const LOCAL_EMBEDDING_PROVIDER_ID = 'curtis-local';
export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';

/** True when the vault-retrieval embedding provider is the on-device engine. */
export function isLocalEmbeddingProvider(providerId: string): boolean {
	return providerId === LOCAL_EMBEDDING_PROVIDER_ID;
}

/** Which side of the retrieval contract a text belongs to — e5-family
 *  models take different instruction prefixes for queries vs. passages. */
export type EmbedUsage = 'query' | 'passage';

/** Weight precision for the on-device engine. q8 is the default and the only
 *  option without WebGPU; fp16/fp32 are desktop quality tiers. */
export type LocalDtype = 'q8' | 'fp16' | 'fp32';

/** Identity stamped into the index for the local engine — model plus
 *  precision, so switching either triggers the same honest rebuild as any
 *  other engine change: q8 and fp16 vectors must never mix in one index. */
export function localModelIdentity(model: string, dtype: LocalDtype): string {
	return `${model} [${dtype}]`;
}

import { resolveLocalModelSpec, type LocalModelSpec } from './model-catalog';

/** WASM inference runs on the main thread — small batches with a yield
 *  between them keep the UI responsive during full-vault builds. */
const LOCAL_BATCH_SIZE = 16;

export type LocalEmbedStatus = (message: string) => void;

/** One engine call: a batch of texts → one vector per text. */
type EmbedFn = (texts: string[]) => Promise<number[][]>;

export class LocalEmbeddingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LocalEmbeddingError';
	}
}

/** A resident local pipeline: the embed function plus its disposal handle. */
export interface CachedPipeline {
	fn: EmbedFn;
	dispose: () => Promise<void>;
}

/**
 * Single-slot pipeline cache: at most ONE model|dtype session stays resident.
 * Each ONNX session pins its weights in memory (tens of MB at q8, hundreds at
 * fp16/fp32 or on large models), so keeping every combination ever used alive
 * would grow without bound — initializing a new model or precision instead
 * disposes the previous session. Re-initialization is cheap after the first
 * download (weights are cached by the WebView). Pure class — unit-tested.
 */
export class PipelineSlot {
	private key: string | null = null;
	private entry: Promise<CachedPipeline> | null = null;

	get(key: string): Promise<CachedPipeline> | null {
		return this.key === key ? this.entry : null;
	}

	/** Install an entry. A DIFFERENT resident entry is handed to `onEvict`
	 *  for disposal; a same-key re-set (previous init failed) just replaces. */
	set(
		key: string,
		entry: Promise<CachedPipeline>,
		onEvict?: (evicted: Promise<CachedPipeline>) => void
	): void {
		if (this.key === key) {
			this.entry = entry;
			return;
		}
		const old = this.entry;
		this.key = key;
		this.entry = entry;
		if (old) onEvict?.(old);
	}

	/** Drop the entry for `key` (failed init or dead session). Nothing is
	 *  disposed — the caller already lost faith in it. */
	clear(key: string): void {
		if (this.key === key) {
			this.key = null;
			this.entry = null;
		}
	}
}

const slot = new PipelineSlot();

/** Prepend the family's instruction prefix (e5 models distinguish queries
 *  from passages; everything else uses none). Pure — unit-tested. */
export function applyModelPrefixes(
	inputs: string[],
	spec: LocalModelSpec,
	usage: EmbedUsage
): string[] {
	const prefix = usage === 'query' ? spec.queryPrefix : spec.passagePrefix;
	return prefix ? inputs.map((t) => prefix + t) : inputs;
}

export async function embedTextsLocal(
	model: string,
	inputs: string[],
	onProgress?: (done: number, total: number) => void,
	onStatus?: LocalEmbedStatus,
	usage: EmbedUsage = 'passage',
	dtype: LocalDtype = 'q8'
): Promise<number[][]> {
	if (inputs.length === 0) return [];
	const spec = resolveLocalModelSpec(model);
	const fn = await getEmbedFn(model, spec, dtype, onStatus);
	return embedBatched(fn, applyModelPrefixes(inputs, spec, usage), onProgress);
}

async function getEmbedFn(
	model: string,
	spec: LocalModelSpec,
	dtype: LocalDtype,
	onStatus?: LocalEmbedStatus
): Promise<EmbedFn> {
	// Keyed by model AND precision — a dtype switch must build a new pipeline,
	// not reuse the cached one.
	const key = `${model}|${dtype}`;
	let entry = slot.get(key);
	if (!entry) {
		entry = createPipeline(model, spec, dtype, onStatus).catch((e) => {
			// A failed init must not poison later retries.
			slot.clear(key);
			throw e;
		});
		slot.set(key, entry, (evicted) => {
			// Best-effort: a session whose init failed has nothing to
			// release, and disposal errors must never mask the embed that
			// triggered the switch.
			void evicted.then((p) => p.dispose()).catch(() => undefined);
		});
	}
	const pipeline = await entry;
	// Self-heal: a session can die under us (WebGPU device loss after
	// sleep/wake, driver reset). Evict on inference failure so the next
	// attempt re-initializes instead of reusing the dead session forever.
	return async (texts: string[]) => {
		try {
			return await pipeline.fn(texts);
		} catch (e) {
			slot.clear(key);
			throw e instanceof LocalEmbeddingError
				? e
				: new LocalEmbeddingError(
					`Local inference failed — ${(e as Error).message}. The session re-initializes on the next attempt.`
				);
		}
	};
}

/** Structural types over the transformers.js runtime — typed to exactly the
 *  surface this module touches so the dynamic import's loose declarations
 *  can't leak `any` past the pipeline factory. */
interface EmbeddingTensor {
	/** Shape after pooling: [batch, dimensions]. */
	dims: number[];
	data: Float32Array;
}

type FeatureExtractionPipeline = {
	(texts: string[], opts: { pooling: 'cls' | 'mean'; normalize: boolean }): Promise<EmbeddingTensor>;
	dispose(): Promise<void>;
};

interface TransformersModule {
	env: { allowLocalModels: boolean };
	pipeline(
		task: 'feature-extraction',
		model: string,
		opts: {
			dtype: LocalDtype;
			device: 'webgpu' | 'wasm';
			progress_callback: (data: unknown) => void;
		}
	): Promise<FeatureExtractionPipeline>;
}

async function createPipeline(
	model: string,
	spec: LocalModelSpec,
	dtype: LocalDtype,
	onStatus?: LocalEmbedStatus
): Promise<CachedPipeline> {
	// Lazy dynamic import — the bundled transformers.js runtime initializes
	// its sessions only at pipeline creation, so the cost stays opt-in.
	const tf = (await import('@huggingface/transformers')) as unknown as TransformersModule;
	tf.env.allowLocalModels = false;

	const progress = (data: unknown): void => {
		if (!onStatus) return;
		const p = data as { status?: string; file?: string; progress?: number };
		if (p.status === 'progress' && p.file && typeof p.progress === 'number') {
			if (p.file.endsWith('.onnx') || p.file.endsWith('.json')) {
				onStatus(`local model — downloading ${p.file} ${Math.floor(p.progress)}%`);
			}
		}
	};
	const load = (device: 'webgpu' | 'wasm'): Promise<FeatureExtractionPipeline> =>
		tf.pipeline('feature-extraction', model, { dtype, device, progress_callback: progress });

	onStatus?.(`local model — loading ${model} (${dtype})…`);
	let pipe: FeatureExtractionPipeline;
	try {
		pipe = await load('webgpu');
	} catch {
		if (dtype !== 'q8') {
			// fp16/fp32 sessions are only practical on WebGPU — falling back
			// to WASM would silently change precision, so refuse instead.
			throw new LocalEmbeddingError(
				`WebGPU unavailable — ${dtype} weights need it. Switch precision to q8 in Settings → Vault retrieval, or rebuild on a WebGPU-capable desktop.`
			);
		}
		// No WebGPU (older webviews, Obsidian mobile) or a broken driver —
		// WASM runs everywhere, just slower.
		onStatus?.('local model — WebGPU unavailable, using WASM…');
		try {
			pipe = await load('wasm');
		} catch (e) {
			throw new LocalEmbeddingError(
				`Failed to load local embedding model "${model}" — ${(e as Error).message}`
			);
		}
	}

	return {
		fn: async (texts: string[]): Promise<number[][]> => {
			const out = await pipe(texts, { pooling: spec.pooling, normalize: true });
			// Tensor → per-text vectors: dims is [batch, dimensions] after
			// pooling; data is the flat float32 payload.
			const dims = out.dims;
			const dim = dims[dims.length - 1] || 0;
			if (dim === 0 || dims[dims.length - 2] !== texts.length) {
				throw new LocalEmbeddingError(
					`Unexpected embedding tensor shape [${dims.join(', ')}] for ${texts.length} input(s)`
				);
			}
			const data = out.data;
			const vecs: number[][] = [];
			for (let i = 0; i < texts.length; i++) {
				vecs.push(Array.from(data.subarray(i * dim, (i + 1) * dim)));
			}
			return vecs;
		},
		dispose: async (): Promise<void> => {
			// Disposable in transformers.js — releases the ONNX session and
			// its weights. Guarded: disposal must never outrank the caller.
			try {
				await pipe.dispose();
			} catch {
				// Session already gone — nothing to release.
			}
		},
	};
}

/** Yield to the UI thread between WASM batches (runs on the main thread).
 *  Injectable so node tests can pass a no-op — `window` doesn't exist there. */
const uiYield = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

/** Batch wrapper shared by build/query paths: yields to the UI thread between
 *  batches and reports (done, total) after each batch, mirroring the pacing
 *  contract of the HTTP embedTexts(). */
export async function embedBatched(
	fn: EmbedFn,
	inputs: string[],
	onProgress?: (done: number, total: number) => void,
	yieldFn: () => Promise<void> = uiYield
): Promise<number[][]> {
	const out: number[][] = new Array<number[]>(inputs.length);
	let done = 0;
	for (let i = 0; i < inputs.length; i += LOCAL_BATCH_SIZE) {
		const batch = inputs.slice(i, i + LOCAL_BATCH_SIZE);
		const vectors = await fn(batch);
		if (vectors.length !== batch.length) {
			throw new LocalEmbeddingError(
				`Expected ${batch.length} embedding(s), got ${vectors.length}`
			);
		}
		for (let j = 0; j < batch.length; j++) out[i + j] = vectors[j];
		done += batch.length;
		onProgress?.(done, inputs.length);
		if (i + LOCAL_BATCH_SIZE < inputs.length) {
			await yieldFn();
		}
	}
	return out;
}
