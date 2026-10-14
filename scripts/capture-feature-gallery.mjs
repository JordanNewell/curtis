// Feature-gallery capture — screenshots + short videos of EVERY feature,
// categorized into assets/feature-gallery/, across themes, desktop + phone.
//
// Boot contract is the same as capture-screenshots.mjs:
// Runs the SMOKE CLONE of Obsidian (C:/tmp/obsidian-smoke/ObsidianSmoke.exe — a
// renamed copy with its own userData dir), so the user's live Obsidian is
// never touched: smokes kill only the ObsidianSmoke.exe process name.
// Two boots: desktop (1680x1050), then
// a phone-emulated pass (390x844 @2x DPR).
//
// Streaming scenes are driven by a local OpenAI-compatible MOCK server
// registered as a custom provider (same trick as smoke-mock.mjs) — real
// transport, real SSE, real agent tool loop, deterministic takes, no keys.
// A scenes queue is staged per take; tool_call scenes answer buffered JSON
// (the agent loop parses tool calls from complete messages only), so those
// steps run with settings.streamResponse=false and reload back after.
//
// Every step writes its files immediately and appends to shots-manifest.json,
// so a crashed run keeps everything completed before it. ONLY=chat,arena
// (substring match on step id/group) re-runs a subset.
//
// Usage:   node scripts/capture-feature-gallery.mjs
// Env:     OBSIDIAN_EXE, ONLY, SKIP, PORT (base debug port, default 9250)

import { spawn, execSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = resolve(ROOT, 'demo-vault');
const PLUGIN_DIR = resolve(VAULT, '.obsidian/plugins/curtis');
const GALLERY = resolve(ROOT, 'assets', 'feature-gallery');
const MANIFEST_PATH = resolve(GALLERY, 'shots-manifest.json');

const OBSIDIAN_EXE =
	process.env.OBSIDIAN_EXE ||
	'C:/tmp/obsidian-smoke/ObsidianSmoke.exe'; // smoke clone — never touches the live app

const PORT = Number(process.env.PORT || 9250);
const MOCK_KEY = 'gallery-mock-key';
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const SKIP = (process.env.SKIP || '').split(',').map((s) => s.trim()).filter(Boolean);
const wantStep = (step) => {
	if (SKIP.some((s) => step.id.includes(s) || step.group === s)) return false;
	if (step.id === 'setup') return true; // the pass always stages its fixtures
	if (ONLY.length === 0) return true;
	return ONLY.some((s) => step.id.includes(s) || step.group === s);
};

// Themes for the matrix (same lineup as theme-audit.mjs — the popular ones).
const THEMES = ['Minimal', 'Things', 'AnuPpuccin', 'Sanctum', 'Tokyo Night', 'Nord', 'Cybertron', 'border', 'Royal Velvet'];
const PHONE_THEMES = ['Minimal', 'Royal Velvet'];

// ---------------------------------------------------------------------------
// Manifest + gallery dirs
// ---------------------------------------------------------------------------

mkdirSync(GALLERY, { recursive: true });
let manifest;
try { manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); } catch { manifest = { runs: [], steps: {} }; }
// No host field — machine hostnames are OPSEC-flagged and add nothing here.
manifest.runs.push({ startedAt: new Date().toISOString() });
const saveManifest = () => writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

// ---------------------------------------------------------------------------
// Minimal PNG encoder (for the image-attachment fixture — a tiny bar chart)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
	const t = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c;
	}
	return t;
})();
const crc32 = (buf) => {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
};
/** painter(x, y) → [r, g, b] */
function makePng(w, h, painter) {
	const raw = Buffer.alloc(h * (1 + w * 3));
	for (let y = 0; y < h; y++) {
		const row = y * (1 + w * 3);
		raw[row] = 0;
		for (let x = 0; x < w; x++) {
			const [r, g, b] = painter(x, y);
			raw.writeUInt8(r, row + 1 + x * 3);
			raw.writeUInt8(g, row + 2 + x * 3);
			raw.writeUInt8(b, row + 3 + x * 3);
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolor
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', deflateSync(raw)),
		pngChunk('IEND', Buffer.alloc(0)),
	]);
}
/** A "token usage" bar chart fixture, 420x240. */
function makeChartPng() {
	const bars = [[36, 210, 90, [91, 133, 240]], [150, 160, 140, [52, 168, 83]], [264, 120, 90, [251, 188, 5]], [378, 200, 30, [234, 67, 53]]];
	return makePng(420, 240, (x, y) => {
		for (const [bx, by, bw, [r, g, b]] of bars) {
			if (x >= bx && x < bx + bw && y >= by) return [r, g, b];
		}
		if (y === 28 && x > 20 && x < 260) return [60, 60, 60];
		if (y === 210 && x > 16 && x < 420) return [200, 200, 200];
		return [248, 249, 251];
	}).toString('base64');
}

// ---------------------------------------------------------------------------
// Mock LLM — local OpenAI-compatible server with a staged scene queue
// ---------------------------------------------------------------------------

const mock = (() => {
	const { createServer } = require('node:http');
	const queue = [];
	const USAGE = { prompt_tokens: 212, completion_tokens: 184, total_tokens: 396 };
	const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
	const chunk = (delta, model, extra = {}) => ({
		id: 'chatcmpl-gallery',
		object: 'chat.completion.chunk',
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [{ index: 0, delta, finish_reason: null }],
		...extra,
	});
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	const server = createServer((req, res) => {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
		let raw = '';
		req.on('data', (c) => { raw += c; });
		req.on('end', async () => {
			if (req.method === 'GET' && req.url === '/v1/models') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					data: [
						{ id: 'mock-pro', context_length: 32768 },
						{ id: 'mock-mini', context_length: 16384 },
						{ id: 'mock-vision', context_length: 16384 },
						{ id: 'mock-reasoner', context_length: 65536 },
					],
				}));
				return;
			}
			if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: { message: `no route ${req.method} ${req.url}` } }));
				return;
			}
			let body = {};
			try { body = JSON.parse(raw); } catch { /* ignore */ }
			const model = body.model ?? 'mock-pro';
			const idx = queue.findIndex((s) => !s.model || s.model === model);
			const scene = idx >= 0 ? queue.splice(idx, 1)[0] : { kind: 'buffered', text: 'Mock reply — no scene was staged for this request.' };

			if (scene.kind === 'tool') {
				// Agent-loop turn: complete message with tool_calls. Staged follow-ups
				// (the post-tool continuation) go to the FRONT of the queue.
				queue.unshift(...(scene.followUps ?? []));
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					id: 'chatcmpl-gallery',
					object: 'chat.completion',
					created: Math.floor(Date.now() / 1000),
					model,
					choices: [{
						index: 0,
						message: {
							role: 'assistant',
							content: scene.content ?? '',
							tool_calls: scene.calls.map((c) => ({
								id: `call_${randomUUID().slice(0, 8)}`,
								type: 'function',
								function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) },
							})),
						},
						finish_reason: 'tool_calls',
					}],
					usage: USAGE,
				}));
				return;
			}

			const chunks = scene.kind === 'sse' ? scene.chunks : [scene.text ?? ''];
			const text = chunks.join('');
			if (body.stream !== true || scene.kind !== 'sse') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					id: 'chatcmpl-gallery',
					object: 'chat.completion',
					created: Math.floor(Date.now() / 1000),
					model,
					choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
					usage: { ...USAGE, completion_tokens: Math.ceil(text.length / 4), total_tokens: 212 + Math.ceil(text.length / 4) },
				}));
				return;
			}
			// Paced SSE — the video-friendly take.
			res.writeHead(200, { 'Content-Type': 'text/event-stream' });
			res.write(sse(chunk({ role: 'assistant', content: '' }, model)));
			await sleep(scene.firstDelayMs ?? 500);
			for (const c of chunks) {
				res.write(sse(chunk({ content: c }, model)));
				await sleep(scene.paceMs ?? 55);
			}
			res.write(sse(chunk({}, model, { choices: [], usage: { ...USAGE, completion_tokens: Math.ceil(text.length / 4) } })));
			res.write('data: [DONE]\n\n');
			res.end();
		});
	});
	const port = Number(process.env.MOCK_PORT || 8971);
	let live = false;
	return {
		stage: (...scenes) => queue.push(...scenes),
		clear: () => { queue.length = 0; },
		queueLen: () => queue.length,
		async start() {
			if (live) return;
			await new Promise((done) => server.listen(port, '127.0.0.1', done));
			live = true;
			console.log(`[gallery] mock LLM on http://127.0.0.1:${port}/v1`);
		},
		endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
		port,
	};
})();

// ---------------------------------------------------------------------------
// Vault bootstrap + settings overlay (data.json backed up / restored)
// ---------------------------------------------------------------------------

const createdFiles = []; // vault paths this run created — deleted in cleanup

function bootstrapVault() {
	mkdirSync(PLUGIN_DIR, { recursive: true });
	for (const f of ['main.js', 'manifest.json', 'styles.css']) {
		cpSync(resolve(ROOT, f), resolve(PLUGIN_DIR, f));
	}
	const obsidianDir = resolve(VAULT, '.obsidian');
	writeFileSync(resolve(obsidianDir, 'community-plugins.json'), JSON.stringify(['curtis']));
	// Stale layouts restore stale windows/popouts — start clean.
	for (const f of ['workspace.json', 'workspace-mobile.json']) {
		rmSync(resolve(obsidianDir, f), { force: true });
	}
	if (!existsSync(resolve(obsidianDir, 'app.json'))) {
		writeFileSync(resolve(obsidianDir, 'app.json'), JSON.stringify({ livePreview: true, readableLineLength: true }));
	}
	// Default dark on every boot — a community theme left in appearance.json
	// (an earlier run's last switch not clearing cssTheme) tints every still.
	writeFileSync(resolve(obsidianDir, 'appearance.json'), JSON.stringify({ theme: 'obsidian', cssTheme: '' }));
	// Lived-in vault notes (idempotent — keep whatever earlier captures made).
	const notes = {
		'Daily/2026-10-02.md': [
			'# 2026-10-02',
			'',
			'- Shipped v2.0.0 — 53 providers, swarm mode, terminal pane',
			'- Fixed the LM Studio key prompt bug (#6)',
			'- Wrote the r/ObsidianMD launch post',
			'- Coffee experiment: 1:16 ratio, 92C, 3:00 — best cup yet',
			'',
			'## Reading',
			'- [[The Pragmatic Programmer]] ch. 7',
		].join('\n'),
		'Daily/2026-10-01.md': [
			'# 2026-10-01',
			'',
			'- Anthropic native tool-use: tool_use/tool_result blocks wired',
			'- Calculator tool registered (recursive descent, no eval)',
			'- Ran 5k, 26:12',
		].join('\n'),
		'Daily/2026-09-30.md': [
			'# 2026-09-30',
			'',
			'- Mapped the agent tool-calling architecture',
			'- Found the ghost calculator tool bug',
			'- Comparison table refresh vs Copilot v4',
		].join('\n'),
		'Projects/Curtis AI Chat.md': [
			'# Curtis AI Chat',
			'',
			'Polyglot AI chat for Obsidian. 53 providers, agent mode, arena.',
			'',
			'## Shipped',
			'- Agent tools on every provider',
			'- Multi-model arena',
			'',
			'## Next',
			'- Skill marketplaces',
			'- Voice modes',
		].join('\n'),
	};
	for (const [path, content] of Object.entries(notes)) {
		const full = resolve(VAULT, path);
		mkdirSync(dirname(full), { recursive: true });
		// Always rewrite — earlier runs (autocomplete takes) can leave test
		// lines in the fixture notes; the gallery owns their content.
		writeFileSync(full, content);
	}
}

let dataJsonBackup = null;
function overlaySettings() {
	const dataPath = resolve(PLUGIN_DIR, 'data.json');
	try { dataJsonBackup = readFileSync(dataPath, 'utf8'); } catch { dataJsonBackup = null; }
	let data = {};
	try { data = JSON.parse(dataJsonBackup ?? '{}'); } catch { data = {}; }
	data.onboardingCompleted = true;
	data.enableAgent = true;
	data.enableMemory = true;
	data.memoryCaptureMode = 'manual';
	data.enableRag = false;
	data.enableAutocomplete = true;
	data.notifyOnCompletion = false;
	data.notifyOnError = false;
	data.streamResponse = true;
	data.chatViewPosition = 'right';
	data.activeProvider = 'mock-llm';
	data.activeModel = 'mock-pro';
	data.activeHarnessId = 'curtis';
	data.customProviders = [
		...(Array.isArray(data.customProviders) ? data.customProviders.filter((p) => p?.id !== 'mock-llm') : []),
		{
			id: 'mock-llm',
			name: 'Gallery Mock',
			endpoint: mock.endpoint,
			authType: 'bearer',
			autoDiscoverModels: true,
			models: [
				{ id: 'mock-pro', name: 'Mock Pro', contextLength: 32768 },
				{ id: 'mock-mini', name: 'Mock Mini', contextLength: 16384 },
				{ id: 'mock-vision', name: 'Mock Vision', contextLength: 16384 },
				{ id: 'mock-reasoner', name: 'Mock Reasoner', contextLength: 65536 },
			],
		},
	];
	data.providerConfigs = {
		...(data.providerConfigs ?? {}),
		'mock-llm': { enabled: true, apiKey: MOCK_KEY, defaultModel: 'mock-pro' },
	};
	data.promptLibrary = [
		{ id: 'pl-review', name: 'Weekly review', content: 'Summarize my daily notes from the past week into wins, blockers, and a plan for next week.', createdAt: Date.now() },
		{ id: 'pl-terse', name: 'Rewrite tersely', content: 'Rewrite the previous answer 40% shorter with no preamble and no filler.', createdAt: Date.now() },
		{ id: 'pl-senior', name: 'Senior review', content: 'Review the attached note like a staff engineer: risks, edge cases, and what you would ship differently.', createdAt: Date.now() },
	];
	data.scheduledJobs = [
		...(Array.isArray(data.scheduledJobs) ? data.scheduledJobs.filter((j) => j?.id !== 'gallery-digest') : []),
		{
			id: 'gallery-digest',
			name: 'Morning vault digest',
			enabled: true,
			prompt: 'Summarize the notes created or edited in the last 24 hours in three bullets.',
			schedule: { kind: 'daily', time: '08:30' },
			createdAt: Date.now(),
		},
	];
	// A named agent — spawn_agent targets it in the swarm take, and the
	// Agents settings group / agent picker get real content.
	data.agents = [
		...(Array.isArray(data.agents) ? data.agents.filter((a) => a?.id !== 'researcher') : []),
		{
			id: 'researcher',
			name: 'Scout',
			emoji: '🔎',
			description: 'Reads the vault and reports findings in one tight paragraph.',
			systemPrompt: 'You are Scout, a research assistant. Read the requested notes and report findings as one tight paragraph. No preamble.',
			providerId: 'mock-llm',
			modelId: 'mock-pro',
			tools: { vault: true, web: false, mcp: false, gcp: false },
		},
	];
	writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function restoreSettings() {
	try {
		if (dataJsonBackup !== null) writeFileSync(resolve(PLUGIN_DIR, 'data.json'), dataJsonBackup);
	} catch { /* best effort */ }
}

let originalLaunchVault = null;
function registerDemoVault() {
	const p = resolve(process.env.APPDATA, 'obsidian-smoke', 'obsidian.json');
	let d = {};
	try { d = JSON.parse(readFileSync(p, 'utf8')); } catch { /* fresh */ }
	if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
	const vaults = (d.vaults ??= {});
	for (const [id, v] of Object.entries(vaults)) {
		if (v && typeof v === 'object' && v.open) originalLaunchVault = { id, path: v.path };
	}
	let id = Object.keys(vaults).find((k) => vaults[k] && vaults[k].path === VAULT);
	if (!id) {
		id = randomUUID();
		vaults[id] = { path: VAULT, ts: Date.now() };
	}
	for (const v of Object.values(vaults)) {
		if (v && typeof v === 'object') v.open = false;
	}
	vaults[id].open = true;
	writeFileSync(p, JSON.stringify(d, null, 2));
}

function restoreLaunchVault() {
	try {
		const p = resolve(process.env.APPDATA, 'obsidian-smoke', 'obsidian.json');
		const d = JSON.parse(readFileSync(p, 'utf8'));
		const vaults = d.vaults || {};
		for (const v of Object.values(vaults)) {
			if (v && typeof v === 'object') v.open = false;
		}
		let restored = false;
		if (originalLaunchVault) {
			for (const v of Object.values(vaults)) {
				if (v && v.path === originalLaunchVault.path) { v.open = true; restored = true; break; }
			}
		}
		if (!restored) {
			for (const v of Object.values(vaults)) {
				if (v && v.path !== VAULT) { v.open = true; break; }
			}
		}
		writeFileSync(p, JSON.stringify(d, null, 2));
	} catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Obsidian boot / attach
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDebugPort(port, ms) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (res.ok) return await res.json();
		} catch { /* not up yet */ }
		await sleep(500);
	}
	return null;
}

