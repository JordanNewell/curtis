// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// TTS backends — the playback seam behind the sentence player.
//
// TTSController owns sentence sequencing and state; a backend speaks one
// sentence chunk at a time and knows nothing about ordering. Native wraps
// the Web Speech API; the neural engine (OpenAI /v1/audio/speech) implements
// the same interface over Audio elements, prefetching the next sentence so
// per-chunk network latency hides behind the current playback.
//
// The seam also keeps the controller Obsidian-free and unit-testable: tests
// drive a fake backend instead of window.speechSynthesis.

import { isSpeechSupported, pickSpeechVoice } from './voice';

export interface SpeakChunkOptions {
	rate: number;
	pitch: number;
	/** The next sentence when the player knows it — lets network backends
	 *  prefetch while the current chunk plays. */
	next?: string;
	/** Fired when the chunk finished playing. */
	onEnd: () => void;
	/** Fired when the chunk failed to play. */
	onError: () => void;
}

export interface TTSBackend {
	/** Speak one sentence chunk. Backends cancel any in-flight speech
	 *  first, so rapid skips never pile up queued audio. */
	speak(chunk: string, opts: SpeakChunkOptions): void;
	cancel(): void;
	pause(): void;
	resume(): void;
}

/** System voices via the Web Speech API (window.speechSynthesis). */
export class NativeSpeechBackend implements TTSBackend {
	private voiceResolved = false;
	private voice: SpeechSynthesisVoice | null = null;
	// Bound + stored so a future dispose path could removeEventListener this
	// exact reference — the backend interface has no dispose lifecycle today.
	private readonly onVoicesChanged = (): void => {
		this.voiceResolved = false;
	};

	constructor(private voiceUri: string) {
		// Voices load asynchronously in many windows (getVoices() returns []
		// until voiceschanged fires) — resolve lazily instead of caching once,
		// and re-resolve when the voice list arrives. addEventListener (not the
		// onvoiceschanged property) so sibling backends don't overwrite each
		// other's handler.
		if (isSpeechSupported()) {
			window.speechSynthesis.addEventListener('voiceschanged', this.onVoicesChanged);
		}
	}

	speak(chunk: string, opts: SpeakChunkOptions): void {
		// Cancel anything still queued so rapid skips don't pile up.
		window.speechSynthesis.cancel();

		const utterance = new SpeechSynthesisUtterance(chunk);
		utterance.rate = opts.rate;
		utterance.pitch = opts.pitch;
		utterance.volume = 1;
		const voice = this.pickVoice();
		if (voice) utterance.voice = voice;
		utterance.onend = opts.onEnd;
		utterance.onerror = opts.onError;
		window.speechSynthesis.speak(utterance);
	}

	cancel(): void {
		if (isSpeechSupported()) window.speechSynthesis.cancel();
	}

	pause(): void {
		if (isSpeechSupported()) window.speechSynthesis.pause();
	}

	resume(): void {
		if (isSpeechSupported()) window.speechSynthesis.resume();
	}

	private pickVoice(): SpeechSynthesisVoice | null {
		if (!this.voiceResolved) {
			this.voiceResolved = true;
			this.voice = pickSpeechVoice(this.voiceUri);
		}
		return this.voice;
	}
}

/** LRU of blob object URLs, keyed model|voice|sentence. Evicted entries are
 *  revoked unless pinned — the entry currently playing must never be yanked
 *  out from under its Audio element. */
export class ObjectUrlLru {
	private map = new Map<string, string>();
	private pinnedKey: string | null = null;

	constructor(readonly capacity = 20) {}

	has(key: string): boolean {
		return this.map.has(key);
	}

	get(key: string): string | undefined {
		const url = this.map.get(key);
		if (url !== undefined) {
			// Refresh recency on access.
			this.map.delete(key);
			this.map.set(key, url);
		}
		return url;
	}

