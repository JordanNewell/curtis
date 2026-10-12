// Node tests for the swarm runtime's orchestration seams: the leader
// generation guard, the per-generation follower cap, the global
// one-follower-at-a-time queue, and the conditional "most recent"
// pointer restore — all over a fake plugin (no Obsidian, no providers).

import { describe, expect, it } from 'vitest';
import { SwarmManager } from './index';
import type { ToolContext, ToolDefinition } from '../core/tools';
import type CurtisPlugin from '../main';

interface FakeConv {
	id: string;
	title: string;
	role?: string;
	leaderId?: string;
	messages: unknown[];
}

type LoopCallbacks = { onChunk?: (chunk: string) => void };
type FakeLoop = (
	messages: unknown,
	modelId: string,
	callbacks: LoopCallbacks,
	opts?: { conversationId?: string }
) => Promise<void>;

function makeStore() {
	const convs = new Map<string, FakeConv>();
	let current: string | undefined;
	let nextFollower = 0;
	for (const id of ['leader-1', 'leader-2']) {
		convs.set(id, { id, title: id, role: 'leader', messages: [] });
	}
	return {
		convs,
		get currentId() {
			return current;
		},
		set currentId(id: string | undefined) {
			current = id;
		},
		getConversation(id: string) {
			return convs.get(id);
		},
		getCurrentConversation() {
			return current ? convs.get(current) : undefined;
		},
		setCurrentConversation(id: string) {
			if (convs.has(id)) current = id;
		},
		createConversation(): FakeConv {
			const conv: FakeConv = { id: `fol-${++nextFollower}`, title: 'New chat', messages: [] };
			convs.set(conv.id, conv);
			current = conv.id;
			return conv;
		},
		addMessageTo(id: string, message: unknown) {
			const conv = convs.get(id);
			if (!conv) return undefined;
			conv.messages.push(message);
			return { id: `m-${conv.messages.length}` };
		},
	};
}

type FakeStore = ReturnType<typeof makeStore>;

function makePlugin(store: FakeStore, loop: FakeLoop): CurtisPlugin {
	return {
		settings: { swarmMaxFollowers: 3 },
		conversationStore: store,
		openNewChatPane: async () => {},
		skills: { skillBlocks: async () => [] },
		agents: { findByRef: () => undefined, getAgents: () => [] },
		callAgentLoop: loop,
	} as unknown as CurtisPlugin;
}

function leaderCtx(store: FakeStore, plugin: CurtisPlugin, leaderId: string, signal?: AbortSignal): ToolContext {
	return {
		app: {},
		conversationId: leaderId,
		plugin,
		providerId: 'prov',
		modelId: 'model-a',
		signal,
	} as unknown as ToolContext;
}

// Drain pending microtasks — enough ticks for runFollower's resolved-promise
// awaits (pane open, queue turn) to settle before assertions.
const flush = async (): Promise<void> => {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
};

describe('SwarmManager generations', () => {
	it('gates a leader for exactly one generation', () => {
		const swarm = new SwarmManager(makePlugin(makeStore(), async () => {}));
		expect(swarm.isLeaderGenerating('leader-1')).toBe(false);
		swarm.beginGeneration('leader-1');
		expect(swarm.isLeaderGenerating('leader-1')).toBe(true);
		swarm.endGeneration('leader-1');
		expect(swarm.isLeaderGenerating('leader-1')).toBe(false);
	});

	it('enforces the follower cap per leader generation', async () => {
		const store = makeStore();
		const plugin = makePlugin(store, async (_m, _model, cb) => {
			cb.onChunk?.('report');
		});
		const swarm = new SwarmManager(plugin);
		plugin.settings.swarmMaxFollowers = 1;
		swarm.beginGeneration('leader-1');
		const tool: ToolDefinition = swarm.buildSpawnTool();
		const ctx = leaderCtx(store, plugin, 'leader-1');
		await expect(tool.execute({ task: 'first task for the follower' }, ctx)).resolves.toContain('finished');
		await expect(tool.execute({ task: 'second task for the follower' }, ctx)).rejects.toThrow(/cap reached/i);
	});
});

describe('SwarmManager global queue', () => {
	it('serializes followers across leaders', async () => {
		const store = makeStore();
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const started: string[] = [];
		const plugin = makePlugin(store, async (_m, _model, cb, opts) => {
			started.push(opts?.conversationId ?? '');
			if (opts?.conversationId === 'fol-1') await firstGate;
			cb.onChunk?.('done');
		});
		const swarm = new SwarmManager(plugin);
		swarm.beginGeneration('leader-1');
		swarm.beginGeneration('leader-2');
		const tool = swarm.buildSpawnTool();
		const first = tool.execute({ task: 'task one' }, leaderCtx(store, plugin, 'leader-1'));
		const second = tool.execute({ task: 'task two' }, leaderCtx(store, plugin, 'leader-2'));
		await flush();
		await flush();
		expect(started).toEqual(['fol-1']);
		releaseFirst();
		await Promise.all([first, second]);
		expect(started).toEqual(['fol-1', 'fol-2']);
	});

	it('skips a follower whose leader was stopped while queued', async () => {
		const store = makeStore();
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const started: string[] = [];
		const plugin = makePlugin(store, async (_m, _model, cb, opts) => {
			started.push(opts?.conversationId ?? '');
			if (opts?.conversationId === 'fol-1') await firstGate;
			cb.onChunk?.('done');
		});
		const swarm = new SwarmManager(plugin);
		swarm.beginGeneration('leader-1');
		swarm.beginGeneration('leader-2');
		const tool = swarm.buildSpawnTool();
		const abort = new AbortController();
		const first = tool.execute({ task: 'task one' }, leaderCtx(store, plugin, 'leader-1'));
		const second = tool.execute(
			{ task: 'task two' },
			leaderCtx(store, plugin, 'leader-2', abort.signal)
		);
		await flush();
		await flush();
		abort.abort();
		releaseFirst();
		const result = await second;
		await first;
		expect(started).toEqual(['fol-1']);
		expect(result).toContain('was stopped because the leader was aborted');
		expect(store.convs.get('fol-2')?.messages.some((m) =>
			typeof m === 'object' && m !== null && 'content' in m &&
			String(m.content).includes('before this agent started')
		)).toBe(true);
	});
});

describe('SwarmManager pointer restore', () => {
	it('hands the most-recent pointer back to the leader when the user stayed put', async () => {
		const store = makeStore();
		const plugin = makePlugin(store, async (_m, _model, cb) => {
			cb.onChunk?.('report');
		});
		const swarm = new SwarmManager(plugin);
		swarm.beginGeneration('leader-1');
		const tool = swarm.buildSpawnTool();
		await tool.execute({ task: 'solo task' }, leaderCtx(store, plugin, 'leader-1'));
		expect(store.currentId).toBe('leader-1');
	});

	it('leaves the pointer alone when the user navigated away mid-run', async () => {
		const store = makeStore();
		let releaseRun!: () => void;
		const runGate = new Promise<void>((resolve) => {
			releaseRun = resolve;
		});
		const plugin = makePlugin(store, async () => {
			await runGate;
		});
		const swarm = new SwarmManager(plugin);
		swarm.beginGeneration('leader-1');
		const tool = swarm.buildSpawnTool();
		const run = tool.execute({ task: 'long task' }, leaderCtx(store, plugin, 'leader-1'));
		await flush();
		await flush();
		// The user switched conversations while the follower worked.
		store.currentId = 'leader-2';
		releaseRun();
		await run;
		expect(store.currentId).toBe('leader-2');
	});
});