async function waitForVaultPage(ctx, pred, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const p of ctx.pages()) {
			try {
				const vault = await p.evaluate(() => window.app?.vault?.getName?.());
				if (vault !== 'demo-vault') continue;
				if (await p.evaluate(pred)) return p;
			} catch { /* stale page — retry */ }
		}
		await sleep(1000);
	}
	throw new Error(`timeout waiting for demo-vault page state: ${label}`);
}

async function waitForAnyPage(ctx, pred, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const p of ctx.pages()) {
			try {
				if (await p.evaluate(pred)) return p;
			} catch { /* stale page — retry */ }
		}
		await sleep(800);
	}
	throw new Error(`timeout waiting for page state: ${label}`);
}

async function killObsidian() {
	try { execSync('taskkill /IM ObsidianSmoke.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	await sleep(2500);
}

async function bootInstance(port, { width = 1680, height = 1050 } = {}) {
	const child = spawn(
		OBSIDIAN_EXE,
		[
			VAULT,
			`--remote-debugging-port=${port}`,
			`--window-size=${width},${height}`,
			'--window-position=20,20',
			'--disable-backgrounding-occluded-windows',
			'--disable-background-timer-throttling',
			'--disable-renderer-backgrounding',
		],
		{ detached: false, stdio: 'ignore' },
	);
	if (!(await waitForDebugPort(port, 25000))) {
		child.kill();
		throw new Error('debug port never opened');
	}
	let browser = null;
	for (let i = 0; i < 5 && !browser; i++) {
		try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); }
		catch { await sleep(2500); }
	}
	if (!browser) {
		child.kill();
		throw new Error('could not attach to the debug port');
	}
	const ctx = browser.contexts()[0];
	const logLine = (m) => {
		if ((m.type() === 'error' || m.type() === 'warning') && !/favicon|Theme|sourcemap/i.test(m.text())) {
			console.log(`[obsidian] ${m.type()}: ${m.text().slice(0, 160)}`);
		}
	};
	const bind = (p) => { p.on('console', logLine); p.on('pageerror', (e) => console.log(`[obsidian] pageerror: ${e.message.slice(0, 160)}`)); };
	for (const p of ctx.pages()) bind(p);
	ctx.on('page', bind);

	let page = await waitForVaultPage(ctx, () => true, 30000, 'window');
	try { await page.getByRole('button', { name: /trust/i }).click({ timeout: 8000 }); } catch { /* trusted */ }
	await page.evaluate(async () => {
		try { await window.app.plugins.enablePlugin('curtis'); } catch { /* on */ }
	});
	page = await waitForVaultPage(
		ctx,
		() => !!window.app?.plugins?.plugins?.['curtis']?.conversationStore,
		45000,
		'plugin onload'
	);
	await waitForVaultPage(ctx, () => !!window.app?.commands?.commands?.['curtis:open-chat'], 15000, 'commands');

	// Real desktop geometry — Obsidian restores its own bounds otherwise.
	try {
		const cdp = await ctx.newCDPSession(page);
		const { windowId } = await cdp.send('Browser.getWindowForTarget');
		await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
		await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width, height } });
		await cdp.detach();
	} catch { /* best effort */ }
	await page.evaluate(([, w, h]) => window.resizeTo(w, h), [0, width, height]).catch(() => {});
	await sleep(1200);

	return { child, browser, ctx, page };
}

async function shutdownInstance(inst) {
	if (!inst) return;
	try { await inst.browser.close(); } catch { /* dead */ }
	try { inst.child.kill(); } catch { /* dead */ }
	await killObsidian();
}

// ---------------------------------------------------------------------------
// Page-side helpers (serialized into the renderer)
// ---------------------------------------------------------------------------

const HIDE_TOASTS = `.notice-container { display: none !important; }`;

const evalSafe = async (page, fn, ...args) => {
	try { return await page.evaluate(fn, args); } catch (e) {
		console.log(`[gallery] evalSafe failed: ${String(e.message).slice(0, 120)}`);
		return null;
	}
};

const seedFactsAndConversations = async (page, { chartPng }) =>
	page.evaluate(({ chartPng }) => {
		const p = window.app.plugins.plugins['curtis'];
		const store = p.conversationStore;
		const DAY = 86400000;
		const now = Date.now();
		const out = {};

		// Long-term memory facts — the chip + settings UI need real rows.
		out.factIds = [];
		const wantFacts = [
			['Prefers concise answers with no preamble', 'preferences'],
			['Coffee ratio: 1:16 at 92°C for 3:00 — the current best cup', 'preferences'],
			['Main side project: Curtis AI Chat, an Obsidian plugin', 'projects'],
		];
		const have = p.memoryStore.getFacts().map((f) => f.content);
		for (const [content, category] of wantFacts) {
			if (!have.includes(content)) {
				// addFact is async; fire-and-forget is fine here (file write lands
				// before any screenshot minutes later).
				p.memoryStore.addFact(content, category).then((f) => { if (f) out.factIds.push(f.id); });
			}
		}
		const facts = p.memoryStore.getFacts();
		out.factIds = facts.slice(0, 3).map((f) => f.id);

		const mk = (firstUserText, provider, model) => {
			const conv = store.createConversation(provider, model);
			store.addMessageTo(conv.id, { role: 'user', content: firstUserText });
			return conv;
		};
		const assistant = (conv, content, opts = {}) =>
			store.addMessageTo(conv.id, {
				role: 'assistant',
				content,
				provider: opts.provider ?? conv.provider,
				model: opts.model ?? conv.model,
				tokens: { promptTokens: 1200 + ((content.length / 4) | 0), completionTokens: (content.length / 4) | 0, totalTokens: 1200 + ((content.length / 2) | 0) },
				...(opts.extra ?? {}),
			});

		// Hero — weekly review. Table, list, external link (favicon), tokens.
		const hero = mk('Weekly review — summarize my daily notes and draft next week’s plan.', 'openrouter', 'google/gemini-3.1-flash-lite');
		assistant(hero, [
			'**Week of Sep 28 – Oct 2**',
			'',
			'- **v2.0.0 shipped** — 53 providers, swarm mode, and the terminal pane all landed.',
			'- **Fixed #6** — LM Studio/Ollama no longer prompt for a key they never needed.',
			'- **Health** — ran 5k twice; coffee locked in at 1:16, 92°C, 3:00.',
			'',
			'| Area | Moved | Notes |',
			'|---|---|---|',
			'| Providers | 41 → 53 | Twelve new cards verified |',
			'| Agent tools | 8 → 11 | +list_notes, get_tags, get_backlinks |',
			'| Open issues | 14 → 9 | Two flaky repros closed |',
			'',
			'Release post draft is up on the [Obsidian forum](https://obsidian.md) — feedback round tonight.',
		].join('\n'), { provider: 'openrouter', model: 'google/gemini-3.1-flash-lite' });
		const u2 = store.addMessageTo(hero.id, { role: 'user', content: 'Turn the launch section into a paste-ready markdown checklist.' });
		u2.timestamp = now - DAY + 5 * 60000;
		assistant(hero, [
			'```markdown',
			'## v2.0 launch checklist',
			'',
			'- [x] Changelog — three sections, user-visible first',
			'- [x] Manifest + versions.json agree on minAppVersion',
			'- [ ] Screenshots — dark, light, and two community themes',
			'- [ ] r/ObsidianMD post — 3 bullets, no emoji',
			'- [ ] Forum thread — reply templates ready',
			'```',
			'',
			'Three bullets max per section when you trim.',
		].join('\n'), { provider: 'deepseek', model: 'deepseek-flash' });
		assistant(hero, 'Minimal dark reads best on phones — its composer keeps the send button inside the thumb zone and the input never jumps when the keyboard opens. Royal Velvet is the pretty one; Minimal is the practical one. For the gallery I’d ship Minimal dark + default light.', { provider: 'openrouter', model: 'google/gemini-3.1-flash-lite' });
		out.hero = hero.id;

		// Mention pill — attached note renders as a chip on the user bubble.
		const mention = mk('Summarize the attached daily note in one paragraph.', 'mock-llm', 'mock-pro');
		assistant(mention, 'Thursday shipped the v2 release: 53 providers, swarm followers, and a terminal pane. The LM Studio key prompt is gone, and the coffee ratio settled at 1:16 — 92°C, three minutes. Reading chapter 7 of The Pragmatic Programmer tonight.');
		const m0 = store.getAllConversations().find((c) => c.id === mention.id).messages[0];
		m0.attachedNotes = ['Daily/2026-10-02.md'];
		out.mention = mention.id;

		// Image attachment — chart on the user bubble, vision answer below.
		const img = mk('What does this token-usage chart suggest about the beta?', 'mock-llm', 'mock-vision');
		const iu = store.getAllConversations().find((c) => c.id === img.id).messages[0];
		iu.images = [chartPng];
		assistant(img, [
			'Three reads:',
			'',
			'1. **Prompt tokens dominate** (tall blue bar) — the system prompt + tool schemas are the bulk of every request. Trimming tool descriptions is the cheapest win.',
			'2. **Completion output is modest** (green) — answers are tight; no runaway generations.',
			'3. **The red bar is rounding error** — cache hits are working.',
			'',
			'Net: cost scales with conversation length, not answer length — summarization on long threads pays for itself.',
		].join('\n'));
		out.image = img.id;

		// Memory chip — the "N memories" badge on the assistant turn.
		const mem = mk('Remind me how I take my coffee?', 'mock-llm', 'mock-pro');
		assistant(mem, '1:16 ratio, 92°C, three minutes — your current best cup. That’s the experiment you locked in on Thursday.', { extra: { memoriesUsedIds: out.factIds } });
		out.memory = mem.id;

		// RAG tool card (seeded render — the live index stays off in the gallery).
		const rag = mk('Which of my notes mention the calculator tool?', 'mock-llm', 'mock-pro');
		assistant(rag, '', { extra: { tool_calls: [{ id: 'call_rag1', name: 'semantic_search', arguments: { query: 'calculator tool registration' } }] } });
		store.addMessageTo(rag.id, {
			role: 'tool',
			tool_call_id: 'call_rag1',
			content: '(2 excerpts)\nDaily/2026-10-01.md — “Calculator tool registered (recursive descent, no eval)”\nDaily/2026-09-30.md — “Found the ghost calculator tool bug”',
		});
		assistant(rag, 'Two hits: the registration note from Oct 1 (“recursive descent, no eval”) and the Sep 30 debugging note about the ghost calculator tool bug. Both are daily notes under `Daily/`.');
		out.rag = rag.id;

		// Seeded agent fallback (real runs below usually replace this).
		const agent = mk('Audit my daily notes and file what changed this week.', 'mock-llm', 'mock-pro');
		assistant(agent, '', { extra: { tool_calls: [{ id: 'call_a1', name: 'read_note', arguments: { path: 'Daily/2026-10-02.md' } }] } });
		store.addMessageTo(agent.id, { role: 'tool', tool_call_id: 'call_a1', content: '(read 96 words from Daily/2026-10-02.md)' });
		assistant(agent, 'Thursday’s note carries the week: v2.0.0 shipped, the LM Studio key bug is fixed, and the launch post is drafted. Filed the summary under Weekly.');
		out.agent = agent.id;

		store.setCurrentConversation(out.hero);
		return out;
	}, { chartPng });

const openChatAndRender = async () => {
	window.app.commands.executeCommandById('curtis:open-chat');
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		if (document.querySelector('.workspace-leaf-content[data-type="curtis-chat"]')) break;
		await new Promise((r) => setTimeout(r, 200));
	}
	const p = window.app.plugins.plugins['curtis'];
	const view = window.app.workspace.getLeavesOfType('curtis-chat')[0]?.view;
	const current = p.conversationStore.getCurrentConversation();
	if (view && current && typeof view.switchConversation === 'function') view.switchConversation(current.id);
	p.refreshChatViews?.();
};

