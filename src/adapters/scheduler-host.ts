// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// SchedulerHost adapter for @curtisai/core's SchedulerService. Everything the
// old in-tree scheduler reached through `plugin.*` is a member here.

import { Notice } from 'obsidian';
import type { ScheduledJob } from '@curtisai/shared';
import type { RunNoteRequest, SchedulerHost, ScheduledRunEvent } from '@curtisai/core';
import type CurtisPlugin from '../main';
import { createNote } from '../vault/notes';

export class PluginSchedulerHost implements SchedulerHost {
	notify: (msg: string) => void;

	constructor(private readonly plugin: CurtisPlugin) {
		this.notify = (msg) => new Notice(msg);
	}

	/** Live view of the persisted jobs — the same array the settings UI
	 *  edits, so lastFiredAt bookkeeping lands in saved settings. */
	getJobs(): ScheduledJob[] {
		return this.plugin.settings.scheduledJobs;
	}

	async run(agentName: string | undefined, prompt: string, signal: AbortSignal): Promise<string> {
		if (!this.plugin.api) throw new Error('Curtis API unavailable');
		return agentName
			? await this.plugin.api.runAgent(agentName, prompt, { signal })
			: await this.plugin.api.chat(prompt, { signal });
	}

	persist(): void | Promise<void> {
		return this.plugin.saveSettings();
	}

	/** Write one markdown note; resolves its vault path or null. */
	async writeRunNote(req: RunNoteRequest): Promise<string | null> {
		const folder = this.plugin.settings.scheduledOutputFolder.trim() || 'AI/Scheduled';
		const file = await createNote(this.plugin.app, folder, req.basename, req.body, {
			frontmatter: req.frontmatter,
		});
		return file?.path ?? null;
	}

	/** Outbound event (audit receipt + optional webhook) — fire-and-forget. */
	onRunFinished(event: ScheduledRunEvent): void {
		this.plugin.webhooks.scheduledRunFinished(event);
	}
}