	set(key: string, url: string): void {
		if (this.map.has(key)) this.map.delete(key);
		this.map.set(key, url);
		while (this.map.size > this.capacity) {
			// Evict the oldest non-pinned entry; if everything is pinned
			// (capacity 1 + pin), tolerate the overflow rather than yank
			// the playing clip.
			let evictKey: string | undefined;
			for (const k of this.map.keys()) {
				if (k !== this.pinnedKey) {
					evictKey = k;
					break;
				}
			}
			if (evictKey === undefined) break;
			const evicted = this.map.get(evictKey);
			this.map.delete(evictKey);
			if (evicted) URL.revokeObjectURL(evicted);
		}
	}

	/** Protect one key from eviction (the sentence now playing). */
	pin(key: string): void {
		this.pinnedKey = key;
	}

	clear(): void {
		for (const url of this.map.values()) URL.revokeObjectURL(url);
		this.map.clear();
	}
}

/** The audio surface the backend drives — narrow enough that tests can fake
 *  it without a DOM. Handlers take the DOM event shape so HTMLAudioElement
 *  itself satisfies the interface. */
export interface PlayableAudio {
	playbackRate: number;
	onended: ((ev: Event) => void) | null;
	onerror: ((ev: Event) => void) | null;
	play(): Promise<void>;
	pause(): void;
}

/** The OpenAI neural voices offered in settings. */
export const OPENAI_TTS_VOICES = [
	'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer',
] as const;

export interface OpenAiSpeechBackendOptions {
	/** Bearer header value ('Bearer …'), resolved lazily per request so a
	 *  key added mid-session is picked up without rebuilding the backend. */
	bearer: () => string | null;
	voice: string;
	model: string;
	/** Optional style steering — the `instructions` param on steerable
	 *  neural models. */
	style?: string;
	/** Fired once, when a request fails and the backend degrades to the
	 *  system voice for the rest of its life. */
	onDegraded?: (reason: string) => void;
	/** Test seams — the production defaults hit window.fetch and Audio. */
	fetchImpl?: (url: string, init: {
		method: string;
		headers: Record<string, string>;
		body: string;
		signal: AbortSignal;
	}) => Promise<{ ok: boolean; status: number; blob(): Promise<Blob> }>;
	createAudio?: (src: string) => PlayableAudio;
}

/** Neural speech via OpenAI /v1/audio/speech: one request per sentence, mp3
 *  blobs cached as object URLs (LRU ~20 clips, so skip-back replays
 *  instantly), the next sentence prefetched while the current one plays.
 *  Any request or playback failure degrades to the system voice for the
 *  session — the player never dies on a network hiccup. */
export class OpenAiSpeechBackend implements TTSBackend {
	private seq = 0;
	private current: PlayableAudio | null = null;
	private fetchAbort: AbortController | null = null;
	private pending = new Map<string, Promise<string>>();
	private cache = new ObjectUrlLru(20);
	private degraded = false;
	private nativeFallback: NativeSpeechBackend | null = null;
	private readonly fetchImpl: NonNullable<OpenAiSpeechBackendOptions['fetchImpl']>;
	private readonly createAudio: (src: string) => PlayableAudio;

	constructor(private opts: OpenAiSpeechBackendOptions) {
		this.fetchImpl = opts.fetchImpl ?? ((url, init) => window.fetch(url, init));
		this.createAudio = opts.createAudio ?? ((src) => new Audio(src));
	}

	speak(chunk: string, opts: SpeakChunkOptions): void {
		if (!chunk.trim()) {
			opts.onEnd();
			return;
		}
		if (this.degraded) {
			this.speakNative(chunk, opts);
			return;
		}
		this.stopCurrent();
		const gen = ++this.seq;
		const key = this.cacheKey(chunk);
		if (!this.fetchAbort) this.fetchAbort = new AbortController();
		this.loadClip(key, chunk, this.fetchAbort.signal)
			.then((url) => {
				// A newer speak()/cancel() superseded this request.
				if (gen !== this.seq) return;
				this.playUrl(key, url, chunk, opts, gen);
			})
			.catch((err) => {
				if (gen !== this.seq || isAbort(err)) return;
				this.degrade(`speech request failed: ${String(err)}`, chunk, opts, gen);
			});
		this.prefetch(opts.next);
	}

