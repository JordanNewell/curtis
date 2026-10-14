// Offline transport smoke: a local OpenAI-compatible TEST SERVER on 127.0.0.1,
// registered as a custom provider, driven through the plugin's REAL network
// stack. Complements the other suites:
//   - v2-smoke/panes fake callAI in-page — they never touch a socket.
//   - smoke:providers is live and paid — its job is seed drift on real catalogs.
// This one is free, deterministic, and covers what both skip: the transport
// layer against a real socket — auth header, request body, SSE streaming,
// buffered fallback, usage round-trip, and error handling.
//
// Assertions read BOTH sides:
//   server — method, Authorization header, model id, stream flag, user text
//   client — stored reply text, usage in the conversation store, DOM badge
//
// Transports exercised (desktop): node-https (streamed send) and requestUrl
// (buffered send, streamResponse: false). Usage: npm run smoke:mock

import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = resolve(ROOT, 'demo-vault');
const PLUGIN_DIR = resolve(VAULT, '.obsidian/plugins/curtis');
const DEBUG_PORT = 9340;
const OBSIDIAN_EXE =
	process.env.OBSIDIAN_EXE ||
	'C:/tmp/obsidian-smoke/ObsidianSmoke.exe'; // smoke clone — never touches the live app

const MOCK_KEY = 'mock-secret-key';
const USAGE = { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 };

let pass = 0, fail = 0;
const ok = (cond, name, detail = '') => {
	const mark = cond ? 'PASS' : 'FAIL';
	console.log(`[${mark}] ${name}${detail && !cond ? ` — ${detail}` : ''}`);
	cond ? pass++ : fail++;
};

// Console gate: plugin:curtis errors fail the run even when every
// assertion passes. Anything else (theme ENOENTs, core Obsidian) is surfaced
// but never gates — same contract as the other suites.
const pluginErrors = [];
const watchPluginErrors = (text, url = '') => {
	const s = `${text}\n${url}`;
	if (!s.includes('plugin:curtis')) return;
	// M5 deliberately induces a 401; the view logs it (console.error) before
	// rendering the inline warning the assertions check for. Expected, handled.
	if (text.includes('[Curtis] Stream error:') && text.includes('Mock LLM API error (401)')) return;
	if (!pluginErrors.includes(text)) pluginErrors.push(text);
};
const reportConsoleGate = () => {
	if (pluginErrors.length > 0) {
		console.log(`[smoke] FAIL: ${pluginErrors.length} plugin console error(s):`);
		for (const e of pluginErrors) console.log(`[obsidian] ${e}`);
	} else {
		console.log('[smoke] console clean');
	}
};

// ---------------------------------------------------------------------------
// Mock server — OpenAI wire dialect, recorded for server-side asserts
// ---------------------------------------------------------------------------

const requests = []; // { path, auth, authOk, body, stream, tFirstByte, tLastByte }

function startMockServer() {
	const server = createServer((req, res) => {
		// CORS insurance — the transports that matter here (node-https,
		// requestUrl) bypass CORS, but nothing should depend on that.
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

		let raw = '';
		req.on('data', (c) => { raw += c; });
		req.on('end', () => {
			const auth = String(req.headers.authorization ?? '');
			const rec = {
				path: req.url,
				auth,
				authOk: auth === `Bearer ${MOCK_KEY}`,
				body: null,
				stream: false,
				tFirstByte: Date.now(),
				tLastByte: Date.now(),
			};

			if (req.method === 'GET' && req.url === '/v1/models') {
				requests.push(rec);
				console.log(`[mock] GET ${req.url} auth=${auth ? 'yes' : 'no'}`);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					data: [
						{ id: 'mock-pro', context_length: 8192 },
						{ id: 'mock-mini', context_length: 4096 },
					],
				}));
				return;
			}

			if (req.method === 'POST' && req.url === '/v1/chat/completions') {
				console.log(`[mock] POST ${req.url} auth=${auth ? auth.slice(0, 14) + '…' : 'none'}`);
				if (!rec.authOk) {
					requests.push(rec);
					res.writeHead(401, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
					return;
				}
				try { rec.body = JSON.parse(raw); } catch { rec.body = null; }
				const model = rec.body?.model ?? '?';
				const userText = [...(rec.body?.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '';
				rec.stream = rec.body?.stream === true;

				if (rec.stream) {
					// SSE in the full OpenAI chunk envelope — the plugin's
					// isOpenAIChunk guard requires a string id on every chunk,
					// so bare {choices:[…]} mocks are silently dropped.
					res.writeHead(200, { 'Content-Type': 'text/event-stream' });
					const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
					const chunk = (delta, extra = {}) => ({
						id: 'chatcmpl-mock',
						object: 'chat.completion.chunk',
						created: Math.floor(Date.now() / 1000),
						model,
						choices: [{ index: 0, delta, finish_reason: null }],
						...extra,
					});
					res.write(sse(chunk({ role: 'assistant', content: 'Mock streamed reply' })));
					setTimeout(() => {
						res.write(sse(chunk({ content: ` for ${model}.` })));
						res.write(sse(chunk({}, { choices: [], usage: USAGE })));
						res.write('data: [DONE]\n\n');
						rec.tLastByte = Date.now();
						res.end();
					}, 250);
				} else {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({
						id: 'chatcmpl-mock',
						object: 'chat.completion',
						created: Math.floor(Date.now() / 1000),
						model,
						choices: [{
							index: 0,
							message: { role: 'assistant', content: `Mock buffered reply for ${model} (got: ${userText}).` },
							finish_reason: 'stop',
						}],
						usage: USAGE,
					}));
					rec.tLastByte = Date.now();
				}
				requests.push(rec);
				return;
			}

			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: { message: `no mock route: ${req.method} ${req.url}` } }));
		});
	});
	return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

