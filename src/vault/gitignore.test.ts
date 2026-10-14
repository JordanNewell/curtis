// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// ensureGitignoreCoversArtifacts tests — fake vault adapter over maps.

import { describe, expect, it } from 'vitest';
import { ensureGitignoreCoversArtifacts } from './gitignore';

const files = new Set<string>();
const contents = new Map<string, string>();

const makeApp = () => ({
	vault: {
		adapter: {
			exists: async (p: string) => files.has(p),
			read: async (p: string) => contents.get(p) ?? '',
			append: async (p: string, data: string) => {
				contents.set(p, (contents.get(p) ?? '') + data);
			},
		},
	},
});

const reset = (): void => {
	files.clear();
	contents.clear();
};

const AI_ARTIFACTS = ['AI/Curtis Memory.md', 'AI/Curtis Journal.md', 'AI/Conversations'];

describe('ensureGitignoreCoversArtifacts', () => {
	it('does nothing when no .gitignore exists (never creates one)', async () => {
		reset();
		files.add('AI');
		await ensureGitignoreCoversArtifacts(makeApp() as never, AI_ARTIFACTS);
		expect(files.has('.gitignore')).toBe(false);
	});

	it('appends a marked AI/ block to a .gitignore that lacks coverage', async () => {
		reset();
		files.add('AI');
		files.add('.gitignore');
		contents.set('.gitignore', 'node_modules/\n.curt/\nconversations/\n');
		await ensureGitignoreCoversArtifacts(makeApp() as never, AI_ARTIFACTS);
		const out = contents.get('.gitignore') ?? '';
		expect(out).toContain('# curtis plugin artifacts');
		expect(out).toContain('AI/');
		// Original content untouched, block appended after a separator.
		expect(out.startsWith('node_modules/\n')).toBe(true);
	});

	it('glues the block on when the file lacks a trailing newline', async () => {
		reset();
		files.add('AI');
		files.add('.gitignore');
		contents.set('.gitignore', 'node_modules/');
		await ensureGitignoreCoversArtifacts(makeApp() as never, AI_ARTIFACTS);
		const out = contents.get('.gitignore') ?? '';
		expect(out.startsWith('node_modules/\n# curtis plugin artifacts\nAI/\n')).toBe(true);
	});

	it('is idempotent when AI/ is already covered', async () => {
		reset();
		files.add('AI');
		files.add('.gitignore');
		const before = 'node_modules/\n# curtis plugin artifacts\nAI/\n';
		contents.set('.gitignore', before);
		await ensureGitignoreCoversArtifacts(makeApp() as never, AI_ARTIFACTS);
		expect(contents.get('.gitignore')).toBe(before);
	});

	it('treats parent-dir and wildcard patterns as coverage', async () => {
		reset();
		files.add('AI');
		files.add('.gitignore');
		for (const line of ['AI', '/AI/', '**/AI', 'AI/**', '*', '**']) {
			contents.set('.gitignore', `${line}\n`);
			await ensureGitignoreCoversArtifacts(makeApp() as never, AI_ARTIFACTS);
			expect(contents.get('.gitignore')).toBe(`${line}\n`);
		}
	});

	it('ignores negated and comment lines as non-coverage', async () => {
		reset();
		files.add('AI');
		files.add('.gitignore');
		contents.set('.gitignore', '# AI somewhere\n!AI/\n');
		await ensureGitignoreCoversArtifacts(makeApp() as never, AI_ARTIFACTS);
		expect(contents.get('.gitignore')).toContain('AI/\n# curtis plugin artifacts');
	});

	it('does nothing when the artifact folders do not exist yet', async () => {
		reset();
		files.add('.gitignore');
		contents.set('.gitignore', 'node_modules/\n');
		await ensureGitignoreCoversArtifacts(makeApp() as never, AI_ARTIFACTS);
		expect(contents.get('.gitignore')).toBe('node_modules/\n');
	});

	it('swallows a read-only .gitignore instead of throwing', async () => {
		reset();
		files.add('AI');
		files.add('.gitignore');
		const app = {
			vault: {
				adapter: {
					exists: async (p: string) => files.has(p),
					read: async (p: string) => contents.get(p) ?? '',
					append: async () => {
						throw new Error('EACCES: read-only');
					},
				},
			},
		};
		await expect(
			ensureGitignoreCoversArtifacts(app as never, AI_ARTIFACTS)
		).resolves.toBeUndefined();
	});

	it('skips root-level artifacts (no parent folder to ignore)', async () => {
		reset();
		files.add('.gitignore');
		contents.set('.gitignore', 'node_modules/\n');
		await ensureGitignoreCoversArtifacts(makeApp() as never, ['Memory.md']);
		expect(contents.get('.gitignore')).toBe('node_modules/\n');
	});
});