	cancel(): void {
		this.seq++;
		this.fetchAbort?.abort();
		this.fetchAbort = null;
		this.stopCurrent();
	}

	pause(): void {
		if (this.degraded) {
			this.nativeFallback?.pause();
			return;
		}
		this.current?.pause();
	}

	resume(): void {
		if (this.degraded) {
			this.nativeFallback?.resume();
			return;
		}
		if (this.current) void this.current.play().catch(() => undefined);
	}

	private cacheKey(chunk: string): string {
		return `${this.opts.model}|${this.opts.voice}|${chunk}`;
	}

	/** Fetch (or join an in-flight fetch for) a clip and cache its URL. */
	private loadClip(key: string, chunk: string, signal: AbortSignal): Promise<string> {
		const cached = this.cache.get(key);
		if (cached) return Promise.resolve(cached);
		const inFlight = this.pending.get(key);
		if (inFlight) return inFlight;

		const bearer = this.opts.bearer();
		if (!bearer) return Promise.reject(new Error('no OpenAI API key configured'));

		const body: Record<string, unknown> = {
			model: this.opts.model,
			voice: this.opts.voice,
			input: chunk,
			response_format: 'mp3',
		};
		if (this.opts.style?.trim()) body.instructions = this.opts.style.trim();

		const p = this.fetchImpl('https://api.openai.com/v1/audio/speech', {
			method: 'POST',
			headers: { Authorization: bearer, 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal,
		})
			.then(async (res) => {
				if (!res.ok) throw new Error(`TTS API error ${res.status}`);
				const url = URL.createObjectURL(await res.blob());
				this.cache.set(key, url);
				return url;
			})
			.finally(() => {
				this.pending.delete(key);
			});
		this.pending.set(key, p);
		return p;
	}

	/** Warm the cache for the next sentence while the current one plays. */
	private prefetch(next: string | undefined): void {
		if (this.degraded || !next?.trim()) return;
		const key = this.cacheKey(next);
		if (this.cache.has(key) || this.pending.has(key)) return;
		if (!this.fetchAbort) this.fetchAbort = new AbortController();
		void this.loadClip(key, next, this.fetchAbort.signal).catch(() => undefined);
	}

	private playUrl(key: string, url: string, chunk: string, opts: SpeakChunkOptions, gen: number): void {
		const audio = this.createAudio(url);
		audio.playbackRate = opts.rate;
		audio.onended = () => {
			if (gen !== this.seq) return;
			this.current = null;
			opts.onEnd();
		};
		audio.onerror = () => {
			if (gen !== this.seq) return;
			this.degrade('audio playback failed', chunk, opts, gen);
		};
		this.current = audio;
		this.cache.pin(key);
		void audio.play().catch(() => {
			if (gen === this.seq) this.degrade('playback was blocked', chunk, opts, gen);
		});
	}

	/** Stop the current clip without revoking its URL — the cache keeps it
	 *  so an immediate skip-back replays instantly. */
	private stopCurrent(): void {
		const audio = this.current;
		if (!audio) return;
		audio.onended = null;
		audio.onerror = null;
		audio.pause();
		this.current = null;
	}

	private degrade(reason: string, chunk: string, opts: SpeakChunkOptions, gen: number): void {
		if (gen !== this.seq) return;
		if (!this.degraded) {
			this.degraded = true;
			this.cache.clear();
			this.pending.clear();
			this.opts.onDegraded?.(reason);
		}
		this.speakNative(chunk, opts);
	}

	/** System-voice fallback — used after degradation (and when degradation
	 *  itself finds no speechSynthesis, the honest exit is onError). */
	private speakNative(chunk: string, opts: SpeakChunkOptions): void {
		if (!isSpeechSupported()) {
			opts.onError();
			return;
		}
		if (!this.nativeFallback) this.nativeFallback = new NativeSpeechBackend('');
		this.nativeFallback.speak(chunk, opts);
	}
}

function isAbort(err: unknown): boolean {
	return (err as { name?: string } | null | undefined)?.name === 'AbortError';
}