// ---------------------------------------------------------------------------
// Vault bootstrap (mirrors v2-smoke.mjs) + data.json backup/restore
// ---------------------------------------------------------------------------

let dataJsonBackup = null;

function bootstrapVault(port) {
	mkdirSync(PLUGIN_DIR, { recursive: true });
	for (const f of ['main.js', 'manifest.json', 'styles.css']) {
		cpSync(resolve(ROOT, f), resolve(PLUGIN_DIR, f));
	}
	const obsidianDir = resolve(VAULT, '.obsidian');
	writeFileSync(resolve(obsidianDir, 'community-plugins.json'), JSON.stringify(['curtis']));
	// Reset the persisted layout — prior runs leave floating windows behind and
	// a stale popout would swallow the chat tab.
	for (const f of ['workspace.json', 'workspace-mobile.json']) {
		rmSync(resolve(obsidianDir, f), { force: true });
	}
	if (!existsSync(resolve(obsidianDir, 'app.json'))) {
		writeFileSync(resolve(obsidianDir, 'app.json'), JSON.stringify({ livePreview: true, readableLineLength: true }));
	}

	// Deterministic settings overlay: the mock provider as the active one,
	// extraction features off so a send is exactly one chat request.
	const dataPath = resolve(PLUGIN_DIR, 'data.json');
	try { dataJsonBackup = readFileSync(dataPath, 'utf8'); } catch { dataJsonBackup = null; }
	let data = {};
	try { data = JSON.parse(dataJsonBackup ?? '{}'); } catch { data = {}; }
	data.onboardingCompleted = true;
	data.enableMemory = false;
	data.enableJournal = false;
	data.enableRag = false;
	data.enableAgent = false;
	data.activeProvider = 'mock-llm';
	data.activeModel = 'mock-pro';
	data.providerConfigs = {
		...(data.providerConfigs ?? {}),
		'mock-llm': { enabled: true, apiKey: MOCK_KEY, defaultModel: 'mock-pro' },
	};
	data.customProviders = [{
		id: 'mock-llm',
		name: 'Mock LLM',
		endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
		authType: 'bearer',
		autoDiscoverModels: true,
		models: [
			{ id: 'mock-pro', name: 'Mock Pro', contextLength: 8192 },
			{ id: 'mock-mini', name: 'Mock Mini', contextLength: 4096 },
		],
	}];
	writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function restoreDataJson() {
	if (dataJsonBackup === null) {
		rmSync(resolve(PLUGIN_DIR, 'data.json'), { force: true });
	} else {
		writeFileSync(resolve(PLUGIN_DIR, 'data.json'), dataJsonBackup);
	}
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
		for (const v of Object.values(d.vaults || {})) {
			if (v && typeof v === 'object') v.open = false;
		}
		if (originalLaunchVault) {
			for (const v of Object.values(d.vaults || {})) {
				if (v && v.path === originalLaunchVault.path) { v.open = true; break; }
			}
		}
		writeFileSync(p, JSON.stringify(d, null, 2));
	} catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Boot + attach (mirrors v2-smoke.mjs)
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDebugPort(ms) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
			if (res.ok) return true;
		} catch { /* not up yet */ }
		await sleep(500);
	}
	return false;
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

async function until(page, expr, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await page.evaluate(expr)) return true;
		await sleep(250);
	}
	throw new Error(`timeout: ${label}`);
}

