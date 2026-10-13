// Test + smoke suite orchestrator — one entry point over everything the repo
// already ships. The individual runners are untouched; this file only sequences
// them, tiers them by what they need, and prints a single summary.
//
// Tiers (cheapest first):
//   unit     vitest (30 suites, ~8s, node-only)
//   offline  harness smokes that never touch Obsidian or a real socket:
//            mcp (fake MCP server), models (in-process registry), gcp (fake Google)
//   app      real-Obsidian CDP smokes: v2, panes, terminal, store, mock.
//            Each one closes the running Obsidian for the duration, so this
//            tier is always serial and never runs on CI. Skipped cleanly when
//            no Obsidian executable is found (or --app is not passed).
//   live     provider probe against real paid APIs; per-provider skips when
//            keys are absent. Never runs unless asked for.
//
// Usage:
//   node scripts/suite.mjs                 # unit + offline (default)
//   node scripts/suite.mjs --app           # default + the Obsidian tier
//   node scripts/suite.mjs --live          # default + the paid tier
//   node scripts/suite.mjs all             # unit + offline + app (live stays opt-in — it's paid)
//   node scripts/suite.mjs unit app        # explicit tier list
//   node scripts/suite.mjs --fail-fast     # stop at first failure
//
// Exit code is non-zero iff any non-skipped runner failed.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const OBSIDIAN_EXE =
	process.env.OBSIDIAN_EXE ||
	resolve(process.env.USERPROFILE ?? process.env.HOME, 'scoop/apps/obsidian/current/Obsidian.exe');

// name → [tier, command, args]. Order within a tier is execution order.
const RUNNERS = {
	unit: { tier: 'unit', cmd: 'npx', args: ['vitest', 'run'], note: 'vitest: 30 suites' },
	'smoke:mcp': { tier: 'offline', cmd: 'node', args: ['scripts/mcp-smoke.mjs'], note: 'MCP client vs fake server' },
	'smoke:models': { tier: 'offline', cmd: 'node', args: ['scripts/models-smoke.mjs'], note: 'provider registry discovery' },
	'smoke:gcp': { tier: 'offline', cmd: 'node', args: ['scripts/gcp-smoke.mjs'], note: 'GcpManager vs fake Google' },
	'smoke:v2': { tier: 'app', cmd: 'node', args: ['scripts/v2-smoke.mjs'], note: 'real Obsidian: memory/provenance/recap' },
	'smoke:panes': { tier: 'app', cmd: 'node', args: ['scripts/smoke-panes.mjs'], note: 'real Obsidian: panes/notifications' },
	'smoke:terminal': { tier: 'app', cmd: 'node', args: ['scripts/smoke-terminal.mjs'], note: 'real Obsidian: terminal panes' },
	'smoke:store': { tier: 'app', cmd: 'node', args: ['scripts/smoke-store.mjs'], note: 'real Obsidian: 2x boot scan' },
	'smoke:mock': { tier: 'app', cmd: 'node', args: ['scripts/smoke-mock.mjs'], note: 'real Obsidian: transport vs local server' },
	'smoke:providers': { tier: 'live', cmd: 'node', args: ['scripts/smoke-providers.mjs'], note: 'PAID: live catalogs' },
};

const ORDER = ['unit', 'smoke:mcp', 'smoke:models', 'smoke:gcp', 'smoke:v2', 'smoke:panes', 'smoke:terminal', 'smoke:store', 'smoke:mock', 'smoke:providers'];

// --- arg parsing -----------------------------------------------------------

const argv = process.argv.slice(2);
const failFast = argv.includes('--fail-fast');
const jsonOut = argv.includes('--json') ? resolve(ROOT, argv[argv.indexOf('--json') + 1] || 'suite-results.json') : null;

