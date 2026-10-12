// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Unit tests for the TTS backend layer: the object-URL LRU behind the
// neural engine, the OpenAI speech backend's fetch/cache/prefetch/degrade
// behavior (fetch + Audio injected, no DOM), and the transcription URL
// helpers. tts-backends is Obsidian-free — window is stubbed to {} so the
// degrade path takes its honest no-speechSynthesis exit.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ObjectUrlLru, OpenAiSpeechBackend } from './tts-backends';
import type { PlayableAudio } from './tts-backends';
import { audioTranscriptionUrl, effectiveSttBaseUrl, GROQ_STT_BASE_URL, GROQ_STT_MODEL } from './voice';

beforeAll(() => {
	// No speechSynthesis anywhere in this file — degradation must onError,
	// never touch the synth.
	vi.stubGlobal('window', {});
});

describe('ObjectUrlLru', () => {
	it('evicts and revokes the least-recently-used entry beyond capacity', () => {
		const revoked: string[] = [];
		(URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u: string) => revoked.push(u);
		const lru = new ObjectUrlLru(2);
		lru.set('a', 'blob:a');
		lru.set('b', 'blob:b');
		lru.set('c', 'blob:c');
		expect(lru.has('a')).toBe(false);
		expect(revoked).toEqual(['blob:a']);
		expect(lru.get('b')).toBe('blob:b');
		expect(lru.get('c')).toBe('blob:c');
	});

	it('access refreshes recency', () => {
		const revoked: string[] = [];
		(URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u: string) => revoked.push(u);
		const lru = new ObjectUrlLru(2);
		lru.set('a', 'blob:a');
		lru.set('b', 'blob:b');
		lru.get('a'); // a is now most recent
		lru.set('c', 'blob:c'); // b evicted, not a
		expect(lru.has('a')).toBe(true);
		expect(lru.has('b')).toBe(false);
		expect(revoked).toEqual(['blob:b']);
	});

	it('never evicts the pinned entry', () => {
		const revoked: string[] = [];
		(URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u: string) => revoked.push(u);
		const lru = new ObjectUrlLru(2);
		lru.set('a', 'blob:a');
		lru.set('b', 'blob:b');
		lru.pin('a');
		lru.set('c', 'blob:c'); // would evict a; pinned → b goes instead
		expect(lru.has('a')).toBe(true);
		expect(revoked).toEqual(['blob:b']);
	});
});

describe('audioTranscriptionUrl', () => {
	it('defaults to OpenAI', () => {
		expect(audioTranscriptionUrl('')).toBe('https://api.openai.com/v1/audio/transcriptions');
		expect(audioTranscriptionUrl('   ')).toBe('https://api.openai.com/v1/audio/transcriptions');
	});

	it('accepts hosts that already end in /v1', () => {
		expect(audioTranscriptionUrl(GROQ_STT_BASE_URL)).toBe(`${GROQ_STT_BASE_URL}/audio/transcriptions`);
	});

	it('appends /v1 to hosts without it and trims trailing slashes', () => {
		expect(audioTranscriptionUrl('https://my-host/api/')).toBe('https://my-host/api/v1/audio/transcriptions');
	});
});

describe('effectiveSttBaseUrl', () => {
	it('resolves the three endpoint modes', () => {
		expect(effectiveSttBaseUrl({ sttEndpoint: 'openai', sttBaseUrl: 'whatever' })).toBe('');
		expect(effectiveSttBaseUrl({ sttEndpoint: 'groq', sttBaseUrl: 'whatever' })).toBe(GROQ_STT_BASE_URL);
		expect(effectiveSttBaseUrl({ sttEndpoint: 'custom', sttBaseUrl: 'https://my-host/v1' })).toBe('https://my-host/v1');
	});
});

class FakeAudio implements PlayableAudio {
	src: string;
	playbackRate = 1;
	onended: ((ev: Event) => void) | null = null;
	onerror: ((ev: Event) => void) | null = null;
	played = 0;
	paused = 0;

	constructor(src: string) {
		this.src = src;
	}

	play(): Promise<void> {
		this.played++;
		return Promise.resolve();
	}

	pause(): void {
		this.paused++;
	}

	end(): void {
		this.onended?.(undefined as unknown as Event);
	}

	fail(): void {
		this.onerror?.(undefined as unknown as Event);
	}
}

interface FetchCall {
	url: string;
	auth: string;
	body: Record<string, unknown>;
}

type FetchResult = { ok: boolean; status?: number };

// Drain the promise chains — every fake resolves synchronously, but each
// async stage (.then/.finally/.catch through the backend) costs a couple of
// microtask ticks; 12 covers the deepest chain with headroom (no timers,
// no window).
const flush = async (): Promise<void> => {
	for (let i = 0; i < 12; i++) await Promise.resolve();
};

