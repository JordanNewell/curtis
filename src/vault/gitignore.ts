// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Vault .gitignore guard — keep plugin artifacts (AI/) out of `git status`.

import type { App } from 'obsidian';

const MARKER = '# curtis plugin artifacts';

/** True when a .gitignore line already ignores `folder` (or a parent of it). */
function patternCovers(line: string, folder: string): boolean {
	const p = line.trim();
	if (!p || p.startsWith('#') || p.startsWith('!')) return false;
	const norm = p.replace(/^\//, '').replace(/\/+$/, '');
	if (!norm) return false;
	if (norm === folder || norm === `${folder}/**` || norm === '*' || norm === '**') return true;
	if (norm.startsWith('**/') && norm.slice(3) === folder) return true;
	// A parent-dir pattern (e.g. `AI`) covers everything beneath it.
	return folder.startsWith(`${norm}/`);
}

/**
 * If the vault root already has a .gitignore, append a marked block covering
 * the plugin's artifact folders (derived from the given artifact paths) so
 * they don't churn `git status`. A missing .gitignore means the vault isn't
 * git-curated — create nothing uninvited. Any failure (unreadable or
 * read-only file) degrades to a no-op that leaves the file alone.
 */
export async function ensureGitignoreCoversArtifacts(
	app: App,
	artifactPaths: Array<string | undefined>
): Promise<void> {
	const adapter = app.vault.adapter;
	try {
		if (!(await adapter.exists('.gitignore'))) return;
		// Only folders Curtis actually wrote (they exist) go into the block.
		const folders = new Set<string>();
		for (const raw of artifactPaths) {
			const path = raw?.trim().replace(/^\/+|\/+$/g, '');
			if (!path) continue;
			const slash = path.lastIndexOf('/');
			const folder = slash > 0 ? path.slice(0, slash) : '';
			if (folder && (await adapter.exists(folder))) folders.add(folder);
		}
		if (folders.size === 0) return;
		const contents = await adapter.read('.gitignore');
		const missing = [...folders].filter(
			(f) => !contents.split(/\r?\n/).some((line) => patternCovers(line, f))
		);
		if (missing.length === 0) return;
		const glue = contents.length > 0 && !contents.endsWith('\n') ? '\n' : '';
		const block = `${MARKER}\n${[...missing].map((f) => `${f}/`).join('\n')}\n`;
		await adapter.append('.gitignore', glue + block);
	} catch (e) {
		console.error('[Curtis] Could not update .gitignore:', e);
	}
}
