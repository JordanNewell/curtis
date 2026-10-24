// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Swarm — leader chats that delegate work to follower agents.
//
// A follower is NOT a new runtime: it is a real, persisted conversation
// driven by a nested agent loop. The leader's spawn_agent tool call blocks
// until the follower finishes and its final report comes back as the tool
// result. Followers run one at a time — a global queue across ALL leaders,
// so two followers never work the vault concurrently (v1: predictable cost,
// no concurrent vault edits). The leader's Stop tears the whole thing down
// because the nested loop shares the leader's abort signal.
//
// Panes are viewers, never participants: every follower message goes through
// the conversation store, and any pane bound to that conversation re-renders
// off conversation:changed. Closing a follower's pane never orphans a run.

import type CurtisPlugin from '../main';
import type { ToolContext, ToolDefinition } from '../core/tools';
import type { Agent, AIMessage, Conversation, TokenUsage } from '../types';
import { ThinkingStreamSplitter } from '../providers/anthropic';

export const SWARM_TOOL_NAME = 'spawn_agent';

/** Cap on what a follower's report hands back to the leader — the full
 *  transcript stays in the follower conversation, so a long report must not
 *  silently eat the leader's context window. */
const FOLLOWER_RESULT_CAP = 8_000;

interface FollowerRecord {
	conversationId: string;
	leaderId: string;
	task: string;
	status: 'running' | 'done' | 'aborted' | 'error';
}