const switchToConv = (marker) => {
	const p = window.app.plugins.plugins['curtis'];
	const convs = p.conversationStore.getAllConversations();
	const conv = convs.find((c) => (c.messages[0]?.content ?? '').startsWith(marker))
		?? convs.find((c) => c.title?.startsWith(marker));
	if (!conv) throw new Error('conversation not found: ' + marker);
	p.conversationStore.setCurrentConversation(conv.id);
	const view = window.app.workspace.getLeavesOfType('curtis-chat')[0]?.view;
	if (view && typeof view.switchConversation === 'function') view.switchConversation(conv.id);
	else window.app.workspace.getLeavesOfType('curtis-chat')[0].view.renderCurrentConversation?.();
	p.refreshChatViews?.();
	return conv.title;
};

const scrollChat = (where) => {
	const els = document.querySelectorAll('.workspace-leaf-content[data-type="curtis-chat"] .ai-chat-messages, .workspace-leaf-content[data-type="curtis-chat"] .view-content');
	for (const c of els) c.scrollTop = where === 'bottom' ? c.scrollHeight : 0;
	return els.length;
};

/** Park the pointer over plain message text so no tooltip photobombs a shot. */
async function parkMouse(page) {
	const box = page.viewportSize() ?? { width: 1280, height: 800 };
	await page.mouse.move(Math.round(box.width * 0.55), Math.round(box.height * 0.32));
	await page.waitForTimeout(420);
}

async function setTheme(page, theme) {
	return page.evaluate(async (theme) => {
		const c = window.app.customCss ?? window.app.customCSS;
		const defaults = theme === 'dark' || theme === 'light';
		if (defaults) {
			try { await c?.setTheme?.(''); } catch { /* already default */ }
			try { window.app.vault.setConfig('theme', theme === 'dark' ? 'obsidian' : 'moonstone'); } catch { /* older builds */ }
			document.body.removeClass('theme-light', 'theme-dark');
			document.body.addClass(theme === 'dark' ? 'theme-dark' : 'theme-light');
			return true;
		}
		if (!c || typeof c.setTheme !== 'function') return false;
		try { await c.setTheme(theme); } catch { return false; }
		return c.theme === theme;
	}, theme);
}

/** Screenshot into the gallery; registers the file on the current step. */
async function shoot(page, rel, { clipSel = null, fullPage = false } = {}, record = null) {
	const out = resolve(GALLERY, rel);
	mkdirSync(dirname(out), { recursive: true });
	if (clipSel) {
		const loc = page.locator(clipSel).first();
		await loc.screenshot({ path: out });
	} else {
		await page.screenshot({ path: out, fullPage });
	}
	record?.files.push(rel);
	console.log(`[gallery]   📷 ${rel}`);
	return rel;
}

/** Screenshot via raw CDP (respects Emulation device metrics — phone pass). */
async function shootCdp(cdp, rel, record = null) {
	const out = resolve(GALLERY, rel);
	mkdirSync(dirname(out), { recursive: true });
	const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(out, Buffer.from(data, 'base64'));
	record?.files.push(rel);
	console.log(`[gallery]   📷 ${rel}`);
	return rel;
}

// ---------------------------------------------------------------------------
// Video recording — polled CDP frames → ffmpeg MP4 + GIF
// ---------------------------------------------------------------------------

async function startRecording(page, clip = null) {
	const cdp = await page.context().newCDPSession(page);
	const framesDir = resolve(tmpdir(), `gallery-${randomUUID().slice(0, 8)}`);
	mkdirSync(framesDir, { recursive: true });
	// Clip to the pane that matters — full-window frames drag the vault
	// explorer and every sidebar into the video.
	const shotParams = clip
		? {
			format: 'jpeg',
			quality: 60,
			clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 },
		}
		: { format: 'jpeg', quality: 60 };
	let n = 0;
	let running = true;
	let lastData = null;
	let lastStamp = Date.now();
	const manifest = [{ file: null, t: 0 }];
	const captureLoop = (async () => {
		while (running) {
			const started = Date.now();
			try {
				const shot = await cdp.send('Page.captureScreenshot', shotParams);
				const data = Buffer.from(shot.data, 'base64');
				if (!lastData || !data.equals(lastData)) {
					const now = Date.now();
					manifest.push({ file: `f_${String(n).padStart(5, '0')}.jpg`, t: now - lastStamp });
					lastStamp = now;
					writeFileSync(resolve(framesDir, manifest[manifest.length - 1].file), data);
					lastData = data;
					n++;
				}
			} catch { /* renderer busy — next tick */ }
			await sleep(Math.max(0, 140 - (Date.now() - started)));
		}
	})();
	return {
		framesDir,
		manifest,
		async stop() {
			running = false;
			await captureLoop.catch(() => {});
			try { await cdp.detach(); } catch { /* detached */ }
			await sleep(350);
		},
	};
}

function encodeRecording(rec, outBase, { gif = true } = {}) {
	const frames = rec.manifest.filter((m) => m.file);
	if (frames.length < 4) {
		rmSync(rec.framesDir, { recursive: true, force: true });
		console.log(`[gallery]   🎬 ${outBase}: only ${frames.length} frame(s) — skipping encode`);
		return null;
	}
	const listPath = resolve(rec.framesDir, 'list.txt');
	const dur = (i) => {
		const next = frames[i + 1];
		const ms = next ? next.t : 500;
		return Math.min(1, Math.max(0.08, ms / 1000));
	};
	const list = frames
		.map((f, i) => `file '${f.file}'\nduration ${dur(i).toFixed(2)}`)
		.join('\n') + `\nfile '${frames[frames.length - 1].file}'`;
	writeFileSync(listPath, `ffconcat version 1.0\n${list}\n`);
	mkdirSync(dirname(resolve(GALLERY, outBase + '.mp4')), { recursive: true });
	execSync(
		`ffmpeg -y -f concat -safe 0 -i "${listPath}" ` +
		`-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ` +
		`-c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart "${resolve(GALLERY, outBase + '.mp4')}"`,
		{ stdio: 'ignore' }
	);
	if (gif) {
		execSync(
			`ffmpeg -y -f concat -safe 0 -i "${listPath}" ` +
			`-vf "scale=720:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" ` +
			`"${resolve(GALLERY, outBase + '.gif')}"`,
			{ stdio: 'ignore' }
		);
	}
	rmSync(rec.framesDir, { recursive: true, force: true });
	return outBase;
}

/** Measure a clip region for the recorder from a CSS selector. */
async function measureClip(page, clipSel) {
	if (!clipSel) return null;
	try {
		return await page.evaluate((sel) => {
			const el = document.querySelector(sel);
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: r.x, y: r.y, width: r.width, height: r.height };
		}, clipSel);
	} catch { return null; }
}

// Pane selectors for video framing — the subject of each take, not the
// whole window.
const CLIP_CHAT = '.workspace-leaf-content[data-type="curtis-chat"]';
const CLIP_EDITOR = '.workspace-leaf-content[data-type="markdown"]';
const CLIP_CENTER = '.workspace-split.mod-root';

/** The new-chat pane opens at docked default (~300px) — widen it before a
 *  chat-subject take, or the clip frames a sliver. */
async function ensureWideChatClip(page) {
	for (let i = 0; i < 6; i++) {
		const w = await evalSafe(page, () => {
			const leaf = document.querySelector('.workspace-leaf-content[data-type="curtis-chat"]');
			const split = leaf?.closest('.workspace-split');
			if (!split) return -1;
			for (const prop of ['width', 'max-width', 'flex-basis']) split.style.setProperty(prop, '860px', 'important');
			return split.offsetWidth;
		});
		if ((w ?? -1) >= 600) return true;
		await sleep(400);
	}
	return false;
}

/** Per-video framing — each take is clipped to the pane that matters. */
const VIDEO_CLIPS = {
	'videos/chat-send-stream': CLIP_CHAT,
	'videos/slash-commands-model-picker': CLIP_CHAT,
	'videos/mention-note': CLIP_CHAT,
	'videos/search-conversations': CLIP_CHAT,
	'videos/diff-rewrite-accept': CLIP_EDITOR,
	'videos/autocomplete-tab-accept': CLIP_EDITOR,
	'videos/memory-edit': CLIP_EDITOR,
	'videos/agent-tool-run': CLIP_CHAT,
	'videos/arena-duel': CLIP_CHAT,
	'videos/theme-switch': CLIP_CHAT,
	'videos/terminal-shell': CLIP_CENTER,
	'videos/multipane-tabs': '.workspace-tabs.mod-root',
};

/** Record a flow into <rel-base>.mp4/.gif, cropped to clipSel when given. */
async function video(page, relBase, flow, { gif = true, clipSel = null } = {}) {
	const sel = clipSel ?? VIDEO_CLIPS[relBase] ?? null;
	if (sel === CLIP_CHAT) await ensureWideChatClip(page);
	const clip = await measureClip(page, sel);
	console.log(`[gallery]   🎬 recording ${relBase}${clip ? ` (clip ${Math.round(clip.width)}×${Math.round(clip.height)})` : ''}`);
	const rec = await startRecording(page, clip);
	try {
		await flow();
		await page.waitForTimeout(600);
	} finally {
		await rec.stop();
	}
	const out = encodeRecording(rec, relBase, { gif });
	if (out) console.log(`[gallery]   🎬 ${relBase}.mp4 (+${gif ? '.gif' : 'no gif'})`);
	return out;
}

// ---------------------------------------------------------------------------
// Settings helpers — Obsidian 1.13 renders settings in its own window/page
// ---------------------------------------------------------------------------

async function openPluginSettings(ctx) {
	await waitForAnyPage(ctx, () => !!window.app?.commands, 5000, 'any app page');
	const main = ctx.pages().find((p) => p.url()) ?? ctx.pages()[0];
	await main.evaluate(() => {
		window.app.setting.open();
		window.app.setting.openTabById('curtis');
	});
	return waitForAnyPage(
		ctx,
		() => /provider configuration|active provider/i.test(document.body.innerText),
		20000,
		'settings open'
	);
}

async function settingsShot(settingsPage, headingText, rel, record) {
	await settingsPage.evaluate((heading) => {
		const els = Array.from(document.querySelectorAll('.setting-item-heading, h3, h2, .setting-item-name'));
		const el = els.find((e) => e.textContent?.trim() === heading)
			?? els.find((e) => e.textContent?.includes(heading));
		el?.scrollIntoView({ block: 'start' });
		if (el) window.scrollBy?.(0, -8);
	}, headingText);
	await settingsPage.waitForTimeout(650);
	await parkMouse(settingsPage);
	await shoot(settingsPage, rel, {}, record);
}

async function closeSettings(settingsPage) {
	await settingsPage.evaluate(() => { try { window.app.setting.close(); } catch { /* already */ } }).catch(() => {});
	await sleep(600);
}

/** Toggle streamResponse with a reload — tool scenes need buffered answers. */
async function setStreamResponse(inst, page, on) {
	await page.evaluate((on) => {
		const p = window.app.plugins.plugins['curtis'];
		p.settings.streamResponse = on;
		p.saveSettings();
	}, on);
	await page.evaluate(() => location.reload());
	let p = await waitForVaultPage(inst.ctx, () => !!window.app?.plugins?.plugins?.['curtis']?.conversationStore, 45000, 'reload');
	await waitForVaultPage(inst.ctx, () => !!window.app?.commands?.commands?.['curtis:open-chat'], 15000, 'commands (reload)');
	return p;
}

/** Re-acquire a live page after a renderer/connection drop. */
async function reacquirePage(inst, page) {
	try {
		await page.evaluate(() => 1);
		return page;
	} catch { /* dead — find the fresh one */ }
	console.log('[gallery]   page lost — re-acquiring');
	return waitForVaultPage(
		inst.ctx,
		() => !!window.app?.plugins?.plugins?.['curtis']?.conversationStore,
		45000,
		'reacquire page'
	);
}

// Wait until no streaming indicator remains in the chat (reply finished).
async function waitReplyDone(page, timeoutMs = 30000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const done = await evalSafe(page, () => {
			const streaming = document.querySelector('[class*="streaming"]');
			const hasText = (document.querySelector('.ai-chat-messages')?.innerText?.length ?? 0) > 60;
			return !streaming && hasText;
		});
		if (done) break;
		await sleep(400);
	}
	await page.waitForTimeout(600);
}

/** Playwright's viewportSize() is null for CDP-attached pages — read live. */
const vpOf = async (page) =>
	page.viewportSize() ?? (await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })));

/** JS-dispatch a click — bypasses Playwright actionability checks that hang
 *  on Obsidian's toolbar buttons (pointer-interception false positives). */
const jsClick = (page, selector) =>
	page.evaluate((sel) => document.querySelector(sel)?.click(), selector);

const jsClickText = (page, selector, text) =>
	page.evaluate(([sel, t]) => {
		const el = Array.from(document.querySelectorAll(sel)).find((n) => new RegExp(t, 'i').test(n.textContent ?? ''));
		el?.click();
		return !!el;
	}, [selector, text]);

// Arena picker: guarantee the wanted models are selected. The modal pre-selects
// the active model best-effort (and a bare settings load can leave it unset),
// so toggle any missing row ON — never off — then wait for Start to enable.
// MIN_SELECTIONS is 2, so the caller must name both duelists.
const ensureArenaSelection = async (page, names) => {
	const ok = await page.evaluate((wanted) => {
		let all = true;
		for (const name of wanted) {
			const row = Array.from(document.querySelectorAll('.ai-arena-picker-row')).find((r) => r.textContent?.includes(name));
			if (!row) { all = false; continue; }
			if (!row.classList.contains('is-selected')) row.click();
		}
		return all;
	}, names);
	if (!ok) throw new Error(`arena picker rows missing for: ${names.join(', ')}`);
	await page.waitForSelector('.ai-arena-picker-start:not([disabled])', { timeout: 8000 });
};

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

let currentStep = null;
async function step(id, group, title, desc, fn) {
	if (!wantStep({ id, group })) return;
	const rec = { id, group, title, desc, files: [], ok: false, startedAt: new Date().toISOString() };
	currentStep = rec;
	manifest.steps[id] = rec;
	console.log(`[gallery] ▶ ${id} — ${title}`);
	const t0 = Date.now();
	try {
		await fn(rec);
		rec.ok = true;
	} catch (e) {
		rec.error = String(e.message ?? e).slice(0, 300);
		console.log(`[gallery] ✗ ${id}: ${rec.error}`);
	}
	rec.ms = Date.now() - t0;
	currentStep = null;
	saveManifest();
}

// ===========================================================================
// DESKTOP PASS
// ===========================================================================

