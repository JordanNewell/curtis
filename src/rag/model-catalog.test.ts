// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
import { describe, expect, it } from 'vitest';
import {
	CURATED_LOCAL_MODELS,
	MOBILE_HEAVY_PARAMS_M,
	resolveLocalModelSpec,
} from './model-catalog';

describe('CURATED_LOCAL_MODELS', () => {
	it('ships the verified default first', () => {
		expect(CURATED_LOCAL_MODELS[0].id).toBe('Xenova/bge-small-en-v1.5');
		expect(CURATED_LOCAL_MODELS[0].pooling).toBe('cls');
	});

	it('has unique ids and sane metadata', () => {
		const ids = CURATED_LOCAL_MODELS.map((m) => m.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const m of CURATED_LOCAL_MODELS) {
			expect(m.dims).toBeGreaterThan(0);
			expect(m.paramsM).toBeGreaterThan(0);
			expect(m.label.length).toBeGreaterThan(0);
		}
	});

	it('marks exactly the e5 entries with query/passage prefixes', () => {
		const prefixed = CURATED_LOCAL_MODELS.filter((m) => m.queryPrefix || m.passagePrefix);
		expect(prefixed.map((m) => m.id)).toEqual([
			'Xenova/multilingual-e5-small',
			'Xenova/multilingual-e5-base',
		]);
		expect(prefixed.every((m) => m.queryPrefix === 'query: ' && m.passagePrefix === 'passage: ')).toBe(true);
	});

	it('ships the desktop power tiers — BGE large and multilingual E5 base', () => {
		const large = CURATED_LOCAL_MODELS.find((m) => m.id === 'Xenova/bge-large-en-v1.5');
		expect(large?.dims).toBe(1024);
		expect(large?.pooling).toBe('cls');
		const e5base = CURATED_LOCAL_MODELS.find((m) => m.id === 'Xenova/multilingual-e5-base');
		expect(e5base?.dims).toBe(768);
		expect(e5base?.pooling).toBe('mean');
	});
});

describe('resolveLocalModelSpec', () => {
	it('returns curated specs verbatim for known ids', () => {
		const spec = resolveLocalModelSpec('Xenova/all-MiniLM-L6-v2');
		expect(spec).toEqual({ pooling: 'mean', queryPrefix: '', passagePrefix: '', curated: true });
	});

	it('infers e5 family from unvetted ids — mean pooling plus prefixes', () => {
		const spec = resolveLocalModelSpec('intfloat/e5-small-v2');
		expect(spec).toEqual({ pooling: 'mean', queryPrefix: 'query: ', passagePrefix: 'passage: ', curated: false });
	});

	it('treats curated e5 ids as curated, not heuristic', () => {
		expect(resolveLocalModelSpec('Xenova/multilingual-e5-base').curated).toBe(true);
	});

	it('infers bge family from unvetted ids — cls pooling, no prefixes', () => {
		const spec = resolveLocalModelSpec('someone/bge-micro-x');
		expect(spec).toEqual({ pooling: 'cls', queryPrefix: '', passagePrefix: '', curated: false });
	});

	it('falls back to the sentence-transformers default for unknown families', () => {
		const spec = resolveLocalModelSpec('someone/some-embed-model');
		expect(spec).toEqual({ pooling: 'mean', queryPrefix: '', passagePrefix: '', curated: false });
	});

	it('keeps the mobile-heavy threshold below the base-size models', () => {
		expect(MOBILE_HEAVY_PARAMS_M).toBeLessThan(109);
		expect(MOBILE_HEAVY_PARAMS_M).toBeGreaterThan(33);
	});
});
