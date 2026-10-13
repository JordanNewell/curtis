// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// ObsidianSecretStore tests — pins the port contract around the delete
// limitation: Obsidian has no deleteSecret, so delete() is an empty
// overwrite and get() must normalize '' back to null ("absent").

import { describe, expect, it } from 'vitest';
import { ObsidianSecretStore } from './secret-store';

// A SecretStorage look-alike; getSecretStorage() accepts it because it has
// the getSecret/setSecret functions it duck-types on.
const storage = {
	values: new Map<string, string>(),
	getSecret: (key: string): string | null => storage.values.get(key) ?? null,
	setSecret: (key: string, value: string): void => {
		storage.values.set(key, value);
	},
};

const store = new ObsidianSecretStore({ secretStorage: storage } as never);

describe('ObsidianSecretStore', () => {
	it('round-trips set then get', async () => {
		storage.values.clear();
		await store.set('openai', 'sk-test');
		await expect(store.get('openai')).resolves.toBe('sk-test');
	});

	it('returns null for a never-set key', async () => {
		storage.values.clear();
		await expect(store.get('ghost')).resolves.toBeNull();
	});

	it('delete overwrites with "" and get reports null (port contract)', async () => {
		storage.values.clear();
		await store.set('openai', 'sk-test');
		await store.delete('openai');
		expect(storage.values.get('openai')).toBe(''); // physically empty, not removed
		await expect(store.get('openai')).resolves.toBeNull(); // semantically absent
	});

	it('set after delete revives the key with a real value', async () => {
		storage.values.clear();
		await store.set('k', 'v1');
		await store.delete('k');
		await store.set('k', 'v2');
		await expect(store.get('k')).resolves.toBe('v2');
	});
});
