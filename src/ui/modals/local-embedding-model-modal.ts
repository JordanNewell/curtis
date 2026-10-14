// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Local Embedding Model Modal — curated on-device models plus a live
// Hugging Face search for anything else.
//
// Curated entries carry their run spec (pooling, e5 prefixes) in
// model-catalog.ts; hub-search results are unvetted — the resolver guesses
// the family from the repo name, and the UI says so.

import { App, Modal, Platform, Setting, requestUrl } from 'obsidian';
import {
	CURATED_LOCAL_MODELS,
	MOBILE_HEAVY_PARAMS_M,
	resolveLocalModelSpec,
} from '../../rag/model-catalog';

interface HubModel {
	id: string;
	downloads?: number;
	likes?: number;
	tags?: string[];
}

function formatCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${Math.round(n / 1000)}K`;
	return String(n);
}

export class LocalEmbeddingModelModal extends Modal {
	private current: string;
	private onPick: (repoId: string) => void;
	private resultsEl: HTMLElement | null = null;
	private searchTimer: number | null = null;

	constructor(app: App, current: string, onPick: (repoId: string) => void) {
		super(app);
		this.modalEl.addClass('curtis-modal');
		this.current = current;
		this.onPick = onPick;
		this.modalEl.addClass('curtis-local-model-modal');
	}

	onOpen(): void {
		this.titleEl.setText('On-device embedding model');
		const content = this.contentEl;
		content.empty();

		content.createDiv({
			cls: 'ai-setting-hint',
			text: 'Runs entirely on this device. Weights download once from Hugging Face and are cached. Changing the model requires an index rebuild.',
		});

		for (const m of CURATED_LOCAL_MODELS) {
			const row = content.createDiv({
				cls: `curtis-local-model-row${m.id === this.current ? ' is-active' : ''}`,
			});
			row.addEventListener('click', () => this.choose(m.id));
			const head = row.createDiv({ cls: 'curtis-local-model-name' });
			head.createSpan({ text: m.label });
			if (m.id === this.current) {
				head.createSpan({ cls: 'curtis-local-model-active', text: ' — current' });
			}
			row.createDiv({
				cls: 'ai-setting-hint',
				text: `${m.dims}-dim · ${m.paramsM}M params · ${m.languages}`,
			});
			row.createDiv({ cls: 'ai-setting-hint', text: m.note });
			if (Platform.isMobile && m.paramsM > MOBILE_HEAVY_PARAMS_M) {
				row.createDiv({
					cls: 'ai-setting-hint curtis-local-model-warn',
					text: 'Heavy on mobile — larger download and slower queries.',
				});
			}
		}

		new Setting(content)
			.setName('Search the model hub')
			.setDesc('Any feature-extraction repo with transformers.js weights. Unvetted — pooling is inferred from the model family.');
		const searchSetting = new Setting(content);
		searchSetting.addText((text) => {
			text.setPlaceholder('Multilingual, minilm, jina…');
			text.onChange((val) => this.scheduleSearch(val));
		});
		this.resultsEl = content.createDiv({ cls: 'curtis-local-model-results' });
	}

	onClose(): void {
		if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
	}

	private scheduleSearch(query: string): void {
		if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
		this.searchTimer = window.setTimeout(() => {
			this.searchTimer = null;
			void this.search(query);
		}, 400);
	}

	private async search(query: string): Promise<void> {
		const el = this.resultsEl;
		if (!el) return;
		const q = query.trim();
		if (!q) {
			el.empty();
			return;
		}
		el.empty();
		el.createDiv({ cls: 'ai-setting-hint', text: 'Searching…' });
		try {
			const url =
				`https://huggingface.co/api/models?search=${encodeURIComponent(q)}` +
				'&pipeline_tag=feature-extraction&sort=downloads&direction=-1&limit=20';
			const res = await requestUrl({ url });
			const models = (res.json as HubModel[]).filter((m) =>
				(m.tags ?? []).includes('transformers.js')
			);
			el.empty();
			if (models.length === 0) {
				el.createDiv({
					cls: 'ai-setting-hint',
					text: 'No transformers.js-compatible results — the model needs ONNX weights and a tokenizer.',
				});
				return;
			}
			for (const m of models.slice(0, 8)) {
				const row = el.createDiv({
					cls: `curtis-local-model-row${m.id === this.current ? ' is-active' : ''}`,
				});
				row.addEventListener('click', () => this.choose(m.id));
				row.createDiv({ cls: 'curtis-local-model-name', text: m.id });
				const downloads = m.downloads ? `${formatCount(m.downloads)} downloads · ` : '';
				const spec = resolveLocalModelSpec(m.id);
				row.createDiv({
					cls: 'ai-setting-hint',
					text: `${downloads}unvetted · ${spec.pooling} pooling (inferred)`,
				});
			}
		} catch (e) {
			el.empty();
			el.createDiv({
				cls: 'ai-setting-hint',
				text: `Search failed — ${(e as Error).message}. You can still type the repo id into the model field directly.`,
			});
		}
	}

	private choose(repoId: string): void {
		this.onPick(repoId);
		this.close();
	}
}
