// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// ObsidianVaultAdapter tests — in-memory fake vault over the shared obsidian
// test stub (vitest.config.ts aliases 'obsidian' to it), so the adapter's
// real instanceof type-guards run against the same TFile/TFolder classes.

import { describe, expect, it } from 'vitest';
// TFile/TFolder/App come from the stub (vitest aliases 'obsidian' to the
// same module — one shared class identity with the adapter at runtime, and
// coherent types here).
import { TFile, TFolder } from '../test/obsidian-stub';
import { ObsidianVaultAdapter } from './vault';

/** Non-throwing alternatives to blind casts (lint: no-tfile-tfolder-cast). */
function must<T>(value: T | undefined): T {
	if (!value) throw new Error('missing fixture node');
	return value;
}
function mustFolder(value: TFile | TFolder | undefined): TFolder {
	if (!(value instanceof TFolder)) throw new Error('fixture node is not a folder');
	return value;
}

/** Fake vault state shared by the app mock: path → node, path → content. */
const files = new Map<string, TFile | TFolder>();
const contents = new Map<string, string>();

const makeApp = () => ({
	vault: {
		getAbstractFileByPath: (p: string) => files.get(p) ?? null,
		read: async (f: TFile) => contents.get(f.path) ?? '',
		modify: async (f: TFile, data: string) => {
			contents.set(f.path, data);
		},
		append: async (f: TFile, data: string) => {
			contents.set(f.path, (contents.get(f.path) ?? '') + data);
		},
		create: async (path: string, data: string) => {
			const f = new TFile(path);
			files.set(path, f);
			contents.set(path, data);
			return f;
		},
		createFolder: async (path: string) => {
			files.set(path, new TFolder(path));
		},
		getRoot: () => must(files.get('/')),
	},
});

const reset = (): void => {
	files.clear();
	contents.clear();
	files.set('/', new TFolder('/'));
};

const adapterOf = (): ObsidianVaultAdapter =>
	new ObsidianVaultAdapter(makeApp() as unknown as ConstructorParameters<typeof ObsidianVaultAdapter>[0]);

describe('ObsidianVaultAdapter.read', () => {
	it('returns file content', async () => {
		reset();
		const f = new TFile('notes/a.md');
		files.set('notes/a.md', f);
		files.set('notes', new TFolder('notes'));
		contents.set('notes/a.md', 'hello');
		await expect(adapterOf().read('notes/a.md')).resolves.toBe('hello');
	});

	it('rejects on a missing path', async () => {
		reset();
		await expect(adapterOf().read('nope.md')).rejects.toThrow(/not found/);
	});

	it('rejects when the path is a folder', async () => {
		reset();
		files.set('folder', new TFolder('folder'));
		await expect(adapterOf().read('folder')).rejects.toThrow(/not found/);
	});
});

describe('ObsidianVaultAdapter.write', () => {
	it('creates the full missing parent folder chain', async () => {
		reset();
		await adapterOf().write('AI/deep/nest/mem.md', 'body');
		expect(files.get('AI')).toBeInstanceOf(TFolder);
		expect(files.get('AI/deep')).toBeInstanceOf(TFolder);
		expect(files.get('AI/deep/nest')).toBeInstanceOf(TFolder);
		expect(files.get('AI/deep/nest/mem.md')).toBeInstanceOf(TFile);
		expect(contents.get('AI/deep/nest/mem.md')).toBe('body');
	});

	it('overwrites an existing file in place (modify, not create)', async () => {
		reset();
		const f = new TFile('mem.md');
		files.set('mem.md', f);
		contents.set('mem.md', 'old');
		await adapterOf().write('mem.md', 'new');
		expect(contents.get('mem.md')).toBe('new');
		expect(files.get('mem.md')).toBe(f); // same node — modify semantics
	});

	it('rejects when a parent exists as a file', async () => {
		reset();
		files.set('AI', new TFile('AI'));
		await expect(adapterOf().write('AI/mem.md', 'x')).rejects.toThrow(/parent exists as a file/);
	});

	it('rejects when a folder exists at the target path', async () => {
		reset();
		files.set('AI', new TFolder('AI'));
		await expect(adapterOf().write('AI', 'x')).rejects.toThrow(/folder exists/);
	});
});

describe('ObsidianVaultAdapter.append', () => {
	it('creates the file and parents when missing', async () => {
		reset();
		await adapterOf().append('journal/2026.md', 'day 1\n');
		expect(contents.get('journal/2026.md')).toBe('day 1\n');
	});

	it('appends to an existing file', async () => {
		reset();
		files.set('j.md', new TFile('j.md'));
		contents.set('j.md', 'a');
		await adapterOf().append('j.md', 'b');
		expect(contents.get('j.md')).toBe('ab');
	});

	it('rejects when the path is a folder', async () => {
		reset();
		files.set('AI', new TFolder('AI'));
		await expect(adapterOf().append('AI', 'x')).rejects.toThrow(/folder exists/);
	});
});

describe('ObsidianVaultAdapter.exists', () => {
	it('is true for files AND folders, false for missing paths', async () => {
		reset();
		files.set('f.md', new TFile('f.md'));
		files.set('dir', new TFolder('dir'));
		const a = adapterOf();
		await expect(a.exists('f.md')).resolves.toBe(true);
		await expect(a.exists('dir')).resolves.toBe(true);
		await expect(a.exists('missing')).resolves.toBe(false);
	});
});

describe('ObsidianVaultAdapter.list', () => {
	it('resolves a missing folder to []', async () => {
		reset();
		await expect(adapterOf().list('ghost/dir')).resolves.toEqual([]);
	});

	it('lists shallow children with type and mtime', async () => {
		reset();
		const dir = new TFolder('AI');
		dir.children = [new TFile('AI/mem.md', 1234), new TFolder('AI/sub')];
		files.set('AI', dir);
		files.set('AI/mem.md', dir.children[0]);
		files.set('AI/sub', dir.children[1]);
		const entries = await adapterOf().list('AI');
		expect(entries).toEqual([
			{ path: 'AI/mem.md', name: 'mem.md', type: 'file', mtime: 1234 },
			{ path: 'AI/sub', name: 'sub', type: 'folder', mtime: 0 },
		]);
	});

	it('lists the vault root for "" and "/" (normalizeVaultPath maps both to /)', async () => {
		reset();
		const root = mustFolder(files.get('/'));
		root.children = [new TFile('root.md'), new TFolder('sub')];
		files.set('root.md', root.children[0]);
		files.set('sub', root.children[1]);
		const a = adapterOf();
		const viaEmpty = await a.list('');
		const viaSlash = await a.list('/');
		for (const entries of [viaEmpty, viaSlash]) {
			expect(entries.map((e) => e.name).sort()).toEqual(['root.md', 'sub']);
			expect(entries.every((e) => e.path === e.name)).toBe(true);
		}
	});
});