async function desktopPass() {
	console.log('[gallery] === desktop pass ===');
	await mock.start();
	bootstrapVault();
	overlaySettings();
	registerDemoVault();
	await killObsidian();
	rmSync(resolve(VAULT, '.obsidian', 'workspace.json'), { force: true });

	const inst = await bootInstance(PORT, { width: 1680, height: 1050 });
	const chartPng = makeChartPng();
	let ctx = inst.ctx;
	let page = inst.page;

	await step('setup', 'setup', 'Stage the demo vault', 'Seeds memory facts, six fixture conversations, and the mock provider; opens the chat beside the daily note.', async (rec) => {
		const ids = await seedFactsAndConversations(page, { chartPng });
		rec.seeded = ids;
		await page.evaluate(openChatAndRender);
		await page.evaluate(() => window.app.workspace.openLinkText('Daily/2026-10-02.md', ''));
		await waitForVaultPage(ctx, () => document.body.innerText.includes('Weekly review'), 30000, 'hero rendered');
		// Chat column wide enough for the full composer + pills.
		await page.evaluate(() => {
			const leaf = document.querySelector('.workspace-leaf-content[data-type="curtis-chat"]');
			const split = leaf?.closest('.workspace-split');
			if (split) for (const prop of ['width', 'max-width', 'flex-basis']) split.style.setProperty(prop, '860px', 'important');
		});
		await page.addStyleTag({ content: HIDE_TOASTS });
		await page.evaluate(scrollChat, 'top');
		await parkMouse(page);
		await page.waitForTimeout(900);
	});

	await step('chat-conversation', 'chat', 'Chat — conversation view', 'Markdown answers, provider/model pills, token counts, day separators, and a note open behind the chat. Default dark theme.', async () => {
		await page.evaluate(scrollChat, 'top');
		await parkMouse(page);
		await shoot(page, 'chat/conversation-dark.png');
	});

	await step('chat-code-table', 'chat', 'Chat — markdown rendering', 'Tables, checklists, and a fenced code block rendered inside answers.', async () => {
		await page.evaluate(() => {
			const el = Array.from(document.querySelectorAll('.ai-chat-messages *')).find((n) => n.tagName === 'CODE' && n.textContent.includes('launch checklist'));
			el?.scrollIntoView({ block: 'center' });
		});
		await parkMouse(page);
		await shoot(page, 'chat/markdown-code-table.png');
		await page.evaluate(scrollChat, 'top');
	});

	await step('chat-history', 'chat', 'Chat — conversation history', 'The history dropdown over the conversation: every chat is a persisted, searchable markdown note.', async () => {
		await jsClick(page, '.ai-chat-topbar-tools button:nth-child(1)');
		await page.waitForSelector('.ai-history-dropdown', { timeout: 8000 });
		await page.waitForTimeout(500);
		await parkMouse(page);
		await shoot(page, 'chat/history-dropdown.png');
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
	});

	await step('chat-model-picker', 'chat', 'Chat — model picker', 'The model picker across every enabled provider — 53 built-ins plus custom endpoints.', async () => {
		await jsClick(page, '.ai-model-picker-btn');
		// The picker surfaces as a menu/popover (not always a modal) — shoot
		// whatever appeared, then dismiss both possibilities.
		await page.waitForTimeout(1000);
		await parkMouse(page);
		await shoot(page, 'chat/model-picker.png');
		await page.keyboard.press('Escape');
		await page.waitForTimeout(350);
		await page.keyboard.press('Escape');
		await page.waitForTimeout(250);
	});

	await step('chat-slash-menu', 'chat', 'Chat — slash commands', 'Typing "/" opens the 20-command menu: clear, regen, model, agent, leader, export, prompt library…', async () => {
		await page.click('.ai-chat-input');
		await page.type('.ai-chat-input', '/', { delay: 60 });
		await page.waitForSelector('.ai-slash-menu-item', { timeout: 8000 });
		await page.waitForTimeout(500);
		await parkMouse(page);
		await shoot(page, 'chat/slash-menu.png');
	});

	await step('chat-prompt-library', 'chat', 'Chat — prompt library', 'The /prompt picker over the saved prompt library (slash commands execute on send).', async () => {
		await page.click('.ai-chat-input');
		await page.fill('.ai-chat-input', '');
		await page.type('.ai-chat-input', '/prompt', { delay: 40 });
		await page.waitForSelector('.ai-slash-menu-item', { timeout: 8000 });
		await page.waitForTimeout(400);
		await page.click('.ai-chat-send-btn');
		await page.waitForSelector('.modal-container', { timeout: 8000 });
		await page.waitForTimeout(500);
		await parkMouse(page);
		await shoot(page, 'chat/prompt-library.png');
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		await page.fill('.ai-chat-input', '');
	});

	await step('chat-mention', 'chat', 'Chat — @-mention notes', 'Typing "@" fuzzy-searches the vault and attaches the note as context (pill on the bubble).', async () => {
		await page.click('.ai-chat-input');
		await page.type('.ai-chat-input', '@daily', { delay: 60 });
		await page.waitForSelector('.ai-mention-menu-item', { timeout: 8000 });
		await page.waitForTimeout(500);
		await parkMouse(page);
		await shoot(page, 'chat/mention-popup.png');
		await page.fill('.ai-chat-input', '');
		await page.keyboard.press('Escape');
	});

	await step('chat-mention-pill', 'chat', 'Chat — attached-note pill', 'A sent message with an @-attached note: the pill names the file; its content went to the model, not the bubble.', async () => {
		await page.evaluate(switchToConv, 'Summarize the attached daily note');
		await page.evaluate(scrollChat, 'bottom');
		await page.waitForTimeout(600);
		await parkMouse(page);
		await shoot(page, 'chat/mention-pill.png');
	});

	await step('chat-image', 'chat', 'Chat — image attachments', 'A pasted chart on the user bubble and a vision answer below it.', async () => {
		await page.evaluate(switchToConv, 'What does this token-usage chart suggest');
		await page.evaluate(scrollChat, 'bottom');
		await page.waitForTimeout(600);
		await parkMouse(page);
		await shoot(page, 'chat/image-attachment.png');
	});

	await step('chat-memory-chip', 'chat', 'Chat — memory chip', 'The "memories" badge on a turn that drew on long-term memory; click it to see the facts used.', async () => {
		await page.evaluate(switchToConv, 'Remind me how I take my coffee');
		await page.evaluate(scrollChat, 'bottom');
		await page.waitForTimeout(600);
		await parkMouse(page);
		await shoot(page, 'chat/memory-chip.png');
	});

	await step('chat-rag-card', 'context', 'Vault retrieval — semantic_search card', 'The RAG tool card with retrieved excerpts (seeded render; the hybrid index itself is a settings toggle).', async () => {
		await page.evaluate(switchToConv, 'Which of my notes mention the calculator tool');
		await page.evaluate(scrollChat, 'bottom');
		await page.waitForTimeout(600);
		await parkMouse(page);
		await shoot(page, 'context/rag-semantic-search-card.png');
	});

	await step('chat-agent-seeded', 'agent', 'Agent — tool-call cards', 'read_note called inside a chat: the card shows the tool, its arguments, and the result (seeded render).', async () => {
		await page.evaluate(switchToConv, 'Audit my daily notes and file what changed');
		await page.evaluate(scrollChat, 'bottom');
		await page.waitForTimeout(600);
		await parkMouse(page);
		await shoot(page, 'agent/tool-cards-seeded.png');
	});

	await step('chat-new-empty', 'chat', 'Chat — new chat', 'The empty state: provider pill, composer, and the vault behind.', async () => {
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:new-chat'));
		await page.waitForTimeout(900);
		await parkMouse(page);
		await shoot(page, 'chat/new-chat-empty.png');
		await page.evaluate(switchToConv, 'Weekly review');
		await page.evaluate(scrollChat, 'bottom');
	});

	// ---- buffered scenes: agent tool loop, swarm, scheduled run ----
	mock.clear();
	page = await setStreamResponse(inst, page, false);
	await page.evaluate(openChatAndRender);
	await page.addStyleTag({ content: HIDE_TOASTS });

	await step('agent-live-read', 'agent', 'Agent — live tool run', 'A real agent turn through the loop: the model calls read_note, the tool executes against the vault, the answer cites it.', async (rec) => {
		mock.stage(
			{ kind: 'tool', calls: [{ name: 'read_note', arguments: { path: 'Daily/2026-10-02.md' } }], content: 'Reading the latest daily note first.' },
			{ kind: 'buffered', text: 'Thursday carried the week: v2.0.0 shipped (53 providers, swarm, terminal pane), the LM Studio key bug is fixed, and the launch post is drafted. Coffee settled at 1:16 — 92°C, three minutes.' },
		);
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:new-chat'));
		await page.waitForTimeout(700);
		await page.click('.ai-chat-input');
		await page.type('.ai-chat-input', 'Read my latest daily note and tell me what changed this week.', { delay: 10 });
		await page.click('.ai-chat-send-btn');
		await page.waitForSelector('.ai-message-tool-call', { timeout: 30000 });
		await page.waitForTimeout(2500);
		await parkMouse(page);
		rec.live = 'mock LLM over local SSE — real tool execution in the vault';
		await shoot(page, 'agent/tool-run-live.png');
	});

	await step('agent-live-write', 'agent', 'Agent — vault write', 'create_note executes for real: the note lands in the vault and opens next to the tool card that made it.', async (rec) => {
		mock.stage(
			{ kind: 'tool', calls: [{ name: 'create_note', arguments: { path: 'Projects/Idea Inbox.md', content: '# Idea Inbox\n\n- Skill marketplaces with curated packs\n- Voice mode with per-agent voices\n- Arena tournaments on a folder of prompts' } }] },
			{ kind: 'buffered', text: 'Created **Projects/Idea Inbox.md** with three candidates. The skill marketplace idea is the strongest — it compounds the existing Skills loader.' },
		);
		createdFiles.push('Projects/Idea Inbox.md');
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:new-chat'));
		await page.waitForTimeout(700);
		await page.click('.ai-chat-input');
		await page.type('.ai-chat-input', 'Create a note at Projects/Idea Inbox.md with three feature ideas for the plugin.', { delay: 10 });
		await page.click('.ai-chat-send-btn');
		await page.waitForSelector('.ai-message-tool-call', { timeout: 30000 });
		await page.waitForTimeout(2000);
		await page.evaluate(() => window.app.workspace.openLinkText('Projects/Idea Inbox.md', ''));
		await page.waitForTimeout(1200);
		await parkMouse(page);
		rec.live = 'mock LLM over local SSE — real note created in the vault';
		await shoot(page, 'agent/note-created-live.png');
	});

	await step('swarm-live', 'swarm', 'Swarm — leader spawns a follower', 'Leader chat marked with /leader, then one send: the spawn_agent tool starts a follower conversation in its own pane, which reports back into the leader thread.', async (rec) => {
		// Leader badge still first — slash commands execute on SEND: fill the
		// input and click send; the send path intercepts the command.
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:new-chat'));
		await page.waitForTimeout(600);
		mock.clear();
		await page.fill('.ai-chat-input', '/leader');
		await page.click('.ai-chat-send-btn');
		let badge = false;
		for (let i = 0; i < 10 && !badge; i++) {
			await sleep(400);
			badge = await evalSafe(page, () => !!document.querySelector('.ai-chat-leader-badge'));
		}
		if (!badge) throw new Error('/leader did not mark the conversation (no badge)');
		await page.fill('.ai-chat-input', '');
		await parkMouse(page);
		await shoot(page, 'swarm/leader-badge.png');
		// One send: spawn_agent → follower runs → leader wraps up.
		mock.stage(
			{ kind: 'tool', calls: [{ name: 'spawn_agent', arguments: { task: 'Read the three daily notes under Daily/ and report the three most important items from the week, in one short paragraph.', agent: 'researcher' } }] },
			{ kind: 'buffered', text: 'Follower report — the week’s three load-bearing items: v2.0.0 shipped (53 providers, swarm, terminal), the LM Studio key bug closed (#6), and the r/ObsidianMD launch post is drafted. Coffee: 1:16 at 92°C.' },
			{ kind: 'buffered', text: 'The follower confirms the week reduces to three items: the v2.0.0 ship, the #6 fix, and the drafted launch post. I’d lead the changelog with the provider count.' },
		);
		await page.click('.ai-chat-input');
		await page.type('.ai-chat-input', 'Spawn a follower to read my daily notes and report the week’s top three items.', { delay: 10 });
		await page.click('.ai-chat-send-btn');
		await page.waitForSelector('.ai-message-tool-call', { timeout: 30000 });
		await page.waitForTimeout(1500);
		await parkMouse(page);
		await shoot(page, 'swarm/follower-running.png');
		// Follower pane appears in the workspace — wait, then frame the split.
		await page.waitForTimeout(6000);
		await parkMouse(page);
		await shoot(page, 'swarm/follower-pane.png');
		await page.waitForTimeout(5000);
		await parkMouse(page);
		await shoot(page, 'swarm/report-in-leader.png');
		rec.live = 'mock LLM over local SSE — real spawn_agent + follower conversation';
	});

	await step('scheduled-run', 'scheduled', 'Scheduled runs — Run now', 'The settings card with a daily job, then a real manual fire: the headless run lands as a markdown note and the row shows its status.', async (rec) => {
		const settingsPage = await openPluginSettings(ctx);
		await settingsShot(settingsPage, 'Morning vault digest', 'scheduled/scheduled-runs-card.png', rec);
		// Fire it for real — with a fresh scene so the digest note has content
		// (a stale queue makes the run land empty).
		mock.clear();
		mock.stage({ kind: 'buffered', text: 'Three updates in the last day: the Idea Inbox note gained a skill-marketplace candidate, the daily notes logged the v2.0.0 launch checklist, and memory picked up the dark-theme preference.' });
		await settingsPage.evaluate(() => {
			const btn = Array.from(document.querySelectorAll('button')).find(
				(b) => (b.getAttribute('aria-label') ?? '').includes('Run now') || /run now/i.test(b.textContent ?? '')
			);
			btn?.click();
		});
		// The run note lands under AI/Scheduled/.
		const scheduledDir = resolve(VAULT, 'AI', 'Scheduled');
		let notePath = null;
		for (let i = 0; i < 30 && !notePath; i++) {
			await sleep(1000);
			try {
				const files = readdirSync(scheduledDir).filter((f) => f.endsWith('.md'));
				if (files.length) notePath = join('AI', 'Scheduled', files[files.length - 1]);
			} catch { /* dir not yet */ }
		}
		if (notePath) {
			createdFiles.push(notePath);
			rec.runNote = notePath;
			await page.evaluate((p) => window.app.workspace.openLinkText(p, ''), notePath);
			await page.waitForTimeout(1200);
			await closeSettings(settingsPage);
			await parkMouse(page);
			await shoot(page, 'scheduled/run-note.png');
			// Card again with the status column filled in.
			const s2 = await openPluginSettings(ctx);
			await settingsShot(s2, 'Morning vault digest', 'scheduled/scheduled-runs-card-after.png', rec);
			await closeSettings(s2);
		} else {
			await closeSettings(settingsPage);
			throw new Error('run note never landed under AI/Scheduled');
		}
		await page.evaluate(switchToConv, 'Weekly review');
	});

	// ---- back to streaming for the writing tools + video + arena block ----
	mock.clear();
	page = await setStreamResponse(inst, page, true);
	await page.evaluate(openChatAndRender);
	await page.addStyleTag({ content: HIDE_TOASTS });

	await step('diff-rewrite', 'writing', 'Inline diff rewrite', 'Select text → rewrite-with-AI → review the word-level diff → Accept or Reject. Real run: the mock rewrite replaces the selection.', async (rec) => {
		mock.stage({ kind: 'sse', paceMs: 10, firstDelayMs: 300, chunks: ['Coffee experiment locked: 1:16 ratio, 92°C, three minutes — repeat exactly for the next shot.'] });
		await page.evaluate(() => window.app.workspace.openLinkText('Daily/2026-10-02.md', ''));
		await page.waitForTimeout(900);
		await page.evaluate(() => {
			const active = window.app.workspace.getMostRecentLeaf()?.view;
			const editor = active?.editor;
			if (!editor) throw new Error('no active editor');
			const line = editor.getValue().split('\n').findIndex((l) => l.includes('Coffee experiment'));
			if (line < 0) throw new Error('coffee line not found');
			editor.setCursor({ line, ch: 0 });
			editor.setSelection({ line, ch: 0 }, { line, ch: editor.getLine(line).length });
		});
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:rewrite-with-ai'));
		await page.waitForSelector('.ai-diff-rewrite-modal', { timeout: 30000 });
		await page.waitForTimeout(900);
		await parkMouse(page);
		await shoot(page, 'writing/diff-rewrite-modal.png');
		// Video the Accept.
		await video(page, 'videos/diff-rewrite-accept', async () => {
			await page.waitForTimeout(400);
			await page.evaluate(() => {
				const btn = Array.from(document.querySelectorAll('.ai-diff-rewrite-modal button')).find((b) => /accept|apply|replace/i.test(b.textContent ?? ''));
				btn?.click();
			});
			await page.waitForTimeout(900);
		});
		// Undo the rewrite so the vault note is untouched.
		await page.evaluate(() => {
			const active = window.app.workspace.getMostRecentLeaf()?.view;
			active?.editor?.undo?.();
		});
		rec.live = 'mock rewrite through the real selection-action pipeline';
	});

	await step('autocomplete', 'writing', 'Inline autocomplete', 'Ghost text while typing in a note (dedicated model, off by default) — Tab accepts. Real run through the autocomplete controller.', async (rec) => {
		await page.evaluate(() => {
			const p = window.app.plugins.plugins['curtis'];
			p.settings.enableAutocomplete = true;
			p.settings.autocompleteProviderId = 'mock-llm';
			p.settings.autocompleteModelId = 'mock-mini';
			p.saveSettings();
		});
		// The ghost extension attaches per-editor from settings at editor
		// creation — reload so open notes pick the feature up.
		page = await setStreamResponse(inst, page, true);
		await page.evaluate(openChatAndRender);
		await page.addStyleTag({ content: HIDE_TOASTS });
		await page.evaluate(() => window.app.workspace.openLinkText('Daily/2026-10-01.md', ''));
		await page.waitForTimeout(900);
		await page.evaluate(() => {
			const active = window.app.workspace.getMostRecentLeaf()?.view;
			const editor = active?.editor;
			const n = editor.lineCount();
			editor.setCursor({ line: n - 1, ch: editor.getLine(n - 1).length });
		});
		mock.clear();
		mock.stage({ kind: 'sse', chunks: ['- Tomatoes: 4 plants in, first fruit set', '- Repot the basil'], paceMs: 12, firstDelayMs: 350 });
		const notePath = resolve(VAULT, 'Daily', '2026-10-01.md');
		const noteOriginal = readFileSync(notePath, 'utf8');
		// The controller fires after a burst of ≥4 non-whitespace chars since
		// the last whitespace (burstLength) — end mid-word with a real word
		// chunk, never with a trailing space.
		await page.keyboard.type('\n- Water the plan', { delay: 30 });
		// Ghost text appears after the idle debounce.
		let ghost = false;
		for (let i = 0; i < 20 && !ghost; i++) {
			await sleep(500);
			ghost = await evalSafe(page, () => !!document.querySelector('.cm-ghost-suggestion'));
		}
		if (!ghost) throw new Error('ghost text never appeared');
		await parkMouse(page);
		await shoot(page, 'writing/autocomplete-ghost.png');
		await video(page, 'videos/autocomplete-tab-accept', async () => {
			await page.keyboard.press('Tab');
			await page.waitForTimeout(700);
		});
		// Put the daily note back — the accepted suggestion stays in the buffer
		// but the file on disk returns to its captured state.
		writeFileSync(notePath, noteOriginal);
		rec.live = 'mock autocomplete model over local SSE';
	});

	await step('videos-chat', 'videos', 'Video — send + streamed reply', 'Type a prompt, send, watch the reply stream token by token over real SSE. Then /model → picker, @-mention, and cross-conversation search.', async (rec) => {
		const made = [];
		const safeVideo = async (base, flow) => {
			try { const out = await video(page, base, flow); if (out) made.push(base); } catch (e) { console.log(`[gallery]   ${base} failed: ${String(e.message).slice(0, 90)}`); }
		};
		await safeVideo('videos/chat-send-stream', async () => {
			await page.evaluate(() => window.app.commands.executeCommandById('curtis:new-chat'));
			await page.waitForTimeout(600);
			mock.clear();
			mock.stage({
				kind: 'sse',
				paceMs: 42,
				firstDelayMs: 500,
				chunks: 'Arena mode streams one prompt to several models side by side — you just watched a single-model stream; the arena adds the second column.\n\n- Same prompt, 2–4 models\n- Per-column stop\n- Promote the winner into a normal chat'.split(/(?<=\s)/),
			});
			await page.click('.ai-chat-input');
			await page.type('.ai-chat-input', 'Explain arena mode in two sentences and three bullets.', { delay: 24 });
			await page.click('.ai-chat-send-btn');
			const vp = await vpOf(page);
			await page.mouse.move(Math.round(vp.width * 0.85), Math.round(vp.height * 0.3));
			await sleep(1200);
			await waitReplyDone(page, 20000);
			await sleep(1600);
		});
		await safeVideo('videos/slash-commands-model-picker', async () => {
			await page.evaluate(() => window.app.commands.executeCommandById('curtis:new-chat'));
			await page.waitForTimeout(500);
			await page.click('.ai-chat-input');
			// The slash menu opens on "/" — then /model takes an argument and
			// runs on send, switching the pill. Two beats: menu, then command.
			await page.type('.ai-chat-input', '/', { delay: 80 });
			await page.waitForSelector('.ai-slash-menu-item', { timeout: 8000 });
			await page.waitForTimeout(1000);
			await page.fill('.ai-chat-input', '/model mock-mini');
			await page.waitForTimeout(400);
			await page.click('.ai-chat-send-btn');
			await page.waitForTimeout(1600);
		});
		await safeVideo('videos/mention-note', async () => {
			await page.click('.ai-chat-input');
			await page.type('.ai-chat-input', '@', { delay: 80 });
			await page.waitForSelector('.ai-mention-menu-item', { timeout: 8000 });
			await page.waitForTimeout(800);
			await page.type('.ai-chat-input', 'daily', { delay: 70 });
			await page.waitForTimeout(800);
			await page.keyboard.press('Enter');
			await page.waitForTimeout(900);
			await page.fill('.ai-chat-input', '');
		});
		await safeVideo('videos/search-conversations', async () => {
			await jsClick(page, '.ai-chat-topbar-tools button:nth-child(2)');
			await page.waitForSelector('.modal-container', { timeout: 8000 });
			await page.waitForTimeout(500);
			await page.type('.prompt input', 'coffee', { delay: 80 });
			await page.waitForTimeout(1100);
			await page.keyboard.press('Enter');
			await page.waitForTimeout(1100);
		});
		rec.videos = made.length ? made : undefined;
		if (made.length === 0) throw new Error('no chat videos encoded');
	});

	await step('videos-agent-terminal-multipane', 'videos', 'Video — agent tools, terminal shell, multipane', 'Agent tool cards appearing live; a real shell session in the terminal pane; a second chat tab and a popout window.', async (rec) => {
		const made = [];
		try {
			await video(page, 'videos/agent-tool-run', async () => {
				await page.evaluate(() => window.app.commands.executeCommandById('curtis:new-chat'));
				await page.waitForTimeout(500);
				mock.clear();
				mock.stage(
					{ kind: 'tool', calls: [{ name: 'list_notes', arguments: { folder: 'Daily' } }] },
					{ kind: 'buffered', text: 'Three daily notes this week. The thread: v2.0.0 shipped, the key-prompt bug closed, launch post drafted.' },
				);
				await page.click('.ai-chat-input');
				await page.type('.ai-chat-input', 'List my daily notes and summarize the week in one line.', { delay: 16 });
				await page.click('.ai-chat-send-btn');
				await page.waitForTimeout(6000);
			});
			made.push('videos/agent-tool-run');
		} catch (e) { console.log(`[gallery]   agent video failed: ${String(e.message).slice(0, 90)}`); }
		try {
			// Terminal as a TAB — the window variant records as a separate OS
			// window the main-page capture never sees (frames go static).
			await video(page, 'videos/terminal-shell', async () => {
				await page.evaluate(() => window.app.commands.executeCommandById('curtis:open-terminal-tab'));
				await page.waitForTimeout(2500);
				// Focus the terminal's command input whatever its exact tag is.
				await page.evaluate(() => {
					const input = document.querySelector('.ai-term-view input, .ai-term-view textarea')
						?? document.querySelector('.workspace-leaf-content[data-type="curtis-terminal"] input, .workspace-leaf-content[data-type="curtis-terminal"] textarea');
					input?.focus();
				});
				await page.waitForTimeout(400);
				await page.keyboard.type('node -v', { delay: 40 });
				await page.keyboard.press('Enter');
				await page.waitForTimeout(2500);
				await page.keyboard.type('echo Curtis gallery shell works', { delay: 30 });
				await page.keyboard.press('Enter');
				await page.waitForTimeout(2500);
			});
			made.push('videos/terminal-shell');
		} catch (e) { console.log(`[gallery]   terminal video failed: ${String(e.message).slice(0, 90)}`); }
		try {
			// Tab split only — the popout is an OS window the main-page capture
			// can't see (a static main page skips the encode).
			await video(page, 'videos/multipane-tabs', async () => {
				await page.evaluate(() => window.app.commands.executeCommandById('curtis:open-new-chat-tab'));
				await page.waitForTimeout(1800);
				await page.evaluate(switchToConv, 'Weekly review');
				await page.waitForTimeout(900);
			});
			made.push('videos/multipane-tabs');
		} catch (e) { console.log(`[gallery]   multipane video failed: ${String(e.message).slice(0, 90)}`); }
		rec.videos = made;
	});

	await step('terminal-stills', 'terminal', 'Terminal pane', 'A desktop shell in its own pane (or window) — fresh shell per command, real output. Mobile gets a vault-only shell.', async (rec) => {
		// Window variant: the terminal lives in its own OS window — find that
		// CDP page and shoot it directly.
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:open-terminal'));
		await page.waitForTimeout(2500);
		let termWin = null;
		for (const p of ctx.pages()) {
			try {
				if (p === page) continue;
				if (await p.evaluate(() => !!document.querySelector('.workspace-leaf-content[data-type="curtis-terminal"]'))) { termWin = p; break; }
			} catch { /* not it */ }
		}
		if (termWin) {
			await termWin.waitForTimeout(600);
			await shoot(termWin, 'terminal/terminal-window.png');
			await termWin.close().catch(() => {});
			await page.waitForTimeout(600);
		}
		// Tab variant on the main page.
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:open-terminal-tab'));
		await page.waitForTimeout(1800);
		await page.evaluate(() => {
			const input = document.querySelector('.workspace-leaf-content[data-type="curtis-terminal"] input, .workspace-leaf-content[data-type="curtis-terminal"] textarea');
			input?.focus();
		});
		await page.keyboard.type('dir /b Daily', { delay: 24 });
		await page.keyboard.press('Enter');
		await page.waitForTimeout(2200);
		await parkMouse(page);
		await shoot(page, 'terminal/terminal-pane.png');
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:open-chat'));
		await page.waitForTimeout(700);
	});

	await step('multipane-stills', 'multipane', 'Multi-pane chat', 'A second chat as a titled tab and as its own OS window — each pane with its own conversation and model.', async (rec) => {
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:open-new-chat-tab'));
		await page.waitForTimeout(1600);
		await parkMouse(page);
		await shoot(page, 'multipane/multipane-tabs.png');
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:open-chat-window'));
		await page.waitForTimeout(2600);
		// The popout is its own CDP page target.
		let popout = null;
		for (const p of ctx.pages()) {
			try {
				if (p === page) continue;
				if (await p.evaluate(() => !!window.app && !!document.querySelector('.workspace-leaf-content[data-type="curtis-chat"]'))) { popout = p; break; }
			} catch { /* not the popout */ }
		}
		if (popout) {
			await popout.waitForTimeout(800);
			await shoot(popout, 'multipane/multipane-popout-window.png');
			await popout.close().catch(() => {});
		} else {
			console.log('[gallery]   popout window not found — skipping still');
		}
		await page.waitForTimeout(800);
	});

	await step('arena-stills', 'arena', 'Multi-model arena', 'One prompt to two models in parallel: picker, live streaming duel, per-column stop, and promote-to-chat. Mock duel, real arena pipeline.', async (rec) => {
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:new-chat'));
		await page.waitForTimeout(700);
		mock.clear();
		await page.click('.ai-chat-arena-btn');
		await page.waitForSelector('.ai-arena-picker-modal', { timeout: 8000 });
		await page.waitForTimeout(500);
		await parkMouse(page);
		await shoot(page, 'arena/arena-picker.png');
		await ensureArenaSelection(page, ['Mock Pro', 'Mock Mini']);
		await page.locator('.ai-arena-picker-start').click();
		await page.waitForTimeout(600);
		mock.stage(
			{ model: 'mock-pro', kind: 'sse', paceMs: 26, firstDelayMs: 400, chunks: 'Side-by-side testing beats leaderboards for YOUR workload: leaderboards average over benchmarks you do not run.\n\n- Same prompt, both models, one view\n- Differences in tone and structure become obvious\n- The winner is whatever answers your actual prompt best'.split(/(?<=\s)/) },
			{ model: 'mock-mini', kind: 'sse', paceMs: 60, firstDelayMs: 900, chunks: 'Leaderboards summarize; the arena shows. Run your prompt on both columns and judge the answers you actually got.'.split(/(?<=\s)/) },
		);
		await page.click('.ai-chat-input');
		await page.type('.ai-chat-input', 'Side-by-side testing vs leaderboards — which and why? Two sentences, three bullets.', { delay: 14 });
		await page.click('.ai-chat-send-btn');
		const vp = await vpOf(page);
		await page.mouse.move(Math.round(vp.width * 0.85), Math.round(vp.height * 0.3));
		await page.waitForTimeout(3500);
		await parkMouse(page);
		await shoot(page, 'arena/arena-streaming-dark.png');
		// Stop the slow column mid-flight (per-column stop).
		await page.evaluate(() => {
			const cols = document.querySelectorAll('.ai-arena-column');
			const btn = cols[1]?.querySelector('.ai-arena-stop-btn');
			if (btn instanceof HTMLElement) btn.click();
		});
		await page.waitForTimeout(1200);
		await parkMouse(page);
		await shoot(page, 'arena/arena-stopped.png');
		const deadline = Date.now() + 40000;
		while (Date.now() < deadline) {
			const done = await evalSafe(page, () => document.querySelectorAll('.ai-arena-stop-btn').length === 0);
			if (done) break;
			await sleep(500);
		}
		await page.waitForTimeout(700);
		await parkMouse(page);
		await shoot(page, 'arena/arena-final-dark.png');
		await page.evaluate(() => {
			const cols = Array.from(document.querySelectorAll('.ai-arena-column'));
			let best = 0;
			let bestChars = -1;
			cols.forEach((c, i) => {
				const chars = (c.querySelector('.ai-arena-column-response')?.textContent || '').length;
				if (chars > bestChars) { bestChars = chars; best = i; }
			});
			cols[best]?.querySelector('.ai-arena-promote-btn:not([disabled])')?.click();
		});
		await page.waitForTimeout(1800);
		await parkMouse(page);
		await shoot(page, 'arena/arena-promoted.png');
		// Light theme duel still.
		await setTheme(page, 'light');
		await page.waitForTimeout(800);
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:new-chat'));
		await page.waitForTimeout(600);
		mock.clear();
		await page.click('.ai-chat-arena-btn');
		await page.waitForSelector('.ai-arena-picker-modal', { timeout: 8000 });
		await ensureArenaSelection(page, ['Mock Pro', 'Mock Mini']);
		await page.locator('.ai-arena-picker-start').click();
		await page.waitForTimeout(500);
		mock.stage(
			{ model: 'mock-pro', kind: 'sse', paceMs: 30, firstDelayMs: 400, chunks: 'Run both, then decide. A leaderboard is someone else’s benchmark average; the arena is your prompt, your tone, your verdict.'.split(/(?<=\s)/) },
			{ model: 'mock-mini', kind: 'sse', paceMs: 55, firstDelayMs: 800, chunks: 'Two columns, one prompt: differences in structure and candor show up immediately.'.split(/(?<=\s)/) },
		);
		await page.click('.ai-chat-input');
		await page.type('.ai-chat-input', 'Make the case for arena testing in one sentence.', { delay: 14 });
		await page.click('.ai-chat-send-btn');
		await page.waitForTimeout(3200);
		await parkMouse(page);
		await shoot(page, 'arena/arena-streaming-light.png');
		await setTheme(page, 'dark');
		await page.waitForTimeout(600);
		rec.live = 'mock duel through the real arena pipeline';
	});

	await step('video-arena-theme-memory', 'videos', 'Video — arena duel + live theme switch', 'A full arena take (picker → duel → per-column stop → promote) and the app re-theming live: dark → light → Minimal → Royal Velvet.', async (rec) => {
		page = await reacquirePage(inst, page);
		await page.evaluate(openChatAndRender);
		await page.addStyleTag({ content: HIDE_TOASTS });
		await video(page, 'videos/arena-duel', async () => {
			await page.evaluate(() => window.app.commands.executeCommandById('curtis:new-chat'));
			await page.waitForTimeout(700);
			mock.clear();
			// The arena button lives in the composer of a fresh chat pane — make
			// sure it's really there before clicking (previous promote states
			// can linger into the new conversation for a beat).
			let pickerUp = false;
			for (let attempt = 0; attempt < 2 && !pickerUp; attempt++) {
				await jsClick(page, '.ai-chat-arena-btn');
				try {
					await page.waitForSelector('.ai-arena-picker-modal', { timeout: 6000 });
					pickerUp = true;
				} catch {
					await page.evaluate(openChatAndRender);
					await page.waitForTimeout(900);
				}
			}
			if (!pickerUp) throw new Error('arena picker never opened');
			await page.waitForTimeout(600);
			await ensureArenaSelection(page, ['Mock Pro', 'Mock Mini']);
			await page.locator('.ai-arena-picker-start').click();
			await page.waitForTimeout(500);
			// Long take: the pro column streams fast and finishes first; the
			// mini column streams slower and gets stopped mid-flight — both
			// columns visibly stream together, then promote keeps the winner.
			mock.stage(
				{ model: 'mock-pro', kind: 'sse', paceMs: 300, firstDelayMs: 450, chunks: 'Run the duel before you trust any leaderboard.\n\n- A leaderboard averages over other people’s prompts.\n- The arena runs yours: same question, two models, one view.\n- Tone and structure diverge live — stop the rambler, promote the answer that lands.'.split(/(?<=\s)/) },
				{ model: 'mock-mini', kind: 'sse', paceMs: 560, firstDelayMs: 900, chunks: 'Averages hide your workload. Type once, watch both columns answer at their own pace, stop the one that rambles, keep the one that lands.'.split(/(?<=\s)/) },
			);
			await page.click('.ai-chat-input');
			await page.type('.ai-chat-input', 'Why test side by side instead of trusting a leaderboard?', { delay: 16 });
			await page.click('.ai-chat-send-btn');
			const vp = await vpOf(page);
			await page.mouse.move(Math.round(vp.width * 0.85), Math.round(vp.height * 0.3));
			// Both columns visibly streaming side by side.
			await page.waitForTimeout(8400);
			// Per-column stop: kill the slow column mid-flight; the fast one keeps typing.
			await page.evaluate(() => {
				const cols = document.querySelectorAll('.ai-arena-column');
				const btn = cols[1]?.querySelector('.ai-arena-stop-btn');
				if (btn instanceof HTMLElement) btn.click();
			});
			await page.waitForTimeout(2600);
			// Let the surviving column finish on its own before promoting.
			const settled = Date.now() + 25000;
			while (Date.now() < settled) {
				const done = await evalSafe(page, () => document.querySelectorAll('.ai-arena-stop-btn').length === 0);
				if (done) break;
				await sleep(400);
			}
			await page.waitForTimeout(800);
			await page.evaluate(() => {
				const cols = Array.from(document.querySelectorAll('.ai-arena-column'));
				let best = 0;
				let bestChars = -1;
				cols.forEach((c, i) => {
					const chars = (c.querySelector('.ai-arena-column-response')?.textContent || '').length;
					if (chars > bestChars) { bestChars = chars; best = i; }
				});
				cols[best]?.querySelector('.ai-arena-promote-btn:not([disabled])')?.click();
			});
			await page.waitForTimeout(2400);
		});
		await video(page, 'videos/theme-switch', async () => {
			await page.evaluate(() => window.app.commands.executeCommandById('curtis:new-chat'));
			await page.waitForTimeout(600);
			await setTheme(page, 'light');
			await page.waitForTimeout(1400);
			await setTheme(page, 'Minimal');
			await page.waitForTimeout(1400);
			await setTheme(page, 'Royal Velvet');
			await page.waitForTimeout(1400);
			await setTheme(page, 'dark');
			await page.waitForTimeout(1000);
		});
		rec.videos = ['videos/arena-duel', 'videos/theme-switch'];
	});

	await step('video-memory-file', 'videos', 'Video — memory file', 'Memory is a plain markdown note: open AI/Curtis Memory.md, add a fact, save — Curtis recalls it next turn.', async (rec) => {
		page = await reacquirePage(inst, page);
		await video(page, 'videos/memory-edit', async () => {
			await page.evaluate(() => window.app.workspace.openLinkText('AI/Curtis Memory.md', ''));
			await page.waitForTimeout(1000);
			await page.evaluate(() => {
				const active = window.app.workspace.getMostRecentLeaf()?.view;
				const editor = active?.editor;
				const n = editor.lineCount();
				editor.setCursor({ line: n - 1, ch: 0 });
			});
			await page.keyboard.type('- Prefers dark themes for screenshots\n', { delay: 26 });
			await page.waitForTimeout(500);
			await page.keyboard.press('Control+s');
			await page.waitForTimeout(800);
		});
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:open-chat'));
		await page.waitForTimeout(800);
		rec.videos = ['videos/memory-edit'];
	});

	// ---- settings tour ----
	await step('settings-groups', 'settings', 'Settings — every group', 'The full settings surface: providers, generation, agent, agents, skills, terminal, chat UI, voice, notes, conversations, MCP, GCP, about.', async (rec) => {
		const settingsPage = await openPluginSettings(ctx);
		const groups = [
			['Active provider', 'settings/active-provider'],
			['Provider configuration', 'providers/providers-configuration'],
			['Generation', 'settings/generation'],
			['Autocomplete', 'settings/autocomplete'],
			['Agent', 'settings/agent'],
			['Agents', 'settings/agents'],
			['Skills', 'settings/skills'],
			['Terminal', 'settings/terminal'],
			['Chat UI', 'settings/chat-ui'],
			['Voice', 'voice/voice-settings'],
			['Notes', 'settings/notes'],
			['Conversations', 'settings/conversations'],
			['About', 'settings/about'],
		];
		for (const [heading, rel] of groups) {
			try { await settingsShot(settingsPage, heading, rel + '.png', rec); } catch (e) {
				console.log(`[gallery]   settings group "${heading}" skipped: ${String(e.message).slice(0, 80)}`);
			}
		}
		// Memory section + edit-fact modal.
		try {
			await settingsShot(settingsPage, 'Memory', 'context/memory-settings.png', rec);
			await settingsPage.evaluate(() => {
				const row = Array.from(document.querySelectorAll('.setting-item')).find((r) => r.textContent?.includes('Coffee ratio'));
				const editBtn = row?.querySelector('.clickable-icon, button');
				editBtn?.click();
			});
			await settingsPage.waitForTimeout(700);
			await shoot(settingsPage, 'context/memory-edit-modal.png', {}, rec);
			await settingsPage.keyboard.press('Escape');
			await settingsPage.waitForTimeout(300);
		} catch (e) {
			console.log(`[gallery]   memory section skipped: ${String(e.message).slice(0, 80)}`);
		}
		// Ollama provider card (no API key by design) + custom provider modal.
		try {
			await settingsPage.evaluate(() => {
				const el = Array.from(document.querySelectorAll('.setting-item-heading, h3')).find((e) => e.textContent?.includes('Provider configuration'));
				el?.scrollIntoView({ block: 'start' });
			});
			await settingsPage.waitForTimeout(500);
			const ollama = settingsPage.locator('.ai-provider-settings').filter({ hasText: 'Ollama' }).last();
			await ollama.scrollIntoViewIfNeeded().catch(() => {});
			await settingsPage.waitForTimeout(400);
			await parkMouse(settingsPage);
			await ollama.screenshot({ path: resolve(GALLERY, 'providers/provider-ollama.png') });
			rec.files.push('providers/provider-ollama.png');
			await settingsPage.evaluate(() => {
				const btn = Array.from(document.querySelectorAll('button')).find((b) => /add custom provider/i.test(b.textContent ?? ''));
				btn?.click();
			});
			await settingsPage.waitForTimeout(700);
			await shoot(settingsPage, 'providers/custom-provider-modal.png', {}, rec);
			await settingsPage.keyboard.press('Escape');
		} catch (e) {
			console.log(`[gallery]   provider extras skipped: ${String(e.message).slice(0, 80)}`);
		}
		// MCP client servers + add-server modal + Curtis's own MCP server.
		try {
			await settingsShot(settingsPage, 'MCP', 'mcp/mcp-settings.png', rec);
			await settingsPage.evaluate(() => {
				const btn = Array.from(document.querySelectorAll('button')).find((b) => /add server/i.test(b.textContent ?? ''));
				btn?.click();
			});
			await settingsPage.waitForTimeout(700);
			await shoot(settingsPage, 'mcp/mcp-add-server-modal.png', {}, rec);
			await settingsPage.keyboard.press('Escape');
			await settingsPage.waitForTimeout(300);
		} catch (e) {
			console.log(`[gallery]   mcp section skipped: ${String(e.message).slice(0, 80)}`);
		}
		// GCP connector.
		try { await settingsShot(settingsPage, 'GCP', 'settings/gcp-connection.png', rec); } catch { /* optional */ }
		await closeSettings(settingsPage);
	});

	await step('settings-extended', 'settings', 'Settings — MCP client + Curtis’s own MCP server + GCP', 'MCP servers you already run can be added as agent tools; Curtis can also SERVE the vault itself over localhost MCP; GCP connects read-only Cloud Storage.', async (rec) => {
		let settingsPage = await openPluginSettings(ctx);
		const reopen = async () => {
			try { await settingsPage.evaluate(() => 1); } catch { settingsPage = await openPluginSettings(ctx); }
			return settingsPage;
		};
		// Client side: 'MCP servers' + the add-server modal.
		try {
			await settingsShot(settingsPage, 'MCP servers', 'mcp/mcp-client-servers.png', rec);
		} catch { try { await settingsShot(settingsPage, 'Enable MCP', 'mcp/mcp-client-servers.png', rec); } catch { /* optional */ } }
		try {
			await settingsPage.evaluate(() => {
				const b = Array.from(document.querySelectorAll('button, .clickable-icon')).find((x) => /add mcp server/i.test(x.textContent ?? ''));
				b?.click();
			});
			await settingsPage.waitForTimeout(800);
			await shoot(settingsPage, 'mcp/mcp-add-server-modal.png', {}, rec);
			await settingsPage.keyboard.press('Escape');
			await sleep(500);
		} catch (e) { console.log(`[gallery]   add-server modal skipped: ${String(e.message).slice(0, 80)}`); }
		// Curtis's own MCP server: enable, status, and a real localhost probe.
		try {
			settingsPage = await reopen();
			await settingsShot(settingsPage, 'MCP server', 'mcp/mcp-server-settings.png', rec);
			const enabled = await settingsPage.evaluate(() => {
				const row = Array.from(document.querySelectorAll('.setting-item')).find((r) => /enable mcp server/i.test(r.textContent ?? ''));
				const tog = row?.querySelector('input[type="checkbox"], .checkbox-container');
				if (!tog) return false;
				if (tog instanceof HTMLElement && tog.classList.contains('checkbox-container')) { tog.click(); return true; }
				const cb = tog;
				if (cb instanceof HTMLInputElement && !cb.checked) { cb.click(); return true; }
				return false;
			});
			if (enabled) {
				await sleep(1800);
				try {
					const res = await fetch(`http://127.0.0.1:24783/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'gallery-probe', version: '0' } } }) });
					rec.mcpProbe = `POST /mcp → HTTP ${res.status} (server is listening)`;
				} catch (e) {
					rec.mcpProbe = `probe failed: ${String(e.message).slice(0, 80)}`;
				}
				await settingsShot(settingsPage, 'Server status', 'mcp/mcp-server-status.png', rec);
			}
		} catch (e) { console.log(`[gallery]   mcp server section skipped: ${String(e.message).slice(0, 80)}`); }
		// GCP connector.
		try {
			settingsPage = await reopen();
			await settingsShot(settingsPage, 'GCP connection', 'settings/gcp-connection.png', rec);
		} catch (e) { console.log(`[gallery]   gcp section skipped: ${String(e.message).slice(0, 80)}`); }
		await closeSettings(settingsPage);
	});

	await step('import-flow', 'import', 'Chat importer','ChatGPT/Claude exports, .curt files, and role-labeled markdown in; every conversation lands as a markdown note under AI/Conversations/. Real import of a role-labeled JSON through the OS file picker.', async (rec) => {
		// The import "dialog" is the OS file picker over a hidden input —
		// drive it with Playwright's filechooser event and a real file.
		const exportPath = resolve(tmpdir(), 'gallery-chat-export.json');
		writeFileSync(exportPath, JSON.stringify([
			{ role: 'user', content: 'Gallery import test — what is the .curt format?' },
			{ role: 'assistant', content: 'A .curt file is a zip of markdown envelopes: one per conversation, plus prompts, memory, and agent configs. Everything human-readable.' },
			{ role: 'user', content: 'Import me into the vault.' },
		]));
		const before = readdirSync(resolve(VAULT, 'AI', 'Conversations')).length;
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser', { timeout: 10000 }),
			page.evaluate(() => window.app.commands.executeCommandById('curtis:import-chats')),
		]);
		await chooser.setFiles(exportPath);
		// A single clean import reports via Notice — no summary modal. Shoot
		// the modal when it exists, then prove the landing by file count.
		await page.waitForSelector('.modal-container', { timeout: 12000 }).catch(() => {});
		await page.waitForTimeout(1200);
		const modalUp = await evalSafe(page, () => !!document.querySelector('.modal-container'));
		if (modalUp) {
			await parkMouse(page);
			await shoot(page, 'import/import-summary.png');
			await page.keyboard.press('Escape');
			await page.waitForTimeout(500);
		} else {
			console.log('[gallery]   import reported via Notice (no summary modal) — clean single-file import');
		}
		// The landed note — conversations are markdown in AI/Conversations/.
		let importedNote = null;
		try {
			const files = readdirSync(resolve(VAULT, 'AI', 'Conversations')).filter((f) => f.endsWith('.md'));
			if (files.length > before) importedNote = files[files.length - 1];
		} catch { /* dir missing */ }
		if (importedNote) {
			createdFiles.push(join('AI', 'Conversations', importedNote));
			await page.evaluate((p) => window.app.workspace.openLinkText(p, ''), join('AI', 'Conversations', importedNote));
			await page.waitForTimeout(1200);
			await parkMouse(page);
			await shoot(page, 'import/imported-conversation-note.png');
			await page.evaluate(() => window.app.commands.executeCommandById('curtis:open-chat'));
			await page.waitForTimeout(700);
		}
		// Claude Code setup import (MCP servers, skills, subagents, CLAUDE.md).
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:import-claude-setup'));
		await page.waitForSelector('.modal-container', { timeout: 10000 }).catch(() => {});
		await page.waitForTimeout(700);
		await parkMouse(page);
		await shoot(page, 'import/claude-setup-import.png');
		await page.keyboard.press('Escape');
		await page.waitForTimeout(400);
		// .curt — export all, then open the archive in the .curt viewer.
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:export-all-chats-curt'));
		await page.waitForTimeout(2500);
		let curtPath = null;
		try {
			for (const root of [VAULT, resolve(VAULT, 'AI'), resolve(VAULT, 'AI', 'Exports')]) {
				const found = readdirSync(root).filter((f) => f.endsWith('.curt')).map((f) => join(root, f));
				for (const f of found) {
					if (statSync(f).mtimeMs > Date.now() - 120000) curtPath = f;
				}
			}
		} catch { /* no dir */ }
		if (curtPath) {
			const rel = curtPath.slice(VAULT.length + 1).replace(/\\/g, '/');
			createdFiles.push(rel);
			rec.curtFile = rel;
			await page.evaluate((p) => window.app.workspace.openLinkText(p, ''), rel);
			await page.waitForTimeout(1500);
			await parkMouse(page);
			await shoot(page, 'import/curt-viewer.png');
		}
		await page.evaluate(switchToConv, 'Weekly review');
	});

	await step('selection-menu', 'writing', 'Selection actions', 'Right-click any selection in a note: explain, summarize, refactor, translate, code review — plus custom actions.', async (rec) => {
		await page.evaluate(() => window.app.workspace.openLinkText('Projects/Curtis AI Chat.md', ''));
		await page.waitForTimeout(900);
		await page.evaluate(() => {
			const active = window.app.workspace.getMostRecentLeaf()?.view;
			const editor = active?.editor;
			editor.setSelection({ line: 2, ch: 0 }, { line: 2, ch: editor.getLine(2).length });
		});
		// Right-click the selection itself — the menu must carry the AI actions.
		const selBox = await page.locator('.cm-selectionBackground').first().boundingBox().catch(() => null);
		const menuAt = selBox ?? (await page.locator('.markdown-source-view').first().boundingBox().catch(() => null));
		if (menuAt) {
			await page.mouse.click(menuAt.x + menuAt.width / 2, menuAt.y + menuAt.height / 2, { button: 'right' });
			await page.waitForTimeout(900);
			await parkMouse(page);
			await shoot(page, 'writing/selection-context-menu.png');
			await page.keyboard.press('Escape');
		}
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:open-chat'));
		await page.waitForTimeout(600);
	});

	await step('notifications-voice', 'voice', 'Voice I/O + notifications', 'Whisper dictation in, read-aloud with the sentence player; desktop toasts when a reply lands while you are away (in-app notice on mobile).', async (rec) => {
		// Mic button + composer in the chat.
		await page.evaluate(scrollChat, 'bottom');
		await page.waitForTimeout(400);
		await shoot(page, 'voice/composer-mic.png');
		const settingsPage = await openPluginSettings(ctx);
		try { await settingsShot(settingsPage, 'Voice', 'voice/voice-settings.png', rec); } catch { /* covered above */ }
		try { await settingsShot(settingsPage, 'Notify', 'voice/notification-settings.png', rec); } catch {
			await settingsShot(settingsPage, 'Chat UI', 'voice/notification-settings.png', rec);
		}
		await closeSettings(settingsPage);
	});

	// ---- theme matrix: full-window chat in 11 themes ----
	await step('theme-matrix', 'themes', 'Theme matrix — 11 themes', 'The same conversation rendered full-window in default dark/light and the nine most-installed community themes.', async (rec) => {
		// Bind the fixture BEFORE creating the center leaf — the view binds the
		// current conversation at onOpen, and a later re-render is a no-op on a
		// fresh leaf.
		await page.evaluate(() => {
			const ws = window.app.workspace;
			const p = window.app.plugins.plugins['curtis'];
			const hero = p.conversationStore.getAllConversations().find((c) => (c.messages[0]?.content ?? '').startsWith('Weekly review'));
			if (hero) p.conversationStore.setCurrentConversation(hero.id);
			const leaf = ws.createLeafInParent(ws.rootSplit, ws.rootSplit.children.length);
			leaf.setViewState({ type: 'curtis-chat', active: true });
			const collect = (node, out) => {
				if (!node) return out;
				if (node.view) { out.push(node); return out; }
				for (const c of node.children ?? []) collect(c, out);
				return out;
			};
			const centerLeaves = [];
			for (const child of ws.rootSplit.children ?? []) collect(child, centerLeaves);
			const chatLeaves = new Set(ws.getLeavesOfType('curtis-chat'));
			for (const l of centerLeaves) if (!chatLeaves.has(l)) { try { l.detach(); } catch { /* */ } }
			for (const l of ws.getLeavesOfType('curtis-chat')) if (l !== leaf) { try { l.detach(); } catch { /* */ } }
			try { ws.leftSplit?.collapse(); } catch { /* */ }
			try { ws.rightSplit?.collapse(); } catch { /* */ }
		});
		await page.evaluate(() => {
			const el = document.querySelector('.workspace-leaf-content[data-type="curtis-chat"]')?.closest('.workspace-leaf');
			if (el) { el.style.flex = '0 0 1800px'; el.style.maxWidth = 'none'; }
		});
		await page.waitForTimeout(800);
		// A fresh pane starts a NEW conversation at onOpen — re-bind the fixture
		// explicitly (setCurrentConversation + switchConversation + refresh).
		await page.evaluate(switchToConv, 'Weekly review');
		await page.evaluate(scrollChat, 'top');
		await sleep(900);
		for (const t of ['dark', 'light', ...THEMES]) {
			const slug = t.toLowerCase().replace(/\s+/g, '-');
			const ok = await setTheme(page, t);
			if (!ok) { console.log(`[gallery]   theme "${t}" unavailable — skipped`); continue; }
			// Community themes keep the current light/dark MODE — pin dark so
			// every dark-capable theme is judged in its flagship variant.
			if (!(t === 'dark' || t === 'light')) {
				await page.evaluate(() => {
					document.body.removeClass('theme-light');
					document.body.addClass('theme-dark');
				});
			}
			await sleep(950);
			await parkMouse(page);
			await shoot(page, `themes/chat-${slug}.png`);
		}
		await setTheme(page, 'dark');
		await sleep(400);
	});

	await step('gallery-hero-themes', 'themes', 'Theme details — composer close-ups', 'The composer and message bubbles in three flagships: default dark, Minimal, Royal Velvet (cropped to the chat surface).', async (rec) => {
		// Restore a normal layout: chat + daily note.
		await page.evaluate(() => {
			const ws = window.app.workspace;
			for (const l of ws.getLeavesOfType('curtis-chat')) try { l.detach(); } catch { /* */ }
		});
		await page.evaluate(openChatAndRender);
		await page.evaluate(switchToConv, 'Weekly review');
		await page.evaluate(() => window.app.workspace.openLinkText('Daily/2026-10-02.md', ''));
		await page.waitForTimeout(900);
		for (const t of ['dark', 'Minimal', 'Royal Velvet']) {
			const slug = t.toLowerCase().replace(/\s+/g, '-');
			await setTheme(page, t);
			await sleep(900);
			await parkMouse(page);
			await shoot(page, `themes/composer-${slug}.png`, { clipSel: '.workspace-leaf-content[data-type="curtis-chat"]' });
		}
		await setTheme(page, 'dark');
		await sleep(400);
	});

	await shutdownInstance(inst);
	console.log('[gallery] === desktop pass done ===');
}

// ===========================================================================
// MOBILE PASS — fresh boot, 390x844 @2x DPR emulation, desktop chrome stripped
// ===========================================================================

async function mobilePass() {
	console.log('[gallery] === mobile pass ===');
	await mock.start();
	bootstrapVault();
	overlaySettings();
	registerDemoVault();
	await killObsidian();
	rmSync(resolve(VAULT, '.obsidian', 'workspace.json'), { force: true });

	const inst = await bootInstance(PORT + 1, { width: 500, height: 900 });
	const ctx = inst.ctx;
	let page = inst.page;

	// Phone metrics at 2x DPR, then reload so the layout reflows.
	await page.evaluate(() => {
		const p = window.app.plugins.plugins['curtis'];
		p.settings.chatViewPosition = 'left';
		p.saveSettings();
	});
	const cdp = await ctx.newCDPSession(page);
	await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
	await page.evaluate(() => location.reload());
	page = await waitForVaultPage(ctx, () => !!window.app?.plugins?.plugins?.['curtis']?.conversationStore, 45000, 'phone reload');
	await waitForVaultPage(ctx, () => !!window.app?.commands?.commands?.['curtis:open-chat'], 15000, 'commands (phone)');
	await page.addStyleTag({ content: HIDE_TOASTS });

	// Strip desktop chrome ONCE at boot — every phone shot is full-bleed app
	// surface (the original per-step strip broke when its step failed first).
	const stripChrome = async () => page.addStyleTag({
		content: `
			.workspace-ribbon, .workspace-split.mod-root, .status-bar,
			.titlebar, .titlebar-inner, .titlebar-button-container, .workspace-sidedock-vault-profile,
			.workspace-tabs .workspace-tab-header-container { display: none !important; }
			.workspace-split.mod-left-split { width: 100% !important; max-width: 100% !important; border: none !important; }
			.workspace-leaf-content[data-type="curtis-chat"] { width: 100% !important; }
			.workspace-tabs { flex: 1 !important; }
		`,
	});
	await stripChrome();

	await step('mobile-chat', 'mobile', 'Phone — conversation', 'The full chat at phone width (390×844): bubbles, pills, composer — the same view, reflowed.', async (rec) => {
		// The store's file index loads async after boot — wait for the fixture
		// to be visible before binding.
		let heroIndexed = false;
		for (let i = 0; i < 30 && !heroIndexed; i++) {
			heroIndexed = await evalSafe(page, () => {
				const p = window.app.plugins.plugins['curtis'];
				return p.conversationStore.getAllConversations().some((c) => (c.messages[0]?.content ?? '').startsWith('Weekly review'));
			});
			if (!heroIndexed) await sleep(1000);
		}
		if (!heroIndexed) throw new Error('fixture conversations never indexed on the phone pass');
		await page.evaluate(() => window.app.workspace.getLeavesOfType('curtis-chat').forEach((l) => l.detach()));
		await page.evaluate(openChatAndRender);
		// A fresh phone pane starts a NEW conversation at onOpen — re-bind the
		// fixture explicitly instead of trusting the open-time binding.
		await page.evaluate(switchToConv, 'Weekly review');
		await waitForVaultPage(ctx, () => document.body.innerText.includes('Week of Sep 28'), 30000, 'phone hero');
		await stripChrome();
		await page.evaluate(scrollChat, 'top');
		await page.waitForTimeout(900);
		await shootCdp(cdp, 'mobile/chat-top.png');
		await page.evaluate(scrollChat, 'bottom');
		await page.waitForTimeout(700);
		await shootCdp(cdp, 'mobile/chat-bottom.png');
	});

	await step('mobile-menus', 'mobile', 'Phone — history, model picker, slash, mention', 'Every picker reflows to the sheet style at phone width.', async (rec) => {
		await jsClick(page, '.ai-chat-topbar-tools button:nth-child(1)');
		await page.waitForSelector('.ai-history-dropdown', { timeout: 8000 }).catch(() => {});
		await page.waitForTimeout(600);
		await shootCdp(cdp, 'mobile/history.png');
		await page.keyboard.press('Escape');
		await page.waitForTimeout(400);
		await jsClick(page, '.ai-model-picker-btn');
		await page.waitForTimeout(1000);
		await shootCdp(cdp, 'mobile/model-picker.png');
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		await page.click('.ai-chat-input');
		await page.type('.ai-chat-input', '/', { delay: 60 });
		await page.waitForSelector('.ai-slash-menu-item', { timeout: 8000 });
		await page.waitForTimeout(500);
		await shootCdp(cdp, 'mobile/slash-menu.png');
		await page.fill('.ai-chat-input', '');
		await page.keyboard.press('Escape');
		await page.type('.ai-chat-input', '@da', { delay: 60 });
		await page.waitForSelector('.ai-mention-menu-item', { timeout: 8000 }).catch(() => {});
		await page.waitForTimeout(500);
		await shootCdp(cdp, 'mobile/mention-popup.png');
		await page.fill('.ai-chat-input', '');
	});

	await step('mobile-arena', 'mobile', 'Phone — arena duel', 'The arena columns stack and stream at phone width.', async (rec) => {
		await page.evaluate(() => window.app.commands.executeCommandById('curtis:new-chat'));
		await page.waitForTimeout(700);
		mock.clear();
		await page.click('.ai-chat-arena-btn');
		await page.waitForSelector('.ai-arena-picker-modal', { timeout: 8000 });
		await page.waitForTimeout(500);
		await shootCdp(cdp, 'mobile/arena-picker.png');
		await page.evaluate(() => {
			const row = Array.from(document.querySelectorAll('.ai-arena-picker-row')).find((r) => r.textContent?.includes('Mock Mini'));
			row?.click();
		});
		await page.waitForTimeout(400);
		await page.locator('.ai-arena-picker-start').click();
		await page.waitForTimeout(500);
		mock.stage(
			{ model: 'mock-pro', kind: 'sse', paceMs: 30, firstDelayMs: 400, chunks: 'Run both. Your prompt, your workload, your call — not a benchmark average.'.split(/(?<=\s)/) },
			{ model: 'mock-mini', kind: 'sse', paceMs: 60, firstDelayMs: 800, chunks: 'Two answers beat one opinion.'.split(/(?<=\s)/) },
		);
		await page.click('.ai-chat-input');
		await page.type('.ai-chat-input', 'Arena vs leaderboard, one sentence each.', { delay: 12 });
		await page.click('.ai-chat-send-btn');
		await page.waitForTimeout(3200);
		await shootCdp(cdp, 'mobile/arena-streaming.png');
	});

	await step('mobile-video', 'mobile', 'Phone — video: send + stream', 'Typing, sending, and a streamed reply at phone width.', async (rec) => {
		await video(page, 'mobile/videos/phone-chat-send', async () => {
			await page.evaluate(() => window.app.commands.executeCommandById('curtis:new-chat'));
			await page.waitForTimeout(600);
			mock.clear();
			mock.stage({ kind: 'sse', paceMs: 40, firstDelayMs: 450, chunks: 'Phone-first: the composer sits in the thumb zone, the send button never moves, and long replies collapse behind a sticky input.'.split(/(?<=\s)/) });
			await page.click('.ai-chat-input');
			await page.type('.ai-chat-input', 'How does the chat reflow on mobile?', { delay: 26 });
			await page.click('.ai-chat-send-btn');
			await page.waitForTimeout(6500);
		}, { gif: true });
		// The recorder opens its own CDP session on the page — inherits the emulation.
		rec.videos = ['mobile/videos/phone-chat-send'];
	});

	await step('mobile-themes', 'mobile', 'Phone — themes', 'The chat in default light plus two community themes at phone width.', async (rec) => {
		await page.evaluate(scrollChat, 'top');
		await setTheme(page, 'light');
		await page.waitForTimeout(900);
		await shootCdp(cdp, 'mobile/theme-light.png');
		await setTheme(page, 'Minimal');
		await page.waitForTimeout(900);
		await shootCdp(cdp, 'mobile/theme-minimal.png');
		await setTheme(page, 'Royal Velvet');
		await page.waitForTimeout(900);
		await shootCdp(cdp, 'mobile/theme-royal-velvet.png');
		await setTheme(page, 'dark');
		await page.waitForTimeout(400);
	});

	await step('mobile-settings', 'mobile', 'Phone — settings', 'The plugin settings emulated at phone width: provider list and scheduled runs card.', async (rec) => {
		await page.evaluate(() => {
			window.app.setting.open();
			window.app.setting.openTabById('curtis');
		});
		const settingsPage = await openPluginSettings(ctx);
		const scdp = await ctx.newCDPSession(settingsPage);
		await scdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
		await settingsPage.waitForTimeout(1200);
		await settingsPage.evaluate(() => {
			const els = Array.from(document.querySelectorAll('.setting-item-heading, h3, h2, .setting-item-name'));
			const el = els.find((e) => e.textContent?.includes('Provider configuration'));
			el?.scrollIntoView({ block: 'start' });
		});
		await settingsPage.waitForTimeout(700);
		await shootCdp(scdp, 'mobile/settings-providers.png');
		await settingsPage.evaluate(() => {
			const els = Array.from(document.querySelectorAll('.setting-item-heading, h3, h2, .setting-item-name'));
			const el = els.find((e) => e.textContent?.includes('Morning vault digest'));
			el?.scrollIntoView({ block: 'center' });
		});
		await settingsPage.waitForTimeout(700);
		await shootCdp(scdp, 'mobile/settings-scheduled.png');
		await closeSettings(settingsPage);
	});

	await shutdownInstance(inst);
	console.log('[gallery] === mobile pass done ===');
}

// ===========================================================================
// INDEX.md — the categorized catalog, generated from the manifest
// ===========================================================================

const CATEGORY_META = {
	setup: { title: 'Capture setup', docs: '' },
	chat: { title: 'Chat core', docs: 'docs/MULTIPANE.md, docs/SLASH_COMMANDS.md, docs/MENTIONS.md, docs/IMAGES.md, docs/SEARCH.md' },
	agent: { title: 'Agent & tools', docs: 'docs/AGENT.md' },
	agents: { title: 'Named agents & skills', docs: 'docs/AGENTS.md, docs/SKILLS.md' },
	swarm: { title: 'Swarm mode', docs: 'docs/SWARM.md' },
	scheduled: { title: 'Scheduled runs', docs: 'docs/SCHEDULED_RUNS.md' },
	terminal: { title: 'Terminal pane', docs: 'docs/TERMINAL.md' },
	mcp: { title: 'MCP (client + server)', docs: 'docs/MCP_SERVER.md' },
	import: { title: 'Import / export', docs: 'docs/IMPORT.md' },
	writing: { title: 'Writing tools', docs: 'docs/DIFF_REWRITE.md, docs/AUTOCOMPLETE.md, docs/SELECTION_ACTIONS.md' },
	voice: { title: 'Voice & notifications', docs: 'docs/VOICE.md, docs/NOTIFICATIONS.md' },
	context: { title: 'Context & memory', docs: 'docs/MEMORY.md, docs/VAULT_RETRIEVAL.md, docs/LINK_PREVIEWS.md' },
	providers: { title: 'Providers', docs: 'docs/PROVIDERS.md' },
	settings: { title: 'Settings surface', docs: 'docs/RUNBOOK.md' },
	themes: { title: 'Themes', docs: 'theme audit across default + community themes' },
	videos: { title: 'Motion demos', docs: 'short MP4 + GIF captures of live flows' },
	mobile: { title: 'Phone (390×844)', docs: 'mobile pass at phone width, 2x DPR' },
	arena: { title: 'Multi-model arena', docs: 'docs/ARENA.md' },
	multipane: { title: 'Multi-pane chat', docs: 'docs/MULTIPANE.md' },
};

function writeIndex() {
	const groups = new Map();
	for (const rec of Object.values(manifest.steps)) {
		if (!rec.files?.length) continue;
		if (!groups.has(rec.group)) groups.set(rec.group, []);
		groups.get(rec.group).push(rec);
	}
	const lines = [
		'# Curtis AI Chat — feature gallery',
		'',
		`Auto-captured ${new Date().toISOString().slice(0, 10)} from a live Obsidian session on the demo vault (real UI, real stores, real shells).`,
		'Stills marked **seeded** render fixture conversations through the real view; **live** scenes ran through the plugin’s real pipelines — streaming over a local OpenAI-compatible mock endpoint, or real tool execution in the vault.',
		'',
		'| Category | Feature coverage |',
		'|---|---|',
	];
	for (const [group, meta] of Object.entries(CATEGORY_META)) {
		if (!groups.has(group)) continue;
		const files = groups.get(group).flatMap((r) => r.files);
		const vids = files.filter((f) => f.endsWith('.mp4')).length;
		lines.push(`| **${meta.title}** | ${files.length - vids} stills, ${vids} videos — ${meta.docs} |`);
	}
	lines.push('', '---', '');
	for (const [group, recs] of groups) {
		const meta = CATEGORY_META[group] ?? { title: group, docs: '' };
		lines.push(`## ${meta.title}`, '');
		for (const r of recs) {
			lines.push(`### ${r.title}`, '');
			if (r.desc) lines.push(`${r.desc}`, '');
			if (r.error) lines.push(`> ⚠️ partial: ${r.error}`, '');
			for (const f of r.files) {
				const isVid = f.endsWith('.mp4') || f.endsWith('.gif');
				if (isVid && f.endsWith('.gif')) continue; // list the mp4, note the gif
				lines.push(`- ${isVid ? '🎬' : '🖼️'} [\`${f}\`](${f})${f.endsWith('.mp4') ? ' (+ .gif)' : ''}`);
			}
			lines.push('');
		}
	}
	lines.push('---', '', `Manifest with per-capture timing and status: [shots-manifest.json](shots-manifest.json).`);
	writeFileSync(resolve(GALLERY, 'INDEX.md'), lines.join('\n'));
	console.log('[gallery] INDEX.md written');
}

// ===========================================================================
// Cleanup + main
// ===========================================================================

async function cleanupVaultFiles() {
	for (const rel of createdFiles) {
		try { rmSync(resolve(VAULT, rel), { force: true }); } catch { /* best effort */ }
	}
	// Scheduled-run notes are orphans once data.json restores over the seeded
	// job — remove every digest the gallery fired.
	try {
		const scheduledDir = resolve(VAULT, 'AI', 'Scheduled');
		for (const f of readdirSync(scheduledDir)) {
			if (f.startsWith('Morning vault digest')) rmSync(resolve(scheduledDir, f), { force: true });
		}
	} catch { /* no dir */ }
	// Fixture conversations are AI/Conversations notes titled from their first
	// user message — remove exactly those, leave every other conversation.
	const convDir = resolve(VAULT, 'AI', 'Conversations');
	const markers = [
		'Weekly review — summarize my daily notes',
		'Summarize the attached daily note',
		'What does this token-usage chart',
		'Remind me how I take my coffee',
		'Which of my notes mention the calculator',
		'Audit my daily notes and file what changed',
		'Gallery import test',
		'Read the three daily notes under',
		'Spawn a follower to read my daily notes',
	];
	try {
		for (const f of readdirSync(convDir)) {
			if (!f.endsWith('.md')) continue;
			if (markers.some((m) => f.includes(m.slice(0, 30)))) rmSync(resolve(convDir, f), { force: true });
		}
	} catch { /* no dir */ }
}

async function main() {
	const watchdog = setTimeout(() => {
		console.error('[gallery] watchdog: 50 minutes exceeded — aborting, writing index');
		restoreLaunchVault();
		writeIndex();
		try { execSync('taskkill /IM ObsidianSmoke.exe /F', { stdio: 'ignore' }); } catch { /* */ }
		process.exit(9);
	}, 50 * 60 * 1000);
	watchdog.unref?.();

	console.log('[gallery] closing Obsidian if running…');
	await killObsidian();
	let failure = null;
	try {
		const wantsDesktop = ONLY.length === 0 || ONLY.some((s) => !s.startsWith('mobile'));
		const wantsMobile = ONLY.length === 0 || ONLY.some((s) => s.startsWith('mobile'));
		if (wantsDesktop) {
			await desktopPass().catch((e) => { failure = failure ?? e; console.error('[gallery] desktop pass failed:', e.message); });
		}
		if (wantsMobile) {
			await mobilePass().catch((e) => { failure = failure ?? e; console.error('[gallery] mobile pass failed:', e.message); });
		}
	} finally {
		restoreSettings();
		await cleanupVaultFiles();
		restoreLaunchVault();
		writeIndex();
		saveManifest();
	}
	clearTimeout(watchdog);
	if (failure) {
		console.error('[gallery] finished with failures — assets kept, manifest + INDEX.md written');
		process.exit(2);
	}
	process.exit(0);
}

main().catch((e) => {
	console.error('[gallery] fatal:', e);
	restoreSettings();
	restoreLaunchVault();
	try { execSync('taskkill /IM ObsidianSmoke.exe /F', { stdio: 'ignore' }); } catch { /* */ }
	process.exit(1);
});
