import { type NotebookDocument } from '@lobechat/types';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentDocumentService } from '@/services/agentDocument';

const SWR_USE_FETCH_TOPIC_DOCUMENTS = 'SWR_USE_FETCH_TOPIC_DOCUMENTS';

/**
 * Invalidate the topic documents list, e.g. after deleting a document from
 * the Notebook portal so the sidebar list refreshes.
 */
export const refreshTopicDocuments = async (topicId: string) => {
  await mutate([SWR_USE_FETCH_TOPIC_DOCUMENTS, topicId]);
};

/**
 * Fetch documents associated with the current topic.
 *
 * Reads via the AgentDocuments topic-association path (`topic_documents`)
 * rather than the deprecated Notebook tool, so it surfaces both legacy
 * Notebook-created documents and new AgentDocuments `scope: 'currentTopic'`
 * documents — both live in the same `documents`/`topic_documents` tables.
 */
export const useFetchNotebookDocuments = (topicId?: string) => {
  const { data, isLoading } = useClientDataSWR<NotebookDocument[]>(
    topicId ? [SWR_USE_FETCH_TOPIC_DOCUMENTS, topicId] : null,
    async () => {
      if (!topicId) return [];
      return agentDocumentService.listForTopic({ topicId });
    },
  );

  return {
    documents: data || [],
    isLoading,
    topicId,
  };
};
