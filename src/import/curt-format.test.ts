// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// parseCurt conformance — executes the dot_curt L1 (core) and extension
// vectors against this plugin's parseCurt. Fixtures are pinned copies of
// dot_curt/conformance/vectors (core.json, extensions.json); refresh them
// from the spec repo when the spec revision moves.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseCurt } from './curt-format';

interface VectorSet {
	level: string;
	name: string;
	vectors: { name: string; expect: string; body: string }[];
}

function loadVectors(file: string): VectorSet {
	return JSON.parse(
		readFileSync(fileURLToPath(new URL(`./conformance/${file}`, import.meta.url)), 'utf8'),
	) as VectorSet;
}

const vectorSets = [loadVectors('core.json'), loadVectors('extensions.json')];

describe.each(vectorSets)('parseCurt conformance: $name ($level)', ({ vectors }) => {
	it.each(vectors)('$name', ({ expect: expectation, body }) => {
		expect(parseCurt(body) !== null).toBe(expectation === 'accept');
	});
});
