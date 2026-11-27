import { MAIN_SIDEBAR_EXCLUDE_TRIGGERS } from '@/const/topic';
import { useFetchTopics } from '@/hooks/useFetchTopics';

/**
 * Canonical topic fetch for chat sidebars (agent + group). The single source of
 * truth for sidebar topic filters so every call site in the same route mounts
 * the SAME SWR key — otherwise sibling `useFetchTopics()` calls with different
 * args both write to `topicDataMap[containerKey]` and whichever response lands
 * last wins, which is how system-owned topics (cron / eval / task runs) leak
 * into the user's main history.
 *
 * Extend this hook when adding more shared sidebar topic params; don't spread
 * them across individual components.
 */
export const useFetchChatTopics = () =>
  useFetchTopics({ excludeTriggers: MAIN_SIDEBAR_EXCLUDE_TRIGGERS });