const INSTALL_HELPERS = `(() => {
	window.__smoke = {
		plugin: () => window.app.plugins.plugins['curtis'],
		chatView: () => {
			const leaves = window.app.workspace.getLeavesOfType('curtis-chat');
			if (leaves.length === 0) throw new Error('no chat view open');
			return leaves[0].view;
		},
		async openChat() {
			window.app.commands.executeCommandById('curtis:open-chat');
			const deadline = Date.now() + 10000;
			while (Date.now() < deadline) {
				if (document.querySelector('.workspace-leaf-content[data-type="curtis-chat"]')) return true;
				await new Promise((r) => setTimeout(r, 200));
			}
			throw new Error('chat view never opened');
		},
	};
	return true;
})()`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const server = await startMockServer();
	const port = server.address().port;
	console.log(`[smoke] mock server on http://127.0.0.1:${port}`);

	bootstrapVault(port);
	registerDemoVault();
	try { execSync('taskkill /IM ObsidianSmoke.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	await sleep(2500);

	const child = spawn(OBSIDIAN_EXE, [
		VAULT,
		`--remote-debugging-port=${DEBUG_PORT}`,
		'--disable-backgrounding-occluded-windows',
		'--disable-background-timer-throttling',
		'--disable-renderer-backgrounding',
	], { detached: false, stdio: 'ignore' });

	if (!(await waitForDebugPort(25000))) { child.kill(); throw new Error('debug port never opened'); }
	let browser = null;
	for (let i = 0; i < 5 && !browser; i++) {
		try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`); }
		catch { await sleep(2500); }
	}
	if (!browser) { child.kill(); throw new Error('could not attach to the debug port'); }
	const ctx = browser.contexts()[0];

	const logLine = (m) => {
		if (m.type() !== 'error') return;
		console.log(`[obsidian] ${m.text().slice(0, 160)}`);
		watchPluginErrors(m.text(), m.location()?.url);
	};
	const pageError = (e) => watchPluginErrors(e?.stack ?? String(e));
	for (const p of ctx.pages()) { p.on('console', logLine); p.on('pageerror', pageError); }
	ctx.on('page', (p) => { p.on('console', logLine); p.on('pageerror', pageError); });

	let finished = false;
	browser.on('disconnected', () => {
		if (finished) return;
		console.error('[smoke] fatal: Obsidian (CDP) disconnected mid-run');
		restoreLaunchVault();
		restoreDataJson();
		process.exit(1);
	});
	setTimeout(() => {
		console.error('[smoke] fatal: watchdog timeout (4 min) — aborting');
		try { execSync('taskkill /IM ObsidianSmoke.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
		restoreLaunchVault();
		restoreDataJson();
		process.exit(1);
	}, 240000);

	let page = await waitForVaultPage(ctx, () => true, 30000, 'window');
	try {
		await page.getByRole('button', { name: /trust/i }).click({ timeout: 8000 });
		console.log('[smoke] dismissed trust-vault modal');
	} catch { /* already trusted */ }
	await page.evaluate(async () => {
		try { await window.app.plugins.enablePlugin('curtis'); } catch { /* already on */ }
	});
	page = await waitForVaultPage(
		ctx,
		() => !!window.app.plugins.plugins['curtis']?.conversationStore,
		30000,
		'plugin onload complete'
	);
	console.log('[smoke] plugin loaded');
	await page.evaluate(INSTALL_HELPERS);

	const convIds = [];
	try {
		await page.evaluate(() => __smoke.openChat());
		const viewReady = await page.evaluate(() => !!__smoke.chatView()?.messagesContainer);
		ok(viewReady, 'M0 chat view open');

		// --- M0: custom provider registered and active -------------------------
		const active = await page.evaluate(() => {
			const p = __smoke.plugin();
			return {
				activeProvider: p.settings.activeProvider,
				constructed: !!p.providerRegistry.getProvider('mock-llm'),
				authType: p.providerRegistry.getProvider('mock-llm')?.authType ?? null,
			};
		});
		ok(active.activeProvider === 'mock-llm' && active.constructed && active.authType === 'bearer',
			'M0 custom mock provider registered and active', JSON.stringify(active));

		// --- M1: auto-discovery pulled the mock catalog -------------------------
		await until(page,
			() => __smoke.plugin().providerRegistry.getProvider('mock-llm')?.models?.some((m) => m.id === 'mock-mini'),
			15000, 'model discovery');
		ok(true, 'M1 /models discovery lists the mock catalog');
		const modelsReq = requests.find((r) => r.path === '/v1/models');
		ok(!!modelsReq && modelsReq.authOk,
			'M1 discovery request carried the bearer key');

		// --- M2: streamed send through the real transport (node-https) ---------
		await page.evaluate(() => {
			__smoke.chatView().startNewChat();
			__smoke.chatView().inputEl.value = 'ping one';
		});
		convIds.push(await page.evaluate(() => __smoke.plugin().conversationStore.getCurrentConversation().id));
		await page.evaluate(() => __smoke.chatView().sendMessage());
		try {
			await until(page, () => {
				const conv = __smoke.plugin().conversationStore.getCurrentConversation();
				const last = conv.messages[conv.messages.length - 1];
				return last?.role === 'assistant' && last.content.includes('Mock streamed reply');
			}, 20000, 'streamed reply stored');
		} catch (e) {
			// Evidence dump: what did the server see, what does the store hold,
			// can the renderer reach the mock at all?
			const dump = await page.evaluate(async (port) => {
				const conv = __smoke.plugin().conversationStore.getCurrentConversation();
				const view = __smoke.chatView();
				let probe = 'fetch-threw';
				try {
					const r = await window.fetch(`http://127.0.0.1:${port}/v1/models`);
					probe = `HTTP ${r.status}`;
				} catch (err) { probe = `fetch-threw: ${err?.message}`; }
				// Raw Node-http receive probe: does a bare renderer request see
				// the SSE bytes and the end event at all?
				const raw = await new Promise((res2) => {
					try {
						const http = window.require('http');
						const rq = http.request({
							protocol: 'http:',
							hostname: '127.0.0.1',
							port,
							path: '/v1/chat/completions',
							method: 'POST',
							headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${'mock-secret-key'}` },
						}, (rs) => {
							let events = 0;
							let bytes = 0;
							let sawEnd = false;
							rs.on('data', (c) => { events++; bytes += c.length; });
							rs.on('end', () => {
								sawEnd = true;
								res2({ status: rs.statusCode, events, bytes, sawEnd });
							});
							rs.on('error', (e2) => res2({ status: rs.statusCode, events, bytes, sawEnd, err: String(e2) }));
						});
						rq.on('error', (e2) => res2({ err: String(e2) }));
						rq.end(JSON.stringify({ model: 'mock-pro', stream: true, messages: [{ role: 'user', content: 'raw probe' }] }));
					} catch (e2) { res2({ err: String(e2) }); }
				});
				return {
					messages: conv.messages.map((m) => ({ role: m.role, content: String(m.content).slice(0, 120) })),
					streamingContent: String(view.streamingContent ?? '(none)').slice(0, 120),
					dom: [...document.querySelectorAll('.ai-message-content')].map((el) => el.textContent.trim().slice(0, 80)),
					fetchProbe: probe,
					rawProbe: raw,
				};
			}, port).catch((err) => ({ dumpFailed: String(err) }));
			console.log(`[smoke] M2 diagnostic — server saw: ${JSON.stringify(requests.map((r) => ({ p: r.path, auth: r.auth.slice(0, 14), stream: r.stream })))}`);
			console.log(`[smoke] M2 diagnostic — page: ${JSON.stringify(dump)}`);
			throw e;
		}
		const m2conv = await page.evaluate(() => {
			const conv = __smoke.plugin().conversationStore.getCurrentConversation();
			return conv.messages[conv.messages.length - 1];
		});
		ok(m2conv.content === 'Mock streamed reply for mock-pro.',
			'M2 streamed send renders the full canned reply', JSON.stringify(m2conv.content));

		const chatReq = requests.filter((r) => r.path === '/v1/chat/completions').at(-1);
		ok(chatReq.auth === `Bearer ${MOCK_KEY}`, 'M2 server saw the bearer key');
		ok(chatReq.body?.model === 'mock-pro' && chatReq.stream === true
			&& String(chatReq.body?.messages?.at(-1)?.content).includes('ping one'),
			'M2 server saw model id, stream flag, and the user text',
			JSON.stringify({ model: chatReq.body?.model, stream: chatReq.stream }));
		const streamedGapMs = chatReq.tLastByte - chatReq.tFirstByte;
		console.log(`[smoke] M2 sse span: ${streamedGapMs}ms (two deltas 250ms apart)`);

		// --- M3: usage round-trip into the store + DOM badge --------------------
		const m3 = await page.evaluate(() => {
			const conv = __smoke.plugin().conversationStore.getCurrentConversation();
			const last = conv.messages[conv.messages.length - 1];
			return {
				tokens: last?.tokens ?? null,
				badge: [...document.querySelectorAll('.ai-message-info')].map((el) => el.textContent).join('|'),
			};
		});
		ok(m3.tokens?.promptTokens === 12 && m3.tokens?.completionTokens === 34 && m3.tokens?.totalTokens === 46,
			'M3 SSE usage chunk landed in the stored message', JSON.stringify(m3.tokens));
		ok(m3.badge.includes('46 tok'), 'M3 token badge shows the total in the DOM', m3.badge);

		// --- M4: buffered send via requestUrl (streamResponse off) --------------
		await page.evaluate(async () => {
			__smoke.plugin().settings.streamResponse = false;
			await __smoke.plugin().saveSettings();
			__smoke.chatView().startNewChat();
			__smoke.chatView().inputEl.value = 'ping two';
		});
		convIds.push(await page.evaluate(() => __smoke.plugin().conversationStore.getCurrentConversation().id));
		await page.evaluate(() => __smoke.chatView().sendMessage());
		await until(page, () => {
			const conv = __smoke.plugin().conversationStore.getCurrentConversation();
			const last = conv.messages[conv.messages.length - 1];
			return last?.role === 'assistant' && last.content.includes('Mock buffered reply');
		}, 20000, 'buffered reply stored');
		const m4text = await page.evaluate(() => {
			const conv = __smoke.plugin().conversationStore.getCurrentConversation();
			return conv.messages[conv.messages.length - 1].content;
		});
		ok(m4text.includes('Mock buffered reply for mock-pro (got: ping two).'),
			'M4 buffered send (requestUrl) round-trips', m4text);
		const m4req = requests.filter((r) => r.path === '/v1/chat/completions').at(-1);
		ok(m4req.stream === false, 'M4 server saw stream:false on the buffered send');

		// --- M5: bad key → 401 from the mock, warning in the view ---------------
		await page.evaluate(async () => {
			const p = __smoke.plugin();
			p.settings.streamResponse = true;
			await p.saveSettings();
		});
		const m5pre = await page.evaluate(() => {
			const p = __smoke.plugin();
			// Boot migration moved the seeded plaintext key into the OS keychain
			// and set apiKeyRef; resolveApiKey prefers the ref, so the swap must
			// clear it to exercise the plaintext fallback path.
			const cfg = p.settings.providerConfigs['mock-llm'];
			delete cfg.apiKeyRef;
			cfg.apiKey = 'wrong-key';
			p.providerRegistry.updateConfig('mock-llm', cfg);
			const after = p.providerRegistry.getProvider('mock-llm');
			return { afterHeaders: after?.getAuthHeaders?.() ?? null };
		});
		console.log(`[smoke] M5 probe: ${JSON.stringify(m5pre)}`);
		await page.evaluate(() => {
			__smoke.chatView().startNewChat();
			__smoke.chatView().inputEl.value = 'ping three';
		});
		convIds.push(await page.evaluate(() => __smoke.plugin().conversationStore.getCurrentConversation().id));
		await page.evaluate(() => __smoke.chatView().sendMessage());
		// A pre-chunk failure stores no assistant message — the warning lives
		// in the live bubble only.
		await until(page, () => [...document.querySelectorAll('.ai-message-content')]
			.some((el) => el.textContent.includes('error:')), 20000, 'error surfaced in the view');
		const m5req = requests.filter((r) => r.path === '/v1/chat/completions').at(-1);
		ok(m5req.auth === 'Bearer wrong-key' && !m5req.authOk && requests.some((r) => r.path === '/v1/chat/completions' && r.auth === 'Bearer wrong-key'),
			'M5 server rejected the bad key (401 path exercised)');
		const m5dom = await page.evaluate(() =>
			[...document.querySelectorAll('.ai-message-content')].map((el) => el.textContent).join('|'));
		ok(m5dom.includes('error:'), 'M5 view shows the failure inline', m5dom.slice(-160));
	} finally {
		// --- cleanup -------------------------------------------------------------
		await page.evaluate(async (ids) => {
			const p = __smoke.plugin();
			for (const id of ids) { try { p.conversationStore.deleteConversation(id); } catch { /* best effort */ } }
			await p.saveSettings();
			return true;
		}, convIds).catch(() => { /* page may be gone */ });
		console.log('[smoke] cleaned up seeded artifacts');
	}

	// --- summary -----------------------------------------------------------------
	console.log(`\n[smoke] ${pass} passed, ${fail} failed`);
	reportConsoleGate();
	finished = true;
	await browser.close();
	server.close();
	child.kill();
	restoreLaunchVault();
	restoreDataJson();
	process.exit(fail > 0 || pluginErrors.length > 0 ? 1 : 0);
}

main().catch((e) => {
	console.error('[smoke] fatal:', e.message);
	restoreLaunchVault();
	restoreDataJson();
	try { execSync('taskkill /IM ObsidianSmoke.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	process.exit(1);
});
