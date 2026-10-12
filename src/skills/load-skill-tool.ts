// load_skill — the model-initiated activation path for skills (stage 2 of
// the Agent Skills progressive-disclosure model). The discovery index tells
// the model a skill exists; this tool hands over the full instructions when
// the task matches. Vault-class for agent-ACL purposes: a skill body is
// vault content, so an agent without vault access must not read it.

import type { ToolDefinition } from '../types';
import type { SkillManager } from './manager';

export const LOAD_SKILL_TOOL_NAME = 'load_skill';

export function buildLoadSkillTool(skills: SkillManager): ToolDefinition {
	return {
		name: LOAD_SKILL_TOOL_NAME,
		description:
			'Load a skill\'s full instructions from the user\'s skill library. ' +
			'Skills listed in your context under "Skills available" are relevant ' +
			'to the current task — call this with the skill\'s name BEFORE ' +
			'proceeding, then follow the returned instructions. Do not call it ' +
			'for skills already fully present in your context, and never guess ' +
			'a skill name that is not listed.',
		parameters: {
			name: {
				type: 'string',
				description: 'The skill name exactly as listed under "Skills available".',
			},
		},
		execute: async (params) => {
			const ref = typeof params['name'] === 'string' ? params['name'] : '';
			if (!ref.trim()) {
				return 'Error: no skill name given. Pass the exact name from the "Skills available" list.';
			}
			const body = await skills.loadSkillBody(ref);
			if (!body) {
				return `Error: no skill named "${ref}". Use a name exactly as it appears in the "Skills available" list.`;
			}
			return body;
		},
	};
}