const tierArgs = argv.filter((a) => !a.startsWith('--')).flatMap((a) => {
	if (a === 'all') return ['unit', 'offline', 'app'];
	return [a];
});
// Explicit tier args replace the default; --app/--live extend it.
const wantTiers = tierArgs.length ? [...tierArgs] : ['unit', 'offline'];
if (argv.includes('--app')) wantTiers.push('app');
if (argv.includes('--live')) wantTiers.push('live');

// --- preflight -------------------------------------------------------------

const appTierSelected = wantTiers.includes('app');
let appAvailable = appTierSelected;
if (appTierSelected && !existsSync(OBSIDIAN_EXE)) {
	appAvailable = false;
}

const selected = ORDER.filter((name) => wantTiers.includes(RUNNERS[name].tier));
if (!selected.length) {
	console.error(`No runners selected. Tiers: unit, offline, app, live (or "all").`);
	process.exit(2);
}

console.log(`\ncurtis test + smoke suite`);
console.log(`  tiers: ${wantTiers.join(', ')}`);
console.log(`  runners: ${selected.map((s) => RUNNERS[s].note ? s : s).join(' → ')}\n`);

if (appTierSelected && !appAvailable) {
	console.log(`[SKIP] app tier — Obsidian not found at ${OBSIDIAN_EXE}`);
	console.log(`       (set OBSIDIAN_EXE or install via scoop to enable)\n`);
}

// --- run -------------------------------------------------------------------

const results = [];
let stopped = false;
const suiteStarted = Date.now();

const runOne = (name) =>
	new Promise((resolveRun) => {
		const def = RUNNERS[name];
		const started = Date.now();
		console.log(`\n━━━ ${name} ━━━ ${def.note}`);
		const child = spawn(def.cmd, def.args, {
			cwd: ROOT,
			stdio: 'inherit',
			shell: process.platform === 'win32', // npx needs the shell on Windows
		});
		child.on('exit', (code, signal) => {
			resolveRun({
				name,
				tier: def.tier,
				status: code === 0 ? 'PASS' : 'FAIL',
				ms: Date.now() - started,
				detail: signal ? `killed by ${signal}` : code === 0 ? '' : `exit ${code}`,
			});
		});
		child.on('error', (err) => {
			resolveRun({ name, tier: def.tier, status: 'FAIL', ms: Date.now() - started, detail: err.message });
		});
	});

for (const name of selected) {
	if (RUNNERS[name].tier === 'app' && !appAvailable) {
		results.push({ name, tier: 'app', status: 'SKIP', ms: 0, detail: 'no Obsidian' });
		continue;
	}
	const result = await runOne(name);
	results.push(result);
	if (result.status === 'FAIL' && failFast) {
		stopped = true;
		break;
	}
}

// --- summary ---------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${'━'.repeat(64)}`);
console.log(`${pad('runner', 18)}${pad('tier', 9)}${pad('status', 7)}${pad('time', 10)}detail`);
console.log(`${'─'.repeat(64)}`);
for (const r of results) {
	console.log(`${pad(r.name, 18)}${pad(r.tier, 9)}${r.status === 'PASS' ? '\x1b[32m' : r.status === 'FAIL' ? '\x1b[31m' : '\x1b[33m'}${pad(r.status, 7)}\x1b[0m${pad(`${(r.ms / 1000).toFixed(1)}s`, 10)}${r.detail}`);
}
const counts = results.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
const failed = counts.FAIL ?? 0;
console.log(`${'─'.repeat(64)}`);
console.log(
	`${counts.PASS ?? 0} passed · ${failed} failed · ${counts.SKIP ?? 0} skipped${stopped ? ' · stopped at first failure' : ''} · ${((Date.now() - suiteStarted) / 1000).toFixed(1)}s total\n`
);

if (jsonOut) {
	const { writeFileSync } = await import('node:fs');
	writeFileSync(jsonOut, JSON.stringify({ results, counts }, null, 2));
	console.log(`report: ${jsonOut}`);
}

process.exit(failed ? 1 : 0);
