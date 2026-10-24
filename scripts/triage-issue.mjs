#!/usr/bin/env node
// Rules-based issue triage for curtis (the "Curtis bot", v1).
//
// Runs on every newly opened issue via .github/workflows/triage.yml:
//   1. keyword-matches the title + body against the feature table below
//   2. applies the matching labels (creating them on first use)
//   3. posts one comment linking the relevant per-feature docs
// Usage-looking questions additionally get pointed at the Q&A category.
//
// Deliberately no LLM: a wrong canned link is fixable by editing RULES; a
// wrong generated answer is a support incident. If issue volume ever makes
// keyword matching insufficient, swap matchRules() for a provider call and
// keep everything else.
//
// Without GITHUB_TOKEN the script dry-runs (prints the plan, posts nothing):
//   node scripts/triage-issue.mjs path/to/event.json

import { readFileSync } from "node:fs";

const QUESTION = {
	label: "question",
	color: "cc317c",
	patterns: [
		/\bhow (?:do|can|to) i\b/i,
		/\bis there a way\b/i,
		/\bany way to\b/i,
		/\bwhere (?:do|can) i\b/i,
		/\bis it possible\b/i,
		/\bdoes curtis\b/i,
	],
};

const RULES = [
	{
		label: "provider",
		title: "Providers",
		color: "d93f0b",
		doc: "docs/PROVIDERS.md",
		blurb: "provider setup, API keys, subscription plans, per-provider parameters",
		keywords: [
			"api key", "provider", "openai", "anthropic", "claude", "gemini",
			"google ai", "ollama", "lm studio", "groq", "deepseek", "kimi",
			"alibaba", "azure", "chatgpt", "mistral", "xai", "grok", "z.ai",
			"401", "403", "unauthorized", "invalid key", "rate limit",
		],
	},
	{
		label: "agent",
		title: "Curtis Agent",
		color: "1d76db",
		doc: "docs/AGENT.md",
		blurb: "the agent, its built-in tools, tool calling, turn caps",
		keywords: [
			"agent", "swarm", "leader", "follower", "tool call", "tool use",
			"tool calling", "/agent", "semantic_search",
		],
	},
	{
		label: "mcp",
		title: "MCP",
		color: "5319e7",
		doc: "docs/AGENT.md#mcp-servers",
		blurb: "connecting MCP servers as agent tools; server mode lives in docs/MCP_SERVER.md",
		keywords: ["mcp", "model context protocol", "supergateway", "mcp-proxy"],
	},
	{
		label: "memory",
		title: "Memory",
		color: "0e8a16",
		doc: "docs/MEMORY.md",
		blurb: "long-term memory capture, provenance, memory chips",
		keywords: ["memory", "/remember", "/forget", "remembered"],
	},
	{
		label: "retrieval",
		title: "Vault retrieval",
		color: "006b75",
		doc: "docs/VAULT_RETRIEVAL.md",
		blurb: "the vault index, embeddings providers, hybrid retrieval, rebuilds",
		keywords: [
			"retrieval", "rag", "embedding", "semantic search", "vault index",
			"rebuild index",
		],
	},
	{
		label: "terminal",
		title: "Terminal",
		color: "2b3137",
		doc: "docs/TERMINAL.md",
		blurb: "the terminal pane and the run_command agent tool",
		keywords: ["terminal", "shell", "run_command"],
	},
	{
		label: "autocomplete",
		title: "Inline autocomplete",
		color: "c2e0c6",
		doc: "docs/AUTOCOMPLETE.md",
		blurb: "ghost-text suggestions, Tab accept, debouncing, model choice",
		keywords: ["autocomplete", "ghost text", "ghost-text", "inline suggestion", "completion"],
	},
	{
		label: "attachments",
		title: "Image attachments",
		color: "fef2c0",
		doc: "docs/IMAGES.md",
		blurb: "paste / drag-and-drop attachments, vision models",
		keywords: ["image", "attach", "vision", "paperclip", "drag and drop", "clipboard", "screenshot"],
	},
	{
		label: "skills",
		title: "Skills",
		color: "d4c5f9",
		doc: "docs/SKILLS.md",
		blurb: "vault skills, the Agent Skills standard, /skill",
		keywords: ["skill"],
	},
	{
		label: "scheduled-runs",
		title: "Scheduled runs",
		color: "ededed",
		doc: "docs/SCHEDULED_RUNS.md",
		blurb: "prompts and agents on a cadence, headless runs",
		keywords: ["scheduled run", "schedule", "cron", "cadence"],
	},
	{
		label: "voice",
		title: "Voice I/O",
		color: "f9d0c4",
		doc: "docs/VOICE.md",
		blurb: "Whisper speech-to-text, TTS engines, the mic button",
		keywords: ["voice", "tts", "speech", "whisper", "dictation", "microphone", "mic button"],
	},
	{
		label: "arena",
		title: "Arena",
		color: "b60205",
		doc: "docs/ARENA.md",
		blurb: "multi-model arena runs, promote-to-chat",
		keywords: ["arena", "side-by-side", "side by side"],
	},
	{
		label: "multipane",
		title: "Multi-pane chat",
		color: "0e8a16",
		doc: "docs/MULTIPANE.md",
		blurb: "chat tabs, popout windows, per-pane state",
		keywords: ["multi-pane", "multipane", "pane", "popout"],
	},
	{
		label: "import",
		title: "Import & backup",
		color: "fbca04",
		doc: "docs/IMPORT.md",
		blurb: "chat imports, .curt files, backup/restore, Claude Code adoption",
		keywords: ["import", "backup", "restore", ".curt", "claude code", "export"],
	},
	{
		label: "mentions",
		title: "@-mentions",
		color: "1d76db",
		doc: "docs/MENTIONS.md",
		blurb: "attaching vault notes with @, context chips",
		keywords: ["mention", "attach note"],
	},
	{
		label: "diff-rewrite",
		title: "Inline diff rewrite",
		color: "5319e7",
		doc: "docs/DIFF_REWRITE.md",
		blurb: "selection rewrite with accept/reject diff",
		keywords: ["rewrite", "diff modal"],
	},
	{
		label: "notifications",
		title: "Notifications",
		color: "006b75",
		doc: "docs/NOTIFICATIONS.md",
		blurb: "run-finished and mention notifications",
		keywords: ["notification"],
	},
	{
		label: "harness",
		title: "Harness profiles",
		color: "d93f0b",
		doc: "docs/HARNESS.md",
		blurb: "base system-prompt contracts, custom profiles",
		keywords: ["harness", "claudemd", "system prompt profile"],
	},
	{
		label: "mobile",
		title: "Mobile",
		color: "2b3137",
		doc: "README.md#mobile",
		blurb: "mobile support and its limits",
		keywords: ["mobile", "android", "ios", "ipad", "tablet", "phone"],
	},
];

