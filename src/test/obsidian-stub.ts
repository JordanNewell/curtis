// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Test-only stub for the `obsidian` module, aliased by vitest.config.ts
// (the real package is types-only — its main entry does not resolve, so
// any test importing adapter code that reaches for 'obsidian' needs this).
//
// TFile/TFolder are REAL classes (not dummies): the vault adapter pins its
// behavior on `instanceof`, so the stub classes must be the single shared
// identity between the adapter and the tests. requestUrl is router-driven
// like scripts/obsidian-stub-models.ts, plus throw-through so tests can
// simulate network failures.

/** Stand-in for the Obsidian App type — tests cast fakes into it. */
export type App = Record<string, unknown>;

export class TFile {
	stat: { mtime: number };
	extension: string;
	constructor(public path: string, mtime = 0) {
		this.stat = { mtime };
		this.extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : '';
	}
	get name(): string {
		return this.path.split('/').pop() ?? this.path;
	}
}

export class TFolder {
	children: Array<TFile | TFolder> = [];
	constructor(public path: string) {}
	get name(): string {
		return this.path.split('/').pop() ?? this.path;
	}
}

export interface StubRequest {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
	throw?: boolean;
}

export interface StubResponse {
	status: number;
	text?: string;
	json?: unknown;
	arrayBuffer?: ArrayBuffer;
}

export type StubRouter = (req: StubRequest) => StubResponse | Promise<StubResponse>;

/** Requests as the adapter sent them, for forwarding assertions. */
export const requestsSeen: StubRequest[] = [];

let router: StubRouter = () => ({ status: 404, text: '' });

export function __setRequestRouter(r: StubRouter): void {
	router = r;
}

export async function requestUrl(req: StubRequest): Promise<StubResponse> {
	requestsSeen.push({ ...req, headers: { ...(req.headers || {}) } });
	return router(req); // a rejecting router simulates a network failure
}

// The adapter import graphs name a few other obsidian exports; none execute
// under vitest — dummies exist purely so imports resolve.
export class Notice {
	constructor(public message: string) {}
}
export const Platform = { isDesktop: true, isMobile: false, isMobileApp: false };
export default {};
