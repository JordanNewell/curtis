// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// SecretStore adapter over Obsidian's app.secretStorage (OS keychain).
//
// get/set/delete follow the @curtis/core SecretStore port. Obsidian's
// SecretStorage has no deleteSecret, so `delete` is an empty overwrite —
// the strongest removal the API offers (same idiom core/secrets.ts uses).

import type { App } from 'obsidian';
import type { SecretStore } from '@curtis/core';
import { getSecretStorage } from '../core/secrets';

export class ObsidianSecretStore implements SecretStore {
	constructor(private readonly app: App) {}

	async get(key: string): Promise<string | null> {
		return getSecretStorage(this.app)?.getSecret(key) ?? null;
	}

	async set(key: string, value: string): Promise<void> {
		getSecretStorage(this.app)?.setSecret(key, value);
	}

	async delete(key: string): Promise<void> {
		// secretStorage has no deleteSecret — an empty overwrite is the
		// strongest removal the API offers.
		try {
			getSecretStorage(this.app)?.setSecret(key, '');
		} catch {
			// Never set — fine.
		}
	}
}
