import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { DocumentModel } from '@/database/models/document';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { insertKnowledgeBasesSchema } from '@/database/schemas';
import { fileEnv } from '@/envs/file';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ChunkService } from '@/server/services/chunk';
import { KnowledgeBaseMarketService } from '@/server/services/community/knowledgeBaseMarket';
import { DocumentService } from '@/server/services/document';
import { FeishuDocService, type FeishuWikiNode, FeishuWikiService } from '@/server/services/feishu';
import { type KnowledgeBaseItem } from '@/types/knowledgeBase';

/** 抓取飞书文档正文的并发上限（飞书文档接口限流较严，配合退避重试取较低并发） */
const FEISHU_FETCH_CONCURRENCY = 2;

const knowledgeBaseProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      knowledgeBaseModel: new KnowledgeBaseModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const knowledgeBaseRouter = router({
  addFilesToKnowledgeBase: knowledgeBaseProcedure
    .input(z.object({ ids: z.array(z.string()), knowledgeBaseId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await ctx.knowledgeBaseModel.addFilesToKnowledgeBase(
          input.knowledgeBaseId,
          input.ids,
        );
      } catch (e: any) {
        // Check for PostgreSQL unique constraint violation (code 23505)
        const pgErrorCode = e?.cause?.cause?.code || e?.cause?.code || e?.code;
        if (pgErrorCode === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'FILE_ALREADY_IN_KNOWLEDGE_BASE',
          });
        }
        throw e;
      }
    }),

  createKnowledgeBase: knowledgeBaseProcedure
    .input(
      z.object({
        avatar: z.string().optional(),
        description: z.string().optional(),
        name: z.string(),
        settings: z.record(z.any()).optional(),
        type: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.knowledgeBaseModel.create({
        avatar: input.avatar,
        description: input.description,
        name: input.name,
        settings: input.settings,
        type: input.type,
      });

      return data?.id;
    }),

  /**
   * 从飞书知识库（wiki）链接递归导入文档到资源库。
   * - create 模式：直接导入。
   * - update 模式：先清空该库中飞书来源的文档，再重新导入（全量重建）。
   */
  importFromFeishu: knowledgeBaseProcedure
    .input(
      z.object({
        knowledgeBaseId: z.string(),
        mode: z.enum(['create', 'update']).default('create'),
        url: z.string(),
        userAccessToken: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { knowledgeBaseId, url, userAccessToken, mode } = input;

      const documentService = new DocumentService(ctx.serverDB, ctx.userId);
      const documentModel = new DocumentModel(ctx.serverDB, ctx.userId);
      const chunkService = new ChunkService(ctx.serverDB, ctx.userId);

      // 1. update 模式：先清空该库中飞书来源的文档（folder 会递归清理子文档与镜像 file）
      if (mode === 'update') {
        const existing = await documentModel.findByKnowledgeBaseId(knowledgeBaseId);
        const feishuDocIds = existing
          .filter((doc) => (doc.metadata as any)?.feishuSource === true)
          .map((doc) => doc.id);
        if (feishuDocIds.length > 0) {
          await documentService.deleteDocuments(feishuDocIds);
        }
      }

      // 2. 递归列举 wiki 节点树
      const wikiService = new FeishuWikiService({ userAccessToken });
      const docService = new FeishuDocService({ userAccessToken });
      const nodes = await wikiService.listAllNodes(url);

      // 3. 并发抓取文档类节点的正文（Markdown）
      const contentMap = new Map<string, string>();
      const errors: Array<{ error: string; title: string }> = [];
      await pMap(
        nodes.filter((node) => FeishuWikiService.isDocNode(node.objType)),
        async (node) => {
          try {
            const { content } = await docService.getContentByToken(node.objToken);
            contentMap.set(node.nodeToken, content);
          } catch (e) {
            errors.push({ error: (e as Error).message, title: node.title || node.nodeToken });
          }
        },
        { concurrency: FEISHU_FETCH_CONCURRENCY },
      );

      // 4. 按 wiki 层级创建文档（父→子顺序）；有子节点的节点建为 folder 容器
      // 同时收集所有有内容的文档的 fileId + content，用于后续向量化
      const nodeTokens = new Set(nodes.map((node) => node.nodeToken));
      const childrenByParent = new Map<string, FeishuWikiNode[]>();
      for (const node of nodes) {
        if (node.parentNodeToken && nodeTokens.has(node.parentNodeToken)) {
          const siblings = childrenByParent.get(node.parentNodeToken) ?? [];
          siblings.push(node);
          childrenByParent.set(node.parentNodeToken, siblings);
        }
      }

      let success = 0;
      /** 收集需要向量化的文档：{ fileId, content } */
      const docsToVectorize: Array<{ content: string; fileId: string }> = [];

      const createNode = async (node: FeishuWikiNode, parentId?: string): Promise<void> => {
        const children = childrenByParent.get(node.nodeToken) ?? [];
        const isDoc = FeishuWikiService.isDocNode(node.objType);
        const metadata = {
          feishuNodeToken: node.nodeToken,
          feishuObjToken: node.objToken,
          feishuSource: true,
          feishuUrl: url,
        };
        const title = node.title || 'Untitled';

        let containerId = parentId;

        if (children.length > 0) {
          // 有子节点：建一个 folder 容器
          const folder = await documentService.createDocument({
            editorData: {},
            fileType: 'custom/folder',
            knowledgeBaseId,
            metadata,
            parentId,
            title,
          });
          containerId = folder.id;
          success += 1;

          // 该节点本身也是文档：在 folder 下再建一个内容页
          if (isDoc && contentMap.has(node.nodeToken)) {
            const docContent = contentMap.get(node.nodeToken)!;
            const doc = await documentService.createDocument({
              content: docContent,
              editorData: {},
              fileType: 'custom/document',
              knowledgeBaseId,
              metadata,
              parentId: folder.id,
              title,
            });
            success += 1;
            // 收集用于向量化：doc.fileId 是 DocumentService 创建时自动生成的 File 记录 ID
            if (doc.fileId && docContent) {
              docsToVectorize.push({ content: docContent, fileId: doc.fileId });
            }
          }
        } else if (isDoc && contentMap.has(node.nodeToken)) {
          // 叶子文档节点
          const docContent = contentMap.get(node.nodeToken)!;
          const doc = await documentService.createDocument({
            content: docContent,
            editorData: {},
            fileType: 'custom/document',
            knowledgeBaseId,
            metadata,
            parentId,
            title,
          });
          success += 1;
          if (doc.fileId && docContent) {
            docsToVectorize.push({ content: docContent, fileId: doc.fileId });
          }
        }

        for (const child of children) {
          await createNode(child, containerId);
        }
      };

      await createNode(nodes[0], undefined);

      // 5. 向量化转后台执行：文档已全部创建完成，立即返回让用户进库；分块 + embedding
      //    在后台以受控并发继续跑，前端通过每个文档的 async task 状态徽章实时看到进度，
      //    无需在此长时间阻塞等待。沿用两步削峰策略避免打爆 provider 限流：
      //    5a. 先分块（不自动 embedding）；
      //    5b. 再以受控并发逐个 embedding 并等待完成（wait 才能让 pMap 真正限流）。
      //    单篇失败只记日志并落到该文档的失败徽章，用户可在列表里点重试，不影响其余文档。
      void (async () => {
        // 5a. 分块（并发与飞书抓取一致）
        await pMap(
          docsToVectorize,
          async ({ fileId, content }) => {
            try {
              await chunkService.chunkDocumentContent(fileId, content, { autoEmbed: false });
            } catch (e) {
              console.error(`[importFromFeishu] chunking failed for ${fileId}:`, e);
            }
          },
          { concurrency: FEISHU_FETCH_CONCURRENCY },
        );

        // 5b. embedding（受控并发 + 等待完成，配合 batch 级退避重试削峰抗限流）
        await pMap(
          docsToVectorize,
          async ({ fileId }) => {
            try {
              await chunkService.asyncEmbeddingFileChunks(fileId, { wait: true });
            } catch (e) {
              console.error(`[importFromFeishu] vectorization failed for ${fileId}:`, e);
            }
          },
          { concurrency: fileEnv.EMBEDDING_DOC_CONCURRENCY },
        );
      })().catch((e) => {
        console.error('[importFromFeishu] background vectorization error:', e);
      });

      // 文档已创建完成即返回；向量化进度由前端逐个文档的状态徽章轮询展示
      return { errors, failed: errors.length, success, total: nodes.length };
    }),

  getKnowledgeBaseById: knowledgeBaseProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }): Promise<KnowledgeBaseItem | undefined> => {
      return ctx.knowledgeBaseModel.findById(input.id);
    }),

  getKnowledgeBases: knowledgeBaseProcedure.query(async ({ ctx }): Promise<KnowledgeBaseItem[]> => {
    return ctx.knowledgeBaseModel.query();
  }),

  removeAllKnowledgeBases: knowledgeBaseProcedure.mutation(async ({ ctx }) => {
    return ctx.knowledgeBaseModel.deleteAll();
  }),

  removeFilesFromKnowledgeBase: knowledgeBaseProcedure
    .input(z.object({ ids: z.array(z.string()), knowledgeBaseId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.knowledgeBaseModel.removeFilesFromKnowledgeBase(input.knowledgeBaseId, input.ids);
    }),

  removeKnowledgeBase: knowledgeBaseProcedure
    .input(z.object({ id: z.string(), removeFiles: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const marketService = new KnowledgeBaseMarketService(ctx.serverDB, ctx.userId);
      await marketService.purgeLocalKnowledgeBaseContent(input.id);
      return ctx.knowledgeBaseModel.delete(input.id);
    }),

  updateKnowledgeBase: knowledgeBaseProcedure
    .input(
      z.object({
        id: z.string(),
        value: insertKnowledgeBasesSchema.partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.knowledgeBaseModel.update(input.id, input.value);
    }),
});
