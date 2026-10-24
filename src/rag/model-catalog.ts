// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Curtis — Curated on-device embedding models + family-aware run specs.
//
// Pooling and (for the e5 family) query/passage instruction prefixes differ
// per model family — a mis-pooled model still "works" while returning
// quietly worse vectors, so the spec travels with the model id instead of
// being guessed once at runtime. Pure module: no Obsidian imports, so the
// resolution rules stay unit-testable under node.

export interface LocalModelSpec {
	/** Token pooling for the feature-extraction pipeline. */
	pooling: 'cls' | 'mean';
	/** e5-family instruction prefixes; empty for models that need none. */
	queryPrefix: string;
	passagePrefix: string;
}

export interface CuratedLocalModel extends LocalModelSpec {
	id: string;
	label: string;
	dims: number;
	/** Parameter count in millions — the mobile-weight signal. */
	paramsM: number;
	languages: string;
	note: string;
}

/** All seven verified live on the Hugging Face hub: transformers.js library,
 *  full ONNX dtype sets (q8, fp16, fp32 included), tokenizer.json present. */
export const CURATED_LOCAL_MODELS: CuratedLocalModel[] = [
	{
		id: 'Xenova/bge-small-en-v1.5',
		label: 'BGE small (default)',
		dims: 384,
		paramsM: 33,
		languages: 'English',
		note: 'Best balance of quality and size — the default.',
		pooling: 'cls',
		queryPrefix: '',
		passagePrefix: '',
	},
	{
		id: 'Xenova/all-MiniLM-L6-v2',
		label: 'MiniLM-L6',
		dims: 384,
		paramsM: 22,
		languages: 'English',
		note: 'Smallest and fastest; slightly lower precision.',
		pooling: 'mean',
		queryPrefix: '',
		passagePrefix: '',
	},
	{
		id: 'Xenova/gte-small',
		label: 'GTE small',
		dims: 384,
		paramsM: 33,
		languages: 'English',
		note: 'Strong on short text; an alternative to BGE small.',
		pooling: 'mean',
		queryPrefix: '',
		passagePrefix: '',
	},
	{
		id: 'Xenova/bge-base-en-v1.5',
		label: 'BGE base',
		dims: 768,
		paramsM: 109,
		languages: 'English',
		note: 'Higher precision at ~3× the size — slower on mobile.',
		pooling: 'cls',
		queryPrefix: '',
		passagePrefix: '',
	},
	{
		id: 'Xenova/bge-large-en-v1.5',
		label: 'BGE large',
		dims: 1024,
		paramsM: 335,
		languages: 'English',
		note: 'Top of the BGE line — desktop tier, use q8 or fp16 weights.',
		pooling: 'cls',
		queryPrefix: '',
		passagePrefix: '',
	},
	{
		id: 'Xenova/multilingual-e5-small',
		label: 'Multilingual E5 small',
		dims: 384,
		paramsM: 118,
		languages: '100+ languages',
		note: 'For non-English vaults. Query/passage prefixes are applied automatically.',
		pooling: 'mean',
		queryPrefix: 'query: ',
		passagePrefix: 'passage: ',
	},
	{
		id: 'Xenova/multilingual-e5-base',
		label: 'Multilingual E5 base',
		dims: 768,
		paramsM: 278,
		languages: '100+ languages',
		note: 'Higher-precision multilingual tier — desktop recommended.',
		pooling: 'mean',
		queryPrefix: 'query: ',
		passagePrefix: 'passage: ',
	},
];

/** Models above this parameter count get a "heavy on mobile" warning. */
export const MOBILE_HEAVY_PARAMS_M = 60;

/** Resolve the run spec for any repo id: curated first, then name-based
 *  family heuristics, then the sentence-transformers default (mean pooling,
 *  no prefixes). `curated` is false for heuristic matches so the picker can
 *  label them unvetted. */
export function resolveLocalModelSpec(repoId: string): LocalModelSpec & { curated: boolean } {
	const hit = CURATED_LOCAL_MODELS.find((m) => m.id === repoId);
	if (hit) {
		return {
			pooling: hit.pooling,
			queryPrefix: hit.queryPrefix,
			passagePrefix: hit.passagePrefix,
			curated: true,
		};
	}
	const id = repoId.toLowerCase();
	if (id.includes('e5')) {
		return { pooling: 'mean', queryPrefix: 'query: ', passagePrefix: 'passage: ', curated: false };
	}
	if (id.includes('bge')) {
		return { pooling: 'cls', queryPrefix: '', passagePrefix: '', curated: false };
	}
	return { pooling: 'mean', queryPrefix: '', passagePrefix: '', curated: false };
}
