// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// SwarmHost adapter for @curtis/core's SwarmManager. Composes the plugin's
// conversation store, AgentManager, SkillManager, pane opener, and the
// callAgentLoop nested loop into the package's host seam.

import type { AIMessage } from '@curtis/shared';
import type { AgentManager } from '@curtis/agents';
import type { SkillManager, SwarmHost, SwarmLoopCallbacks } from '@curtis/core';
import type { ConversationStore } from '../chat/conversation-store';
import type CurtisPlugin from '../main';

export class PluginSwarmHost implements SwarmHost {
	/** Live settings read — the cap is re-read per spawn so a settings edit
	 *  takes effect without a reload. */
	swarmMaxFollowers(): number {
		return this.plugin.settings.swarmMaxFollowers;
	}

	conversationStore: ConversationStore;
	agents: AgentManager;
	skills: { skillBlocks(ids: string[]): Promise<string[]> };

	constructor(
		private readonly plugin: CurtisPlugin,
		store: ConversationStore,
		agents: AgentManager,
		skills: SkillManager
	) {
		this.conversationStore = store;
		this.agents = agents;
		this.skills = {
			skillBlocks: (ids) => skills.skillBlocks(ids),
		};
	}

	/** Best-effort viewer open. May reject (headless hosts) — swallowed. */
	openNewChatPane(target: 'tab' | 'window', bind: string): Promise<void> {
		return this.plugin.openNewChatPane(target, bind);
	}

	/** The nested agent loop the follower runs inside. */
	callAgentLoop(
		messages: AIMessage[],
		modelId: string,
		callbacks: SwarmLoopCallbacks,
		opts?: { conversationId?: string; providerId?: string }
	): Promise<void> {
		return this.plugin.callAgentLoop(messages, modelId, callbacks, opts);
	}
}
