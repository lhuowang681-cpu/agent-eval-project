import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { TopicDocumentModel } from '@/database/models/topicDocument';

import { createServerPlanRuntimeService } from './lobeAgentPlanRuntime';

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn(),
}));

describe('createServerPlanRuntimeService', () => {
  const db = {} as any;
  const userId = 'user-1';

  const mockDocumentModel = {
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  };

  const mockTopicDocumentModel = {
    associate: vi.fn(),
    findByTopicId: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (DocumentModel as any).mockImplementation(() => mockDocumentModel);
    (TopicDocumentModel as any).mockImplementation(() => mockTopicDocumentModel);
  });

  describe('createPlan', () => {
    it('creates a document with fileType agent/plan and associates it with the topic', async () => {
      mockDocumentModel.create.mockResolvedValue({
        content: 'ctx',
        createdAt: new Date('2024-01-01'),
        description: 'desc',
        id: 'plan-1',
        metadata: null,
        title: 'goal',
        updatedAt: new Date('2024-01-01'),
      });

      const service = createServerPlanRuntimeService(db, userId);
      const result = await service.createPlan({
        content: 'ctx',
        description: 'desc',
        goal: 'goal',
        topicId: 'topic-1',
      });

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'ctx',
          description: 'desc',
          fileType: 'agent/plan',
          sourceType: 'api',
          title: 'goal',
        }),
      );
      expect(mockTopicDocumentModel.associate).toHaveBeenCalledWith({
        documentId: 'plan-1',
        topicId: 'topic-1',
      });
      expect(result.id).toBe('plan-1');
    });
  });

  describe('findPlanById', () => {
    it('returns null when the document is not a plan document', async () => {
      mockDocumentModel.findById.mockResolvedValue({ fileType: 'markdown', id: 'doc-1' });

      const service = createServerPlanRuntimeService(db, userId);
      const result = await service.findPlanById('doc-1');

      expect(result).toBeNull();
    });

    it('returns the plan document when fileType matches', async () => {
      const doc = {
        content: null,
        createdAt: new Date(),
        description: null,
        fileType: 'agent/plan',
        id: 'plan-1',
        metadata: null,
        title: 'goal',
        updatedAt: new Date(),
      };
      mockDocumentModel.findById.mockResolvedValue(doc);

      const service = createServerPlanRuntimeService(db, userId);
      const result = await service.findPlanById('plan-1');

      expect(result?.id).toBe('plan-1');
    });
  });

  describe('findPlanByTopic', () => {
    it('returns the first plan document associated with the topic', async () => {
      mockTopicDocumentModel.findByTopicId.mockResolvedValue([
        {
          content: null,
          createdAt: new Date(),
          description: null,
          id: 'plan-1',
          metadata: null,
          title: 'goal',
          updatedAt: new Date(),
        },
      ]);

      const service = createServerPlanRuntimeService(db, userId);
      const result = await service.findPlanByTopic('topic-1');

      expect(mockTopicDocumentModel.findByTopicId).toHaveBeenCalledWith('topic-1', {
        type: 'agent/plan',
      });
      expect(result?.id).toBe('plan-1');
    });

    it('returns null when there is no plan document for the topic', async () => {
      mockTopicDocumentModel.findByTopicId.mockResolvedValue([]);

      const service = createServerPlanRuntimeService(db, userId);
      const result = await service.findPlanByTopic('topic-1');

      expect(result).toBeNull();
    });
  });

  describe('updatePlan', () => {
    it('only updates provided fields and reloads the document', async () => {
      mockDocumentModel.findById.mockResolvedValue({
        content: 'new ctx',
        createdAt: new Date(),
        description: 'old desc',
        id: 'plan-1',
        metadata: null,
        title: 'new goal',
        updatedAt: new Date(),
      });

      const service = createServerPlanRuntimeService(db, userId);
      const result = await service.updatePlan('plan-1', { content: 'new ctx', goal: 'new goal' });

      expect(mockDocumentModel.update).toHaveBeenCalledWith(
        'plan-1',
        expect.objectContaining({ content: 'new ctx', title: 'new goal' }),
      );
      expect(result.title).toBe('new goal');
    });

    it('throws when the plan cannot be reloaded after update', async () => {
      mockDocumentModel.findById.mockResolvedValue(undefined);

      const service = createServerPlanRuntimeService(db, userId);

      await expect(service.updatePlan('plan-1', { goal: 'new goal' })).rejects.toThrow(
        'Plan not found after update: plan-1',
      );
    });
  });

  describe('updatePlanMetadata', () => {
    it('writes metadata without touching other fields', async () => {
      const service = createServerPlanRuntimeService(db, userId);
      await service.updatePlanMetadata('plan-1', { todos: { items: [], updatedAt: '2024-01-01' } });

      expect(mockDocumentModel.update).toHaveBeenCalledWith('plan-1', {
        metadata: { todos: { items: [], updatedAt: '2024-01-01' } },
      });
    });
  });
});
