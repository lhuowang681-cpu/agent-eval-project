// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentDocumentModel, buildDocumentFilename } from '@/database/models/agentDocuments';
import { TopicDocumentModel } from '@/database/models/topicDocument';
import type { LobeChatDatabase } from '@/database/type';

import { AgentDocumentsService } from './agentDocuments';

vi.mock('@/database/models/agentDocuments', () => ({
  AgentDocumentModel: vi.fn(),
  DocumentLoadPosition: {
    BEFORE_FIRST_USER: 'before_first_user',
  },
  buildDocumentFilename: vi.fn(),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn(),
}));

describe('AgentDocumentsService', () => {
  const db = {} as LobeChatDatabase;
  const userId = 'user-1';

  const mockModel = {
    create: vi.fn(),
    findByFilename: vi.fn(),
    hasByAgent: vi.fn(),
  };

  const mockTopicDocumentModel = {
    associate: vi.fn(),
    findByTopicId: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (AgentDocumentModel as any).mockImplementation(() => mockModel);
    (TopicDocumentModel as any).mockImplementation(() => mockTopicDocumentModel);
    vi.mocked(buildDocumentFilename).mockImplementation((title: string) => `${title}.md`);
  });

  describe('createDocument', () => {
    it('should append a numeric suffix when the base filename already exists', async () => {
      mockModel.findByFilename
        .mockResolvedValueOnce({ id: 'existing-doc' })
        .mockResolvedValueOnce(undefined);
      mockModel.create.mockResolvedValue({ id: 'new-doc', filename: 'note-2.md' });

      const service = new AgentDocumentsService(db, userId);
      const result = await service.createDocument('agent-1', 'note', 'content');

      expect(mockModel.findByFilename).toHaveBeenNthCalledWith(1, 'agent-1', 'note.md');
      expect(mockModel.findByFilename).toHaveBeenNthCalledWith(2, 'agent-1', 'note-2.md');
      expect(mockModel.create).toHaveBeenCalledWith(
        'agent-1',
        'note-2.md',
        'content',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      expect(result).toEqual({ id: 'new-doc', filename: 'note-2.md' });
    });

    it('should throw after too many filename collisions', async () => {
      mockModel.findByFilename.mockResolvedValue({ id: 'existing-doc' });

      const service = new AgentDocumentsService(db, userId);

      await expect(service.createDocument('agent-1', 'note', 'content')).rejects.toThrow(
        'Unable to generate a unique filename for "note" after 1000 attempts.',
      );
      expect(mockModel.create).not.toHaveBeenCalled();
    });
  });

  describe('createForTopic', () => {
    it('should create a document then associate it with the topic', async () => {
      mockModel.findByFilename.mockResolvedValue(undefined);
      mockModel.create.mockResolvedValue({ documentId: 'doc-1', filename: 'note.md' });
      mockTopicDocumentModel.associate.mockResolvedValue({
        documentId: 'doc-1',
        topicId: 'topic-1',
      });

      const service = new AgentDocumentsService(db, userId);
      const result = await service.createForTopic('agent-1', 'note', 'content', 'topic-1');

      expect(mockModel.create).toHaveBeenCalledWith(
        'agent-1',
        'note.md',
        'content',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      expect(mockTopicDocumentModel.associate).toHaveBeenCalledWith({
        documentId: 'doc-1',
        topicId: 'topic-1',
      });
      expect(result).toEqual({ documentId: 'doc-1', filename: 'note.md' });
    });
  });

  describe('listDocumentsForTopic', () => {
    it('should delegate to TopicDocumentModel.findByTopicId', async () => {
      const docs = [{ documentId: 'doc-1' }];
      mockTopicDocumentModel.findByTopicId.mockResolvedValue(docs);

      const service = new AgentDocumentsService(db, userId);
      const result = await service.listDocumentsForTopic('topic-1');

      expect(mockTopicDocumentModel.findByTopicId).toHaveBeenCalledWith('topic-1');
      expect(result).toBe(docs);
    });
  });

  describe('hasDocuments', () => {
    it('should use the model existence check', async () => {
      mockModel.hasByAgent.mockResolvedValue(true);

      const service = new AgentDocumentsService(db, userId);
      const result = await service.hasDocuments('agent-1');

      expect(mockModel.hasByAgent).toHaveBeenCalledWith('agent-1');
      expect(result).toBe(true);
    });
  });
});
