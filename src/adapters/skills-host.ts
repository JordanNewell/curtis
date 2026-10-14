// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// SkillsHost adapter for @curtisai/core's SkillManager. Getter closures read
// the plugin's LIVE settings so a settings edit takes effect on the next
// access without a reload.

import { Notice, parseYaml } from 'obsidian';
import type { SkillsHost, VaultLike } from '@curtisai/core';
import type { SkillOverride } from '@curtisai/shared';
import type CurtisPlugin from '../main';

export class PluginSkillsHost implements SkillsHost {
	vault: VaultLike;
	notify?: (msg: string) => void;

	constructor(
		private readonly plugin: CurtisPlugin,
		vault: VaultLike
	) {
		this.vault = vault;
		this.notify = (msg) => new Notice(msg);
	}

	yamlParse(text: string): unknown {
		return parseYaml(text);
	}

	skillsEnabled(): boolean {
		return this.plugin.settings.skillsEnabled;
	}

	skillsFolder(): string {
		return this.plugin.settings.skillsFolder || 'AI/Skills';
	}

	skillOverrides(): Record<string, SkillOverride> {
		return this.plugin.settings.skillOverrides;
	}

	openInWorkspace(path: string): void | Promise<void> {
		void this.plugin.app.workspace.openLinkText(path, '', false);
	}
}
