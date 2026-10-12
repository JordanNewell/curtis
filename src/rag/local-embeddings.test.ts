// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LOCAL_EMBEDDING_MODEL,
	applyModelPrefixes,
	embedBatched,
	isLocalEmbeddingProvider,
	localModelIdentity,
	LOCAL_EMBEDDING_PROVIDER_ID,
	PipelineSlot,
	type CachedPipeline,
} from './local-embeddings';

function fakePipeline(tag: string): CachedPipeline {
	return {
		fn: async (texts: string[]) => texts.map(() => [tag.length]),
		dispose: async () => {
			// observable via tag in callers; nothing to do here
		},
	};
}

describe('PipelineSlot', () => {
	it('returns the resident entry only for its key', async () => {
		const slot = new PipelineSlot();
		const entry = Promise.resolve(fakePipeline('a'));
		slot.set('model|q8', entry);
		expect(slot.get('model|q8')).toBe(entry);
		expect(slot.get('model|fp16')).toBeNull();
	});

	it('evicts the previous entry when a different key installs', async () => {
		const slot = new PipelineSlot();
		const evicted: Array<string> = [];
		const first = Promise.resolve({ ...fakePipeline('a'), dispose: async () => { evicted.push('first'); } });
		slot.set('m1|q8', first);
		slot.set('m2|fp16', Promise.resolve(fakePipeline('b')), (e) => void e.then((p) => p.dispose()));
		// Microtask flush — the eviction chain is all promises, no timers.
		await Promise.resolve();
		await Promise.resolve();
		expect(evicted).toEqual(['first']);
	});

	it('does not evict on a same-key replace', async () => {
		const slot = new PipelineSlot();
		let evictions = 0;
		slot.set('m|q8', Promise.resolve(fakePipeline('a')), () => { evictions++; });
		slot.set('m|q8', Promise.resolve(fakePipeline('retry')), () => { evictions++; });
		expect(evictions).toBe(0);
	});

	it('clear drops the entry without eviction and admits a fresh one', async () => {
		const slot = new PipelineSlot();
		let evictions = 0;
		slot.set('m|q8', Promise.resolve(fakePipeline('a')), () => { evictions++; });
		slot.clear('m|q8');
		expect(slot.get('m|q8')).toBeNull();
		const fresh = Promise.resolve(fakePipeline('b'));
		slot.set('m|q8', fresh);
		expect(slot.get('m|q8')).toBe(fresh);
		expect(evictions).toBe(0);
	});
});

describe('localModelIdentity', () => {
	it('folds precision into the stamped model identity', () => {
		expect(localModelIdentity('Xenova/bge-small-en-v1.5', 'q8'))
			.toBe('Xenova/bge-small-en-v1.5 [q8]');
	});

	it('distinguishes precisions of the same model', () => {
		expect(localModelIdentity('m', 'q8')).not.toBe(localModelIdentity('m', 'fp16'));
		expect(localModelIdentity('m', 'fp16')).not.toBe(localModelIdentity('m', 'fp32'));
	});
});

describe('applyModelPrefixes', () => {
	it('prepends the usage-specific prefix for e5-family specs', () => {
		const spec = { pooling: 'mean' as const, queryPrefix: 'query: ', passagePrefix: 'passage: ' };
		expect(applyModelPrefixes(['hello'], spec, 'query')).toEqual(['query: hello']);
		expect(applyModelPrefixes(['hello'], spec, 'passage')).toEqual(['passage: hello']);
	});

	it('returns inputs unchanged when the spec has no prefixes', () => {
		const spec = { pooling: 'cls' as const, queryPrefix: '', passagePrefix: '' };
		expect(applyModelPrefixes(['a', 'b'], spec, 'query')).toEqual(['a', 'b']);
	});
});

describe('isLocalEmbeddingProvider', () => {
	it('matches only the sentinel provider id', () => {
		expect(isLocalEmbeddingProvider(LOCAL_EMBEDDING_PROVIDER_ID)).toBe(true);
		expect(isLocalEmbeddingProvider('openai')).toBe(false);
		expect(isLocalEmbeddingProvider('')).toBe(false);
	});

	it('ships a non-empty default model id', () => {
		expect(DEFAULT_LOCAL_EMBEDDING_MODEL).toContain('/');
	});
});

const noYield = (): Promise<void> => Promise.resolve();

describe('embedBatched', () => {
	it('returns vectors in input order across batch boundaries', async () => {
		// 40 inputs forces 3 batches at LOCAL_BATCH_SIZE = 16.
		const inputs = Array.from({ length: 40 }, (_, i) => 'x'.repeat(i + 1));
		const fake = async (texts: string[]): Promise<number[][]> => texts.map((t) => [t.length]);
		const out = await embedBatched(fake, inputs, undefined, noYield);
		expect(out).toHaveLength(40);
		expect(out[0]).toEqual([1]);
		expect(out[39]).toEqual([40]);
	});

	it('reports monotonically increasing progress per batch', async () => {
		const seen: Array<[number, number]> = [];
		const fake = async (texts: string[]): Promise<number[][]> => texts.map(() => [0]);
		await embedBatched(fake, Array.from({ length: 20 }, () => 't'), (done, total) => {
			seen.push([done, total]);
		}, noYield);
		expect(seen).toEqual([
			[16, 20],
			[20, 20],
		]);
	});

	it('handles an empty input without calling the engine', async () => {
		let called = false;
		const fake = async (): Promise<number[][]> => {
			called = true;
			return [];
		};
		expect(await embedBatched(fake, [], undefined, noYield)).toEqual([]);
		expect(called).toBe(false);
	});

	it('throws when the engine returns the wrong vector count', async () => {
		const fake = async (): Promise<number[][]> => [[1]];
		await expect(embedBatched(fake, ['a', 'b'], undefined, noYield)).rejects.toThrow(
			/expected 2 embedding/i
		);
	});
});
