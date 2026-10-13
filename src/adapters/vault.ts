// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// ObsidianVaultAdapter — bridges the @curtis/core VaultLike port to the
// Obsidian vault. Follows the port's documented semantics:
//   - `read` REJECTS when the path is missing or a folder.
//   - `write`/`append` create missing parent folders; reject when a parent
//     exists as a file.
//   - `write` overwrites (last writer wins — callers serialize their own
//     writes, e.g. the memory store's persist chain).
//   - `exists` is true for files AND folders.
//   - `list` is shallow; a missing folder resolves to [].
//
// Paths arrive vault-relative and '/'-separated (the package normalizes
// on the way in); we re-normalize defensively so hand-built paths from
// older callers can't slip a leading slash or backslash through.

import { TFile, TFolder, type App } from 'obsidian';
import { normalizeVaultPath, type VaultEntry, type VaultLike } from '@curtis/core';

export class ObsidianVaultAdapter implements VaultLike {
	constructor(private readonly app: App) {}

	async read(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(normalizeVaultPath(path));
		if (!(file instanceof TFile)) {
			throw new Error(`Curtis: file not found: ${path}`);
		}
		return this.app.vault.read(file);
	}

	async write(path: string, data: string): Promise<void> {
		const clean = normalizeVaultPath(path);
		await this.ensureParent(clean);
		const existing = this.app.vault.getAbstractFileByPath(clean);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, data);
		} else if (existing) {
			throw new Error(`Curtis: cannot write — a folder exists at: ${clean}`);
		} else {
			await this.app.vault.create(clean, data);
		}
	}

	async append(path: string, data: string): Promise<void> {
		const clean = normalizeVaultPath(path);
		await this.ensureParent(clean);
		const existing = this.app.vault.getAbstractFileByPath(clean);
		if (existing instanceof TFile) {
			await this.app.vault.append(existing, data);
		} else if (existing) {
			throw new Error(`Curtis: cannot append — a folder exists at: ${clean}`);
		} else {
			await this.app.vault.create(clean, data);
		}
	}

	async exists(path: string): Promise<boolean> {
		return this.app.vault.getAbstractFileByPath(normalizeVaultPath(path)) != null;
	}

	async list(dir: string): Promise<VaultEntry[]> {
		const clean = normalizeVaultPath(dir);
		const node = clean === '' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(clean);
		if (!(node instanceof TFolder)) return []; // missing == empty, never throws
		return node.children.map((child): VaultEntry => ({
			path: child.path,
			name: child.name,
			type: child instanceof TFile ? 'file' : 'folder',
			mtime: child instanceof TFile ? child.stat.mtime : 0,
		}));
	}

	/** Create every missing segment of the path's parent folder chain. */
	private async ensureParent(path: string): Promise<void> {
		const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		if (!parent) return;
		const parts = parent.split('/').filter(Boolean);
		let acc = '';
		for (const p of parts) {
			acc = acc ? `${acc}/${p}` : p;
			const existing = this.app.vault.getAbstractFileByPath(acc);
			if (existing) {
				if (!(existing instanceof TFolder)) {
					throw new Error(`Curtis: parent exists as a file: ${acc}`);
				}
				continue;
			}
			try {
				await this.app.vault.createFolder(acc);
			} catch {
				/* already exists (race), ignore */
			}
		}
	}
}