const setup = (results: FetchResult[] = [{ ok: true }]) => {
	const calls: FetchCall[] = [];
	const audios: FakeAudio[] = [];
	const degradeReasons: string[] = [];
	let nextUrl = 0;
	(URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => `blob:${++nextUrl}`;
	(URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;

	const backend = new OpenAiSpeechBackend({
		bearer: () => 'Bearer test-key',
		voice: 'alloy',
		model: 'gpt-4o-mini-tts',
		style: 'warm narration',
		fetchImpl: (url, init) => {
			calls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) as Record<string, unknown> });
			const r = results[Math.min(calls.length - 1, results.length - 1)];
			return Promise.resolve({
				ok: r.ok,
				status: r.status ?? 200,
				blob: () => Promise.resolve(new Blob(['mp3'])),
			});
		},
		createAudio: (src) => {
			const audio = new FakeAudio(src);
			audios.push(audio);
			return audio;
		},
		onDegraded: (reason) => degradeReasons.push(reason),
	});
	return { backend, calls, audios, degradeReasons };
};

const baseOpts = (over: Partial<{ onEnd: () => void; onError: () => void }> = {}) => ({
	rate: 1.25,
	pitch: 1,
	onEnd: over.onEnd ?? (() => undefined),
	onError: over.onError ?? (() => undefined),
});

describe('OpenAiSpeechBackend', () => {
	it('fetches the clip with auth + body, plays it at the requested rate', async () => {
		const { backend, calls, audios } = setup();
		const ended: string[] = [];
		backend.speak('Hello.', baseOpts({ onEnd: () => ended.push('done') }));
		await flush();
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('https://api.openai.com/v1/audio/speech');
		expect(calls[0].auth).toBe('Bearer test-key');
		expect(calls[0].body).toMatchObject({
			model: 'gpt-4o-mini-tts',
			voice: 'alloy',
			input: 'Hello.',
			response_format: 'mp3',
			instructions: 'warm narration',
		});
		expect(audios).toHaveLength(1);
		expect(audios[0].played).toBe(1);
		expect(audios[0].playbackRate).toBe(1.25);
		expect(ended).toEqual([]);
		audios[0].end();
		expect(ended).toEqual(['done']);
	});

	it('prefetches the next sentence while the current one plays', async () => {
		const { backend, calls, audios } = setup();
		backend.speak('One.', { ...baseOpts(), next: 'Two.' });
		await flush();
		// One fetch for the playing sentence, one for the prefetch.
		expect(calls.map((c) => c.body.input)).toEqual(['One.', 'Two.']);
		expect(audios).toHaveLength(1); // the prefetch is not audible

		audios[0].end();
		backend.speak('Two.', { ...baseOpts(), next: 'Three.' });
		await flush();
		// 'Two.' came from the prefetch cache — only 'Three.' was fetched.
		expect(calls.map((c) => c.body.input)).toEqual(['One.', 'Two.', 'Three.']);
		expect(audios).toHaveLength(2);
	});

	it('replays a cached sentence without a second fetch (skip-back)', async () => {
		const { backend, calls, audios } = setup();
		backend.speak('One.', baseOpts());
		await flush();
		audios[0].end();
		backend.speak('One.', baseOpts());
		await flush();
		expect(calls).toHaveLength(1);
		expect(audios).toHaveLength(2);
	});

	it('degrades on API failure: one reason, honest onError, no further fetches', async () => {
		const { backend, calls, degradeReasons } = setup([{ ok: false, status: 401 }]);
		const errors: number[] = [];
		backend.speak('One.', baseOpts({ onError: () => errors.push(1) }));
		await flush();
		// No speechSynthesis under the stubbed window → the degraded backend
		// cannot rescue the sentence; onError is the honest exit.
		expect(errors).toEqual([1]);
		expect(calls).toHaveLength(1);
		backend.speak('Two.', { ...baseOpts({ onError: () => errors.push(2) }), next: 'Three.' });
		await flush();
		// Degraded: the second speak (and its prefetch) short-circuit — no API.
		expect(calls).toHaveLength(1);
		expect(errors).toEqual([1, 2]);
		expect(degradeReasons).toHaveLength(1);
		expect(degradeReasons[0]).toContain('401');
	});

	it('cancel stops the current clip and silences its handlers', async () => {
		const { backend, audios } = setup();
		let ended = 0;
		backend.speak('One.', baseOpts({ onEnd: () => ended++ }));
		await flush();
		backend.cancel();
		expect(audios[0].paused).toBe(1);
		audios[0].end(); // late event from the cancelled clip
		expect(ended).toBe(0);
	});

	it('empty chunks complete immediately without a request', async () => {
		const { backend, calls } = setup();
		let ended = 0;
		backend.speak('   ', baseOpts({ onEnd: () => ended++ }));
		await flush();
		expect(ended).toBe(1);
		expect(calls).toHaveLength(0);
	});
});

describe('Groq preset constants', () => {
	it('points at the OpenAI-compatible host with its fast model', () => {
		expect(GROQ_STT_BASE_URL).toBe('https://api.groq.com/openai/v1');
		expect(GROQ_STT_MODEL).toBe('whisper-large-v3-turbo');
	});
});
