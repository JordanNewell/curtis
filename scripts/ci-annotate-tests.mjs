#!/usr/bin/env node
// Reads a vitest JSON report and re-emits failed tests as GitHub Actions
// error annotations. Without this, a red matrix leg tells you nothing unless
// you can download the run logs (which needs repo auth).
//
// If the report is missing (vitest crashed before writing it — e.g. a
// startup failure), falls back to annotating the tail of the captured
// vitest output so the crash is still visible.
import { readFileSync } from 'node:fs';

const reportPath = process.argv[2] ?? 'test-results.json';
const logPath = process.argv[3];

// Workflow command property values may not contain commas or newlines.
const escapeProp = (s) =>
	String(s).replace(/%/g, '%25').replace(/,/g, '%2C').replace(/[\r\n]+/g, ' ');
const escapeMessage = (s) =>
	String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

let report;
try {
	report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
	console.log(`::error title=vitest crashed before writing JSON report::${escapeMessage(`${reportPath} unreadable (${error.code ?? error.message}); see output tail annotation`)}`);
	if (logPath) {
		try {
			const ansi = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
			const tail = readFileSync(logPath, 'utf8').replace(ansi, '').trimEnd().slice(-2500);
			console.log(`::error title=vitest output tail::${escapeMessage(tail)}`);
		} catch {
			// Nothing more we can do; the step's non-zero exit still fails CI.
		}
	}
	process.exit(0);
}

let failures = 0;
for (const suite of report.testResults ?? []) {
	// Suite-level failure: the test file errored before/while collecting
	// (import, transform, unhandled error). assertionResults is empty or all
	// passing in that case, so the per-assertion loop below sees nothing.
	if (suite.status && suite.status !== 'passed') {
		failures++;
		console.log(
			`::error file=${escapeProp(suite.name).slice(0, 200)},title=suite failed to run::${escapeMessage(String(suite.message ?? 'suite-level failure with no assertion results').slice(0, 500))}`
		);
	}
	for (const assertion of suite.assertionResults ?? []) {
		if (assertion.status !== 'failed') continue;
		failures++;
		const firstLine = (assertion.failureMessages?.[0] ?? '').split('\n')[0].slice(0, 300);
		console.log(
			`::error file=${escapeProp(suite.name).slice(0, 200)},title=${escapeProp(assertion.title).slice(0, 180)}::${escapeMessage(`${assertion.fullName} — ${firstLine}`)}`
		);
	}
}

if (failures === 0) {
	// Exit non-zero but nothing failed in the report: almost always a
	// top-level unhandled error, which the JSON reporter does not carry.
	// The captured console output names it.
	console.log('::warning::vitest exited non-zero but the JSON report lists no failed assertions');
	if (logPath) {
		try {
			const ansi = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
			const tail = readFileSync(logPath, 'utf8').replace(ansi, '').trimEnd().slice(-2500);
			console.log(`::error title=vitest output tail (no failed assertions)::${escapeMessage(tail)}`);
		} catch {
			// log unreadable; nothing more to surface
		}
	}
}
