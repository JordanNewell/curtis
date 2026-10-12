// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Node tests for the lexical half of hybrid retrieval — tokenizer, BM25
// scoring with field boosts, and RRF fusion. No Obsidian imports here, same
// as the module under test.

import { describe, expect, it } from 'vitest';
import { Bm25Index, rrfFuse, tokenize } from './bm25';

describe('tokenize', () => {
	it('lowercases and keeps alphanumeric runs only', () => {
		expect(tokenize('The Quick-Brown_fox!')).toEqual(['the', 'quick', 'brown', 'fox']);
	});

	it('keeps digits', () => {
		expect(tokenize('GPT-4o and 2026 reviews')).toEqual(['gpt', '4o', 'and', '2026', 'reviews']);
	});

	it('emits CJK runs as unigrams and consecutive bigrams', () => {
		// 東京駅 -> 東, 東京, 京, 京駅, 駅
		expect(tokenize('東京駅')).toEqual(['東', '東京', '京', '京駅', '駅']);
	});

	it('tokenizes mixed ascii and CJK in one pass', () => {
		const tokens = tokenize('Note 東京へ行く');
		expect(tokens).toContain('note');
		expect(tokens).toContain('東京');
		expect(tokens).toContain('へ行');
		expect(tokens).not.toContain('note 東');
	});

	it('returns nothing for punctuation-only input', () => {
		expect(tokenize('!? — …')).toEqual([]);
	});
});

describe('Bm25Index', () => {
	it('ranks a rare-term doc above term-frequency stuffing', () => {
		const idx = new Bm25Index();
		idx.setFile('a.md', [{ id: 'a#0', content: 'the quick fox' }]);
		idx.setFile('b.md', [{ id: 'b#0', content: 'the the the cat' }]);
		const hits = idx.search('the fox', 10);
		expect(hits[0]?.id).toBe('a#0');
	});

	it('boosts title matches over body matches', () => {
		const idx = new Bm25Index();
		idx.setFile('zebra.md', [{ id: 'z#0', content: 'unrelated prose entirely' }]);
		idx.setFile('other.md', [{ id: 'o#0', content: 'a passing zebra mention in the body text' }]);
		const hits = idx.search('zebra', 10);
		expect(hits[0]?.id).toBe('z#0');
	});

	it('matches path segments (folder names)', () => {
		const idx = new Bm25Index();
		idx.setFile('Projects/Apollo/notes.md', [{ id: 'p#0', content: 'generic status update' }]);
		idx.setFile('Projects/Zeus/notes.md', [{ id: 'q#0', content: 'generic status update' }]);
		const hits = idx.search('apollo', 10);
		expect(hits).toHaveLength(1);
		expect(hits[0]?.id).toBe('p#0');
	});

	it('drops removed docs and their term statistics', () => {
		const idx = new Bm25Index();
		idx.setFile('a.md', [{ id: 'a#0', content: 'unique alpha token' }]);
		idx.setFile('b.md', [{ id: 'b#0', content: 'unique beta token' }]);
		expect(idx.size).toBe(2);

		idx.removeFile('a.md');
		expect(idx.size).toBe(1);
		expect(idx.search('alpha', 10)).toEqual([]);

		// With 'alpha' gone from the corpus, 'unique' is no longer
		// differentiated by df — b remains the only hit for it.
		const hits = idx.search('unique', 10);
		expect(hits.map((h) => h.id)).toEqual(['b#0']);
	});

	it('replaces a file on re-set without duplicate docs', () => {
		const idx = new Bm25Index();
		idx.setFile('a.md', [
			{ id: 'a#0', content: 'first version' },
			{ id: 'a#500', content: 'first tail' },
		]);
		idx.setFile('a.md', [{ id: 'a#0', content: 'second version' }]);
		expect(idx.size).toBe(1);
		const hits = idx.search('first', 10);
		expect(hits).toEqual([]);
		expect(idx.search('second', 10)[0]?.id).toBe('a#0');
	});

	it('handles per-file replacement of only the edited file', () => {
		const idx = new Bm25Index();
		idx.setFile('a.md', [{ id: 'a#0', content: 'alpha stays' }]);
		idx.setFile('b.md', [{ id: 'b#0', content: 'beta original' }]);
		idx.setFile('b.md', [{ id: 'b#0', content: 'beta rewritten' }]);
		expect(idx.size).toBe(2);
		expect(idx.search('alpha', 10).map((h) => h.id)).toEqual(['a#0']);
		expect(idx.search('rewritten', 10).map((h) => h.id)).toEqual(['b#0']);
	});

	it('clears completely', () => {
		const idx = new Bm25Index();
		idx.setFile('a.md', [{ id: 'a#0', content: 'content' }]);
		idx.clear();
		expect(idx.size).toBe(0);
		expect(idx.search('content', 10)).toEqual([]);
	});

	it('returns nothing for queries that tokenize to nothing', () => {
		const idx = new Bm25Index();
		idx.setFile('a.md', [{ id: 'a#0', content: 'real content' }]);
		expect(idx.search('!? …', 10)).toEqual([]);
	});
});

describe('rrfFuse', () => {
	it('scores each list contribution as 1/(k + rank)', () => {
		const fused = rrfFuse([['a', 'b'], ['b', 'c']], 60);
		expect(fused.get('a')).toBeCloseTo(1 / 61);
		expect(fused.get('b')).toBeCloseTo(1 / 62 + 1 / 61);
		expect(fused.get('c')).toBeCloseTo(1 / 62);
	});

	it('ranks an item present in both lists above items in one', () => {
		const fused = rrfFuse([['a', 'b'], ['b', 'c']], 60);
		const b = fused.get('b')!;
		expect(b).toBeGreaterThan(fused.get('a')!);
		expect(b).toBeGreaterThan(fused.get('c')!);
	});

	it('degrades to the single list order when the other is empty', () => {
		const fused = rrfFuse([['x', 'y', 'z'], []], 60);
		const order = [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
		expect(order).toEqual(['x', 'y', 'z']);
	});

	it('returns an empty map for no lists', () => {
		expect(rrfFuse([])).toEqual(new Map());
	});
});
