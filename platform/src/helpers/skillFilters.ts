import {
  FeishuCliIdentifier,
  OpenCliIdentifier,
  TripYoYoIdentifier,
} from '@lobechat/builtin-skills';
import { isDesktop } from '@lobechat/const';
import { type BuiltinSkill } from '@lobechat/types';

export interface BuiltinSkillFilterContext {
  /**
   * Whether a remote device (`lh connect`) is active for this run. Desktop-only
   * skills (lark-cli / opencli) drive locally-bundled binaries, so on the
   * cloud they are only reachable when their shell commands can be proxied to an
   * online device. Treated as desktop-equivalent for filtering.
   */
  activeDevice?: boolean;
  isDesktop: boolean;
}

// TripYoYo (LobeHub) drives the `lh` CLI, which — with the cloud sandbox
// disabled — only exists on the desktop or on an `lh connect` device's PATH,
// same as lark-cli / open-cli.
const DESKTOP_ONLY_BUILTIN_SKILLS = new Set([
  FeishuCliIdentifier,
  TripYoYoIdentifier,
  OpenCliIdentifier,
]);

const DEFAULT_CONTEXT: BuiltinSkillFilterContext = {
  isDesktop,
};

const resolveBuiltinSkillFilterContext = (
  context: BuiltinSkillFilterContext = DEFAULT_CONTEXT,
): Required<Pick<BuiltinSkillFilterContext, 'isDesktop'>> & { activeDevice: boolean } => ({
  activeDevice: context.activeDevice ?? false,
  isDesktop: context.isDesktop ?? DEFAULT_CONTEXT.isDesktop,
});

export const shouldEnableBuiltinSkill = (
  skillId: string,
  context: BuiltinSkillFilterContext = DEFAULT_CONTEXT,
): boolean => {
  const resolvedContext = resolveBuiltinSkillFilterContext(context);

  if (DESKTOP_ONLY_BUILTIN_SKILLS.has(skillId)) {
    // Available on the desktop itself, or on the cloud when an online device can
    // run the bundled CLI on the user's behalf.
    return resolvedContext.isDesktop || resolvedContext.activeDevice;
  }

  return true;
};

export const filterBuiltinSkills = (
  skills: BuiltinSkill[],
  context: BuiltinSkillFilterContext = DEFAULT_CONTEXT,
): BuiltinSkill[] => {
  return skills.filter((skill) => shouldEnableBuiltinSkill(skill.identifier, context));
};