function str(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

/** Accept an array of strings or a comma/space-separated string — models
 *  occasionally send the latter despite the schema. */
function strArray(v: unknown): string[] {
	if (Array.isArray(v)) return v.filter((s): s is string => typeof s === 'string');
	if (typeof v === 'string' && v.trim()) return v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
	return [];
}

export class SwarmManager {
	private plugin: CurtisPlugin;
	/** Followers spawned during the CURRENT leader generation (one user
	 *  send), keyed by leader conversation id — this is what the cap counts. */
	private currentGeneration = new Map<string, FollowerRecord[]>();
	/** Follower conversation ids with a nested loop in flight — the view
	 *  refuses sends into these panes while the leader owns the thread. */
	private activeFollowers = new Set<string>();
	/** Global serialization point: every follower run awaits its turn here,
	 *  across all leaders — "one follower at a time" is a vault-wide
	 *  invariant, not a per-leader one. Followers cannot spawn followers,
	 *  so the chain cannot deadlock. */
	private followerChain: Promise<void> = Promise.resolve();

	constructor(plugin: CurtisPlugin) {
		this.plugin = plugin;
	}

	/** Open a leader generation — the window in which spawn_agent calls
	 *  count against the per-message cap. callAgentLoop opens it when the
	 *  conversation is a leader and closes it in its finally, so the window
	 *  is exactly "this conversation has a loop in flight". */
	beginGeneration(leaderId: string): void {
		this.currentGeneration.set(leaderId, []);
	}

	endGeneration(leaderId: string): void {
		this.currentGeneration.delete(leaderId);
	}

	/** True while the leader conversation has a generation in flight. A
	 *  second pane on the same conversation must not send mid-generation:
	 *  a fresh send would reset the follower cap and interleave two
	 *  generations into one transcript. */
	isLeaderGenerating(leaderId: string): boolean {
		return this.currentGeneration.has(leaderId);
	}

	/** True while a swarm-driven nested loop is writing this conversation. */
	isFollowerBusy(conversationId: string): boolean {
		return this.activeFollowers.has(conversationId);
	}

	/** The spawn_agent tool definition. Registered once at startup; visibility
	 *  per conversation is decided in callAgentLoop (leaders only). The
	 *  optional `agent` parameter runs the task as one of the user's named
	 *  agents — its own model, persona, and tool permissions (the roster is
	 *  advertised in the leader's system prompt). */
	buildSpawnTool(): ToolDefinition {
		return {
			name: SWARM_TOOL_NAME,
			description:
				'Spawn a follower agent: a fresh assistant with its own conversation and the vault toolset ' +
				'(read/search/create/edit notes, web search if enabled) that works on ONE task and returns a report. ' +
				'Use it to parallelize self-contained subtasks — researching different parts of the vault, reading ' +
				'several sources, drafting separate sections. Give each follower a complete, standalone task ' +
				'description: it cannot see this conversation. Followers run one at a time and each run costs ' +
				'tokens — do not spawn one for trivial work you can do with a single tool call. Followers cannot ' +
				'spawn further agents. The cap on followers per message is enforced for you: when it is reached, ' +
				'synthesize from what you have instead of retrying.',
			parameters: {
				task: {
					type: 'string',
					description: 'Complete, self-contained instructions for the follower — what to do and what to report back',
					required: true,
				},
				agent: {
					type: 'string',
					description:
						'Optional: exact name of a named agent (see the roster in your context) to run this task as a ' +
						'specialist — it brings its own model, role, and tool permissions. Match the specialist to the ' +
						'subtask; omit to inherit this conversation\'s model.',
					required: false,
				},
			},
			inputSchema: {
				type: 'object',
				properties: {
					task: { type: 'string', description: 'Complete, self-contained instructions for the follower — what to do and what to report back' },
					agent: { type: 'string', description: 'Optional: exact name of a named agent (see the roster in your context) to run this task as a specialist — it brings its own model, role, and tool permissions. Match the specialist to the subtask; omit to inherit this conversation\'s model.' },
					skills: {
						type: 'array',
						items: { type: 'string' },
						description: 'Optional skill names (see "Skills available" in your context) whose full instructions are loaded into this follower before it starts. Use when the subtask matches a skill — e.g. a PDF-heavy subtask with the pdf-processing skill.',
					},
				},
				required: ['task'],
			},
			execute: async (params, context) => this.runFollower(str(params.task), context, str(params.agent) || undefined, strArray(params.skills)),
		};
	}

	private async runFollower(task: string, ctx: ToolContext, agentRef?: string, skills?: string[]): Promise<string> {
		const plugin = ctx.plugin;
		if (!plugin) throw new Error('Swarm is not wired up — reload the plugin');
		const leaderId = ctx.conversationId;
		if (!leaderId) throw new Error('spawn_agent requires a bound conversation (leader chat)');

		const leader = plugin.conversationStore.getConversation(leaderId);
		if (!leader || leader.role !== 'leader') {
			throw new Error('spawn_agent is only available in leader chats');
		}

		const cap = Math.max(1, plugin.settings.swarmMaxFollowers);
		const spawned = this.currentGeneration.get(leaderId) ?? [];
		const running = spawned.filter((f) => f.status === 'running');
		if (spawned.length >= cap) {
			throw new Error(
				`Follower cap reached (${spawned.length}/${cap} this message${running.length ? `, ${running.length} still running` : ''}). ` +
					'Synthesize your answer from the reports you already have.'
			);
		}
		if (task.trim().length < 3) {
			throw new Error('Task description is too short — give the follower complete instructions');
		}

		// Named-agent spawn: resolve the specialist up front so a bad name
		// fails loudly (the leader can retry without one) instead of silently
		// degrading to a generic follower.
		let agent: Agent | undefined;
		if (agentRef) {
			agent = plugin.agents.findByRef(agentRef);
			if (!agent) {
				const roster = plugin.agents.getAgents().map((a) => `"${a.name}"`).join(', ');
				throw new Error(
					`No named agent matching "${agentRef}".` + (roster ? ` Available: ${roster}.` : ' No agents are configured.')
				);
			}
		}

		// Routing order: the named agent's own lane wins, then the leader's
		// EFFECTIVE provider/model — the ones this very run is using (via
		// ToolContext), not the conversation metadata, which can lag the
		// pane's current model picker.
		const providerId = agent?.providerId || ctx.providerId || leader.provider;
		const modelId = agent?.modelId || ctx.modelId || leader.model;
		const conv = this.createFollowerConversation(leaderId, providerId, modelId, task, agent);

		const record: FollowerRecord = { conversationId: conv.id, leaderId, task, status: 'running' };
		spawned.push(record);
		this.currentGeneration.set(leaderId, spawned);
		this.activeFollowers.add(conv.id);

		// Best-effort pane: the run is fully functional headless (the
		// conversation persists whatever happens to windows).
		try {
			await plugin.openNewChatPane('tab', conv.id);
		} catch (e) {
			console.warn('[Curtis] Swarm: follower pane did not open:', e);
		}

		// The task IS the follower's first user message — a pane bound to this
		// conversation shows what was asked, not just the work that followed.
		plugin.conversationStore.addMessageTo(conv.id, {
			role: 'user',
			content: task,
			provider: providerId,
			model: modelId,
		});

		// Take a place in the global follower queue — the run starts once
		// every previously spawned follower (from any leader) has finished.
		const ahead = this.followerChain;
		let release: () => void = () => {};
		this.followerChain = new Promise<void>((resolve) => { release = resolve; });
		await ahead;

		let report = '';
		let usage: TokenUsage | undefined;
		let failed: string | undefined;
		// Keep <think>-tagged reasoning out of the report the leader receives.
		const thinking = new ThinkingStreamSplitter();
		try {
			if (ctx.signal?.aborted) {
				// The leader was stopped while this follower waited in the
				// queue — record it as never started rather than running a
				// follower whose owner is already gone. The AbortError catch
				// below stays for a run stopped mid-flight.
				record.status = 'aborted';
				plugin.conversationStore.addMessageTo(conv.id, {
					role: 'assistant',
					content: '*[Stopped — the leader was aborted before this agent started]*',
				});
			} else {
				await plugin.callAgentLoop(await this.followerMessages(task, agent, skills), modelId, {
					onChunk: (chunk) => {
						report += thinking.push(chunk).answer;
					},
					onUsage: (u) => {
						usage = u;
					},
					onError: (error) => {
						failed = error.message;
						report += `\n\n*[Follower hit an error: ${error.message}]*`;
					},
					onToolCall: (call) => {
						// Every write goes through the store — bound panes update via
						// conversation:changed, and the vault file accumulates the trail.
						plugin.conversationStore.addMessageTo(conv.id, {
							role: 'assistant',
							content: '',
							tool_calls: [call],
							provider: providerId,
							model: modelId,
						});
					},
					onToolResult: (call, result) => {
						plugin.conversationStore.addMessageTo(conv.id, {
							role: 'tool',
							content: result.content,
							tool_call_id: call.id,
							tool_error: result.isError || undefined,
						});
					},
					signal: ctx.signal,
				}, { conversationId: conv.id, providerId });
				record.status = failed ? 'error' : 'done';
			}
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') {
				record.status = 'aborted';
				report = report || '';
				plugin.conversationStore.addMessageTo(conv.id, {
					role: 'assistant',
					content: '*[Stopped — the leader was aborted while this agent was working]*',
				});
			} else {
				record.status = 'error';
				failed = e instanceof Error ? e.message : String(e);
			}
		} finally {
			release();
			this.activeFollowers.delete(conv.id);
			// The nested loop and the pane open both moved the store's
			// "most recent" pointer — hand it back to the leader, but only
			// if the user has not navigated elsewhere mid-run (never yank
			// them back to a conversation they left).
			if (plugin.conversationStore.getCurrentConversation()?.id === conv.id) {
				plugin.conversationStore.setCurrentConversation(leaderId);
			}
		}

		if (report.trim()) {
			plugin.conversationStore.addMessageTo(conv.id, {
				role: 'assistant',
				content: report,
				...(usage ? { tokens: usage } : {}),
				provider: providerId,
				model: modelId,
			});
		}

		if (record.status === 'aborted') {
			return `Follower "${conv.title}" was stopped because the leader was aborted.`;
		}

		const statusLine = record.status === 'error'
			? `Follower "${conv.title}" finished with an error: ${failed ?? 'unknown error'}. Partial report follows.`
			: `Follower "${conv.title}" finished. Full transcript: conversation "${conv.title}" in chat history.`;
		const body = report.trim() || '(the follower produced no final text — check its transcript)';
		const capped = body.length > FOLLOWER_RESULT_CAP
			? `${body.slice(0, FOLLOWER_RESULT_CAP)}\n\n*[Report truncated at ${FOLLOWER_RESULT_CAP} characters — the full text is in the follower conversation "${conv.title}"]*`
			: body;
		return `${statusLine}\n\n${capped}`;
	}

	private createFollowerConversation(
		leaderId: string,
		providerId: string,
		modelId: string,
		task: string,
		agent?: Agent
	): Conversation {
		const store = this.plugin.conversationStore;
		// Capture what the user had BEFORE createConversation — it points the
		// store's global "most recent" pointer at the follower, and a pane
		// opened later must not silently bind to it.
		const priorId = store.getCurrentConversation()?.id;
		const conv = store.createConversation(providerId, modelId);
		const taskLabel = `${task.slice(0, 60).trim()}${task.length > 60 ? '…' : ''}`;
		conv.title = agent ? `${agent.name}: ${taskLabel}` : `Agent: ${taskLabel}`;
		conv.role = 'follower';
		conv.leaderId = leaderId;
		if (agent) conv.agentId = agent.id;
		// Restore whatever the user actually had — usually the leader, but
		// another pane may hold a different conversation (setCurrentConversation
		// ignores unknown ids, so a deleted prior falls through harmlessly).
		if (store.getCurrentConversation()?.id === conv.id) {
			store.setCurrentConversation(priorId ?? leaderId);
		}
		return conv;
	}

	private async followerMessages(task: string, agent?: Agent, extraSkills?: string[]): Promise<AIMessage[]> {
		const system =
			'You are a follower agent spawned by a leader conversation inside the user\'s Obsidian vault. ' +
			'You were given exactly one task. Complete it thoroughly using the available tools — read and search ' +
			'notes, create or edit notes only if the task says to — then write a complete, self-contained report ' +
			'that the leader can use without reading your transcript: findings first, then the evidence, with ' +
			'note paths cited. Do not ask questions; make reasonable assumptions and state them.';
		// A named-agent follower wears its persona as the role layer, AFTER the
		// harness framing — same layering as a bound chat (role wins ties).
		let full = agent && agent.systemPrompt.trim()
			? `${system}\n\n# Your role: ${agent.name}\n\n${agent.systemPrompt.trim()}`
			: system;
		// Skills ride followers too: the pinned agent's skills plus the
		// leader's per-spawn picks load in full, the rest as a discovery
		// index — same selection logic as every arena (skillBlocks is a no-op
		// when the master toggle is off). The fresh follower conversation has
		// no attachments of its own.
		const skillBlocks = await this.plugin.skills.skillBlocks([
			...(agent?.skillIds ?? []),
			...(extraSkills ?? []),
		]);
		if (skillBlocks.length > 0) full += `\n\n${skillBlocks.join('\n\n')}`;
		return [
			{ role: 'system', content: full },
			{ role: 'user', content: task },
		];
	}
}
