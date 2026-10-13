// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// SecretStore adapter over Obsidian's app.secretStorage (OS keychain).
//
// get/set/delete follow the @curtis/core SecretStore port. Obsidian's
// SecretStorage has no deleteSecret, so `delete` is an empty overwrite —
// the strongest removal the API offers (same idiom core/secrets.ts uses).
// get() normalizes '' back to null so the port's "absent after delete"
// contract holds even though the key physically remains in the keychain.

import type { App } from 'obsidian';
import type { SecretStore } from '@curtis/core';
import { getSecretStorage } from '../core/secrets';

export class ObsidianSecretStore implements SecretStore {
	constructor(private readonly app: App) {}

	async get(key: string): Promise<string | null> {
		const value = getSecretStorage(this.app)?.getSecret(key) ?? null;
		return value === '' ? null : value;
	}

	async set(key: string, value: string): Promise<void> {
		getSecretStorage(this.app)?.setSecret(key, value);
	}

	async delete(key: string): Promise<void> {
		// LIMITATION: Obsidian's SecretStorage has no deleteSecret, so the
		// secret is overwritten with '' rather than removed — the key stays
		// in the keychain with an empty value. get() maps '' back to null so
		// port consumers see "absent"; anything reading the keychain outside
		// this adapter must treat '' as absent too.
		try {
			getSecretStorage(this.app)?.setSecret(key, '');
		} catch {
			// Never set — fine.
		}
	}
}
