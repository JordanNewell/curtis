import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// The real obsidian package is types-only (its main entry does not
		// resolve), so any test importing adapter code that imports
		// 'obsidian' is aliased to a functional stub. TFile/TFolder are real
		// classes there — the shared instanceof identity the adapters and
		// tests both see.
		alias: {
			obsidian: fileURLToPath(new URL('./src/test/obsidian-stub.ts', import.meta.url)),
		},
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
	},
});
