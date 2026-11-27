import { builtinSkills } from '@lobechat/builtin-skills';
import {
  type ActivateSkillParams,
  LobeActivatorIdentifier,
} from '@lobechat/builtin-tool-activator';
import {
  ActivatorExecutionRuntime,
  type ActivatorRuntimeService,
  type ToolManifestInfo,
} from '@lobechat/builtin-tool-activator/executionRuntime';
import { resourcesTreePrompt } from '@lobechat/prompts';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { filterBuiltinSkills } from '@/helpers/skillFilters';

import { type ServerRuntimeRegistration } from './types';

/**
 * Lobe Activator Server Runtime
 * Resolves tool manifests from context.toolManifestMap (populated by the agent state).
 *
 * Replaces the former lobe-tools activator (LobeToolIdentifier) — aligned with
 * lobehub upstream which splits the activator into its own `lobe-activator` tool.
 *
 * `activateSkill` is wired here only to power the `activateTools` fallback: when a
 * caller passes a skill's name (or identifier) instead of a tool identifier, the
 * activator resolves it against the builtin skills list rather than reporting
 * "Not found". The `activateSkill` API itself is not exposed by the activator
 * manifest (only `activateTools` is), so this wiring adds no new model-facing API;
 * skill activation still goes through the `lobe-skills` tool. DB-backed
 * (user/market) skills are intentionally not handled here — those resolve via
 * `lobe-skills`'s `activateSkill`, which the model is steered toward.
 */
export const lobeActivatorRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    const activatedIds: string[] = [];

    // Builtin skills visible in this context. Mirrors the filter used by the
    // lobe-skills runtime so the two stay consistent (e.g. desktop-only skills
    // like opencli are included only when an online device is active).
    const visibleBuiltinSkills = filterBuiltinSkills(builtinSkills, {
      activeDevice: !!context.activeDeviceId,
      isDesktop: false,
    });

    const service: ActivatorRuntimeService = {
      // Resolves a builtin skill by name or identifier. Used by the
      // `activateTools` fallback when an identifier isn't a registered tool —
      // e.g. the model passing the localized skill name "助手浏览器".
      activateSkill: async ({ name }: ActivateSkillParams): Promise<BuiltinServerRuntimeOutput> => {
        const skill = visibleBuiltinSkills.find((s) => s.name === name || s.identifier === name);

        if (!skill) {
          return {
            content: `Skill not found: "${name}". If this is a user or market skill, use the activateSkill tool from lobe-skills instead.`,
            success: false,
          };
        }

        let content = skill.content || '';
        const hasResources = !!(skill.resources && Object.keys(skill.resources).length > 0);

        if (hasResources && skill.resources) {
          content += '\n\n' + resourcesTreePrompt(skill.name, skill.resources);
        }

        return {
          content,
          state: {
            description: skill.description,
            hasResources,
            identifier: skill.identifier,
            name: skill.name,
            source: skill.source,
          },
          success: true,
        };
      },
      getActivatedToolIds: () => [...activatedIds],
      getToolManifests: async (identifiers: string[]): Promise<ToolManifestInfo[]> => {
        // Note: context.toolManifestMap should only contain discoverable tools.
        // The caller is responsible for scoping this map to exclude hidden/internal tools.
        const results: ToolManifestInfo[] = [];

        for (const id of identifiers) {
          const manifest = context.toolManifestMap[id];
          if (!manifest) continue;

          results.push({
            apiDescriptions: manifest.api.map((a) => ({
              description: a.description,
              name: a.name,
            })),
            avatar: manifest.meta?.avatar,
            identifier: manifest.identifier,
            name: manifest.meta?.title ?? manifest.identifier,
            systemRole: manifest.systemRole,
          });
        }

        return results;
      },
      markActivated: (identifiers: string[]) => {
        for (const id of identifiers) {
          if (!activatedIds.includes(id)) {
            activatedIds.push(id);
          }
        }
      },
    };

    return new ActivatorExecutionRuntime({ service });
  },
  identifier: LobeActivatorIdentifier,
};