function matchRules(text) {
	const haystack = `${text.title}\n${text.body ?? ""}`.toLowerCase();
	return RULES.map((rule) => ({
		rule,
		hits: rule.keywords.filter((k) => haystack.includes(k)).length,
	}))
		.filter((m) => m.hits > 0)
		.sort((a, b) => b.hits - a.hits);
}

function isUsageQuestion(text) {
	const haystack = `${text.title}\n${text.body ?? ""}`;
	return QUESTION.patterns.some((p) => p.test(haystack));
}

function buildComment(matches, question, repo) {
	const parts = [];
	if (matches.length > 0) {
		const tags = matches.map((m) => `\`${m.rule.label}\``).join(", ");
		parts.push(`Tagged ${tags} by keyword triage. Likely-relevant docs:`);
		parts.push(
			matches
				.slice(0, 6)
				.map((m) => `- [${m.rule.title}](${m.rule.doc}) — ${m.rule.blurb}`)
				.join("\n"),
		);
	}
	if (question) {
		parts.push(
			`This reads like a usage question — the [Q&A category](https://github.com/${repo}/discussions/categories/q-a) ` +
				"gets faster answers; this tracker is for bugs and feature work.",
		);
	}
	parts.push(
		"Rules-based triage via [scripts/triage-issue.mjs](scripts/triage-issue.mjs). " +
			"Wrong tag? Remove it — nothing re-adds it. General help: [docs/FAQ.md](docs/FAQ.md).",
	);
	return parts.join("\n\n");
}

async function main() {
	const eventPath = process.env.GITHUB_EVENT_PATH ?? process.argv[2];
	if (!eventPath) {
		console.error("usage: triage-issue.mjs [event.json] (or set GITHUB_EVENT_PATH)");
		process.exit(2);
	}
	const event = JSON.parse(readFileSync(eventPath, "utf8"));
	if (!event.issue?.number) {
		console.error("event carries no issue — nothing to triage");
		process.exit(1);
	}

	const issue = event.issue;
	const text = { title: issue.title ?? "", body: issue.body ?? "" };
	const matches = matchRules(text);
	const question = isUsageQuestion(text);
	const labels = matches.map((m) => m.rule.label);
	if (question) labels.push(QUESTION.label);

	console.log(
		`issue #${issue.number} "${text.title}" → ` +
			(labels.length > 0 ? labels.join(", ") : "no matches"),
	);

	if (labels.length === 0 && !question) {
		console.log("nothing to do — no labels, no comment");
		return;
	}

	const comment = buildComment(matches, question, event.repository.full_name);

	const token = process.env.GITHUB_TOKEN;
	if (!token) {
		console.log("\n--- dry run (no GITHUB_TOKEN) — comment would be ---\n");
		console.log(comment);
		return;
	}

	const apiBase = process.env.GITHUB_API_URL ?? "https://api.github.com";
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "curtis-triage-bot",
	};

	async function api(path, method, body) {
		const res = await fetch(`${apiBase}${path}`, {
			method,
			headers: { ...headers, "Content-Type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
		});
		// GET 404 = label not found yet; POST 422 = label already exists (race).
		if (!res.ok) {
			if (method === "GET" && res.status === 404) return 404;
			if (method === "POST" && res.status === 422) return 422;
			throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
		}
		return res.status;
	}

	const repo = event.repository.full_name;
	const labelDefs = [
		...matches.map((m) => ({ label: m.rule.label, color: m.rule.color })),
		...(question ? [QUESTION] : []),
	];
	for (const def of labelDefs) {
		const status = await api(`/repos/${repo}/labels/${encodeURIComponent(def.label)}`, "GET");
		if (status === 404) {
			await api(`/repos/${repo}/labels`, "POST", {
				name: def.label,
				color: def.color,
			});
			console.log(`created label ${def.label}`);
		}
	}

	await api(`/repos/${repo}/issues/${issue.number}/labels`, "POST", { labels });
	await api(`/repos/${repo}/issues/${issue.number}/comments`, "POST", { body: comment });
	console.log(`applied ${labels.length} label(s), commented`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
