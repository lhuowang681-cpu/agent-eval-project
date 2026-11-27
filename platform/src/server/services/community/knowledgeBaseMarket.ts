import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import {
  chunks,
  documentChunks,
  documents,
  embeddings,
  fileChunks,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  marketKbChunks,
  marketKbDocumentChunks,
  marketKbDocuments,
  marketKbEmbeddings,
  marketKbFileChunks,
  marketKbFileLinks,
  marketKbFiles,
} from '@lobechat/database/schemas';
import { and, count, eq, inArray } from 'drizzle-orm';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { MarketKnowledgeBaseModel } from '@/database/models/marketKnowledgeBase';
import { idGenerator } from '@/database/utils/idGenerator';
import { FileService } from '@/server/services/file';

const marketS3Prefix = (identifier: string) => `market/kb/${identifier}`;
const installerS3Prefix = (userId: string) => `files/${userId}`;

export class KnowledgeBaseMarketService {
  private db: LobeChatDatabase;
  private userId: string;
  private knowledgeBaseModel: KnowledgeBaseModel;
  private marketKnowledgeBaseModel: MarketKnowledgeBaseModel;
  private documentModel: DocumentModel;
  private fileModel: FileModel;
  private fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.knowledgeBaseModel = new KnowledgeBaseModel(db, userId);
    this.marketKnowledgeBaseModel = new MarketKnowledgeBaseModel(db, userId);
    this.documentModel = new DocumentModel(db, userId);
    this.fileModel = new FileModel(db, userId);
    this.fileService = new FileService(db, userId);
  }

  snapshotLocalToMarket = async (
    knowledgeBaseId: string,
    visibility: 'public' | 'bundled' = 'public',
  ) => {
    const localKb = await this.knowledgeBaseModel.findById(knowledgeBaseId);
    if (!localKb) throw new Error('Knowledge base not found');

    const identifier = localKb.id;
    const existing = await this.marketKnowledgeBaseModel.findByIdentifier(identifier);

    let marketRow;
    if (existing) {
      await this.clearMarketSnapshotData(existing.id);
      marketRow = await this.marketKnowledgeBaseModel.updateByIdentifier(identifier, {
        name: localKb.name,
        description: localKb.description,
        avatar: localKb.avatar,
        type: localKb.type,
        settings: localKb.settings as Record<string, unknown> | null,
        visibility,
        version: (existing.version || 1) + 1,
      });
    } else {
      marketRow = await this.marketKnowledgeBaseModel.create({
        identifier,
        name: localKb.name,
        description: localKb.description,
        avatar: localKb.avatar,
        type: localKb.type,
        settings: localKb.settings as Record<string, unknown> | null,
        visibility,
      });
    }

    if (!marketRow) throw new Error('Failed to create market knowledge base');

    const stats = await this.copyLocalContentToMarket(knowledgeBaseId, identifier, marketRow.id);

    await this.marketKnowledgeBaseModel.updateByIdentifier(identifier, stats);

    await this.knowledgeBaseModel.update(knowledgeBaseId, {
      marketIdentifier: identifier,
    });

    return this.marketKnowledgeBaseModel.findByIdentifier(identifier);
  };

  installMarketToLocal = async (marketIdentifier: string) => {
    const marketKb = await this.marketKnowledgeBaseModel.findByIdentifier(marketIdentifier);
    if (!marketKb) throw new Error('Market knowledge base not found');

    const [existing] = await this.db
      .select()
      .from(knowledgeBases)
      .where(
        and(
          eq(knowledgeBases.installedFromMarketIdentifier, marketIdentifier),
          eq(knowledgeBases.userId, this.userId),
        ),
      )
      .limit(1);

    if (existing) {
      if (await this.isLocalKnowledgeBaseInstallIncomplete(existing.id, marketKb)) {
        await this.replaceLocalFromMarket(marketIdentifier);
      }
      return existing;
    }

    const [created] = await this.db
      .insert(knowledgeBases)
      .values({
        id: idGenerator('knowledgeBases'),
        avatar: marketKb.avatar,
        description: marketKb.description,
        installedFromMarketIdentifier: marketIdentifier,
        installedFromSnapshot: {
          description: marketKb.description,
          name: marketKb.name,
          type: marketKb.type,
        },
        installedMarketVersion: marketKb.version,
        marketIdentifier: null,
        name: marketKb.name,
        settings: marketKb.settings,
        type: marketKb.type,
        userId: this.userId,
      })
      .returning();

    try {
      await this.copyMarketContentToLocal(marketKb.id, marketIdentifier, created.id);
    } catch (error) {
      await this.knowledgeBaseModel.delete(created.id);
      throw error;
    }

    return created;
  };

  private isLocalKnowledgeBaseInstallIncomplete = async (
    localKnowledgeBaseId: string,
    marketKb: { documentCount?: number | null; fileCount?: number | null },
  ) => {
    const expectedContentCount = (marketKb.fileCount ?? 0) + (marketKb.documentCount ?? 0);
    if (expectedContentCount === 0) return false;

    const [fileCountRow] = await this.db
      .select({ count: count() })
      .from(knowledgeBaseFiles)
      .where(eq(knowledgeBaseFiles.knowledgeBaseId, localKnowledgeBaseId));

    const [docCountRow] = await this.db
      .select({ count: count() })
      .from(documents)
      .where(
        and(eq(documents.knowledgeBaseId, localKnowledgeBaseId), eq(documents.userId, this.userId)),
      );

    return (fileCountRow?.count ?? 0) + (docCountRow?.count ?? 0) === 0;
  };

  replaceLocalFromMarket = async (marketIdentifier: string) => {
    const marketKb = await this.marketKnowledgeBaseModel.findByIdentifier(marketIdentifier);
    if (!marketKb) throw new Error('Market knowledge base not found');

    const [localKb] = await this.db
      .select()
      .from(knowledgeBases)
      .where(
        and(
          eq(knowledgeBases.installedFromMarketIdentifier, marketIdentifier),
          eq(knowledgeBases.userId, this.userId),
        ),
      )
      .limit(1);

    if (!localKb) throw new Error('Installed knowledge base not found');

    await this.clearLocalKnowledgeBaseContent(localKb.id);
    await this.copyMarketContentToLocal(marketKb.id, marketIdentifier, localKb.id);

    await this.knowledgeBaseModel.update(localKb.id, {
      avatar: marketKb.avatar,
      description: marketKb.description,
      installedFromSnapshot: {
        description: marketKb.description,
        name: marketKb.name,
        type: marketKb.type,
      },
      installedMarketVersion: marketKb.version,
      name: marketKb.name,
      settings: marketKb.settings,
      type: marketKb.type,
    });

    return localKb;
  };

  private clearMarketSnapshotData = async (marketKnowledgeBaseRowId: string) => {
    const marketFiles = await this.db
      .select({ id: marketKbFiles.id })
      .from(marketKbFiles)
      .where(eq(marketKbFiles.marketKnowledgeBaseId, marketKnowledgeBaseRowId));
    const fileIds = marketFiles.map((file) => file.id);

    const marketDocs = await this.db
      .select({ id: marketKbDocuments.id })
      .from(marketKbDocuments)
      .where(eq(marketKbDocuments.marketKnowledgeBaseId, marketKnowledgeBaseRowId));
    const docIds = marketDocs.map((doc) => doc.id);

    if (fileIds.length > 0) {
      await this.db.delete(marketKbFileChunks).where(inArray(marketKbFileChunks.fileId, fileIds));
    }
    if (docIds.length > 0) {
      await this.db
        .delete(marketKbDocumentChunks)
        .where(inArray(marketKbDocumentChunks.documentId, docIds));
    }

    await this.db
      .delete(marketKbEmbeddings)
      .where(eq(marketKbEmbeddings.marketKnowledgeBaseId, marketKnowledgeBaseRowId));
    await this.db
      .delete(marketKbChunks)
      .where(eq(marketKbChunks.marketKnowledgeBaseId, marketKnowledgeBaseRowId));
    await this.db
      .delete(marketKbFileLinks)
      .where(eq(marketKbFileLinks.marketKnowledgeBaseId, marketKnowledgeBaseRowId));
    await this.db
      .delete(marketKbDocuments)
      .where(eq(marketKbDocuments.marketKnowledgeBaseId, marketKnowledgeBaseRowId));
    await this.db
      .delete(marketKbFiles)
      .where(eq(marketKbFiles.marketKnowledgeBaseId, marketKnowledgeBaseRowId));
  };

  private copyLocalContentToMarket = async (
    knowledgeBaseId: string,
    identifier: string,
    marketKnowledgeBaseRowId: string,
  ) => {
    const kbFileRows = await this.db
      .select({ file: files })
      .from(files)
      .innerJoin(knowledgeBaseFiles, eq(files.id, knowledgeBaseFiles.fileId))
      .where(
        and(eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId), eq(files.userId, this.userId)),
      );

    const kbDocuments = await this.documentModel.findByKnowledgeBaseId(knowledgeBaseId);
    const fileIds = new Set<string>(kbFileRows.map((row) => row.file.id));
    for (const doc of kbDocuments) {
      if (doc.fileId) fileIds.add(doc.fileId);
    }

    const fileIdList = [...fileIds];
    const fileChunkRows = fileIdList.length
      ? await this.db
          .select()
          .from(fileChunks)
          .where(and(inArray(fileChunks.fileId, fileIdList), eq(fileChunks.userId, this.userId)))
      : [];

    const docIdList = kbDocuments.map((doc) => doc.id);
    const documentChunkRows = docIdList.length
      ? await this.db
          .select()
          .from(documentChunks)
          .where(
            and(
              inArray(documentChunks.documentId, docIdList),
              eq(documentChunks.userId, this.userId),
            ),
          )
      : [];

    const chunkIds = new Set<string>([
      ...fileChunkRows.map((row) => row.chunkId!),
      ...documentChunkRows.map((row) => row.chunkId),
    ]);
    const chunkIdList = [...chunkIds];

    const chunkRows = chunkIdList.length
      ? await this.db
          .select()
          .from(chunks)
          .where(and(inArray(chunks.id, chunkIdList), eq(chunks.userId, this.userId)))
      : [];

    const embeddingRows = chunkIdList.length
      ? await this.db
          .select()
          .from(embeddings)
          .where(and(inArray(embeddings.chunkId, chunkIdList), eq(embeddings.userId, this.userId)))
      : [];

    for (const { file } of kbFileRows) {
      const s3Key = await this.copyToMarketS3(file.url, identifier, file.id, file.name);
      await this.db.insert(marketKbFiles).values({
        fileHash: file.fileHash,
        fileType: file.fileType,
        id: file.id,
        marketKnowledgeBaseId: marketKnowledgeBaseRowId,
        metadata: file.metadata as Record<string, unknown> | null,
        name: file.name,
        parentId: file.parentId,
        s3Key,
        size: file.size,
        source: file.source,
        sourceFileId: file.id,
      });
      await this.db.insert(marketKbFileLinks).values({
        fileId: file.id,
        marketKnowledgeBaseId: marketKnowledgeBaseRowId,
      });
    }

    for (const doc of kbDocuments) {
      await this.db.insert(marketKbDocuments).values({
        content: doc.content,
        editorData: doc.editorData as Record<string, unknown> | null,
        fileType: doc.fileType,
        filename: doc.filename,
        id: doc.id,
        marketKnowledgeBaseId: marketKnowledgeBaseRowId,
        metadata: doc.metadata as Record<string, unknown> | null,
        pages: doc.pages,
        parentId: doc.parentId,
        slug: doc.slug,
        source: doc.source,
        sourceDocumentId: doc.id,
        sourceFileId: doc.fileId,
        sourceType: doc.sourceType,
        title: doc.title,
        totalCharCount: doc.totalCharCount,
        totalLineCount: doc.totalLineCount,
        description: doc.description,
      });
    }

    for (const chunk of chunkRows) {
      await this.db.insert(marketKbChunks).values({
        abstract: chunk.abstract,
        id: chunk.id,
        index: chunk.index,
        marketKnowledgeBaseId: marketKnowledgeBaseRowId,
        metadata: chunk.metadata as Record<string, unknown> | null,
        sourceChunkId: chunk.id,
        text: chunk.text,
        type: chunk.type,
      });
    }

    for (const row of fileChunkRows) {
      if (!row.chunkId || !row.fileId) continue;
      await this.db.insert(marketKbFileChunks).values({
        chunkId: row.chunkId,
        fileId: row.fileId,
      });
    }

    for (const row of documentChunkRows) {
      await this.db.insert(marketKbDocumentChunks).values({
        chunkId: row.chunkId,
        documentId: row.documentId,
        pageIndex: row.pageIndex,
      });
    }

    for (const row of embeddingRows) {
      if (!row.chunkId) continue;
      await this.db.insert(marketKbEmbeddings).values({
        chunkId: row.chunkId,
        embeddings: row.embeddings,
        marketKnowledgeBaseId: marketKnowledgeBaseRowId,
        model: row.model,
      });
    }

    return {
      chunkCount: chunkRows.length,
      documentCount: kbDocuments.length,
      fileCount: kbFileRows.length,
    };
  };

  private copyMarketContentToLocal = async (
    marketKnowledgeBaseRowId: string,
    marketIdentifier: string,
    localKnowledgeBaseId: string,
  ) => {
    const marketFiles = await this.db
      .select()
      .from(marketKbFiles)
      .where(eq(marketKbFiles.marketKnowledgeBaseId, marketKnowledgeBaseRowId));

    const marketDocs = await this.db
      .select()
      .from(marketKbDocuments)
      .where(eq(marketKbDocuments.marketKnowledgeBaseId, marketKnowledgeBaseRowId));

    const marketChunks = await this.db
      .select()
      .from(marketKbChunks)
      .where(eq(marketKbChunks.marketKnowledgeBaseId, marketKnowledgeBaseRowId));

    const marketEmbeddings = await this.db
      .select()
      .from(marketKbEmbeddings)
      .where(eq(marketKbEmbeddings.marketKnowledgeBaseId, marketKnowledgeBaseRowId));

    const fileChunkRows = marketFiles.length
      ? await this.db
          .select()
          .from(marketKbFileChunks)
          .where(
            inArray(
              marketKbFileChunks.fileId,
              marketFiles.map((file) => file.id),
            ),
          )
      : [];

    const documentChunkRows = marketDocs.length
      ? await this.db
          .select()
          .from(marketKbDocumentChunks)
          .where(
            inArray(
              marketKbDocumentChunks.documentId,
              marketDocs.map((doc) => doc.id),
            ),
          )
      : [];

    const marketFileIdSet = new Set(marketFiles.map((file) => file.id));
    const marketDocIdSet = new Set(marketDocs.map((doc) => doc.id));

    const resolveSnapshotParentId = (
      parentId: string | null | undefined,
      idSet: Set<string>,
      idMap: Map<string, string>,
    ) => {
      if (!parentId || !idSet.has(parentId)) return undefined;
      return idMap.get(parentId);
    };

    const docIdMap = new Map(marketDocs.map((doc) => [doc.id, idGenerator('documents', 16)]));
    const pendingDocs = [...marketDocs];
    const insertedDocIds = new Set<string>();

    while (pendingDocs.length > 0) {
      const batch = pendingDocs.filter(
        (doc) =>
          !doc.parentId || !marketDocIdSet.has(doc.parentId) || insertedDocIds.has(doc.parentId),
      );
      if (batch.length === 0) {
        throw new Error('Invalid document hierarchy in market knowledge base snapshot');
      }

      for (const doc of batch) {
        const newDocId = docIdMap.get(doc.id)!;
        await this.db.insert(documents).values({
          content: doc.content,
          description: doc.description,
          editorData: doc.editorData as Record<string, unknown> | null,
          fileId: undefined,
          fileType: doc.fileType,
          filename: doc.filename,
          id: newDocId,
          knowledgeBaseId: localKnowledgeBaseId,
          metadata: doc.metadata as Record<string, unknown> | null,
          pages: doc.pages,
          parentId: resolveSnapshotParentId(doc.parentId, marketDocIdSet, docIdMap),
          source: doc.source,
          sourceType: doc.sourceType,
          title: doc.title,
          totalCharCount: doc.totalCharCount,
          totalLineCount: doc.totalLineCount,
          userId: this.userId,
        });
        insertedDocIds.add(doc.id);
      }

      pendingDocs.splice(
        0,
        pendingDocs.length,
        ...pendingDocs.filter((doc) => !insertedDocIds.has(doc.id)),
      );
    }

    const fileIdMap = new Map(marketFiles.map((file) => [file.id, idGenerator('files')]));

    for (const file of marketFiles) {
      const newFileId = fileIdMap.get(file.id)!;
      const installerKey = await this.copyFromMarketS3(
        file.s3Key,
        marketIdentifier,
        file.id,
        file.name,
      );
      const { isExist } = await this.fileModel.checkHash(file.fileHash || file.id);
      await this.fileModel.create(
        {
          fileHash: file.fileHash || file.id,
          fileType: file.fileType,
          id: newFileId,
          name: file.name,
          parentId: resolveSnapshotParentId(file.parentId, marketDocIdSet, docIdMap),
          size: file.size,
          url: installerKey,
          metadata: file.metadata as Record<string, unknown> | null,
          source: file.source as any,
        },
        !isExist,
      );
      await this.db.insert(knowledgeBaseFiles).values({
        fileId: newFileId,
        knowledgeBaseId: localKnowledgeBaseId,
        userId: this.userId,
      });
    }

    // Link documents to copied files after both are created.
    for (const doc of marketDocs) {
      if (!doc.sourceFileId || !marketFileIdSet.has(doc.sourceFileId)) continue;
      const newDocId = docIdMap.get(doc.id);
      const newFileId = fileIdMap.get(doc.sourceFileId);
      if (!newDocId || !newFileId) continue;

      await this.db
        .update(documents)
        .set({ fileId: newFileId })
        .where(and(eq(documents.id, newDocId), eq(documents.userId, this.userId)));
    }

    const chunkIdMap = new Map(marketChunks.map((chunk) => [chunk.id, randomUUID()]));
    for (const chunk of marketChunks) {
      await this.db.insert(chunks).values({
        abstract: chunk.abstract,
        id: chunkIdMap.get(chunk.id)!,
        index: chunk.index,
        metadata: chunk.metadata as Record<string, unknown> | null,
        text: chunk.text,
        type: chunk.type,
        userId: this.userId,
      });
    }

    for (const row of fileChunkRows) {
      const fileId = fileIdMap.get(row.fileId);
      const chunkId = chunkIdMap.get(row.chunkId);
      if (!fileId || !chunkId) continue;

      await this.db.insert(fileChunks).values({
        chunkId,
        fileId,
        userId: this.userId,
      });
    }

    for (const row of documentChunkRows) {
      const documentId = docIdMap.get(row.documentId);
      const chunkId = chunkIdMap.get(row.chunkId);
      if (!documentId || !chunkId) continue;

      await this.db.insert(documentChunks).values({
        chunkId,
        documentId,
        pageIndex: row.pageIndex,
        userId: this.userId,
      });
    }

    for (const row of marketEmbeddings) {
      const chunkId = chunkIdMap.get(row.chunkId);
      if (!chunkId) continue;

      await this.db.insert(embeddings).values({
        chunkId,
        embeddings: row.embeddings,
        model: row.model,
        userId: this.userId,
      });
    }
  };

  purgeLocalKnowledgeBaseContent = async (knowledgeBaseId: string) => {
    await this.clearLocalKnowledgeBaseContent(knowledgeBaseId);
  };

  private clearLocalKnowledgeBaseContent = async (knowledgeBaseId: string) => {
    const docs = await this.documentModel.findByKnowledgeBaseId(knowledgeBaseId);
    const docIds = docs.map((doc) => doc.id);

    const docChunkRows =
      docIds.length > 0
        ? await this.db
            .select({ chunkId: documentChunks.chunkId })
            .from(documentChunks)
            .where(
              and(
                inArray(documentChunks.documentId, docIds),
                eq(documentChunks.userId, this.userId),
              ),
            )
        : [];
    const docChunkIds = [...new Set(docChunkRows.map((row) => row.chunkId))];

    const kbFileRows = await this.db
      .select({ fileId: knowledgeBaseFiles.fileId })
      .from(knowledgeBaseFiles)
      .where(eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId));

    for (const { fileId } of kbFileRows) {
      await this.fileModel.delete(fileId, true);
    }

    // Page-only chunks are linked via document_chunks; deleting documents does not remove chunks.
    if (docChunkIds.length > 0) {
      await this.db.delete(embeddings).where(inArray(embeddings.chunkId, docChunkIds));
      await this.db
        .delete(chunks)
        .where(and(inArray(chunks.id, docChunkIds), eq(chunks.userId, this.userId)));
    }

    if (docs.length > 0) {
      await this.db
        .delete(documents)
        .where(
          and(eq(documents.knowledgeBaseId, knowledgeBaseId), eq(documents.userId, this.userId)),
        );
    }
  };

  private copyToMarketS3 = async (
    sourceKey: string,
    identifier: string,
    fileId: string,
    fileName: string,
  ) => {
    if (!sourceKey || sourceKey.startsWith('http') || sourceKey.startsWith('internal://')) {
      return sourceKey;
    }
    try {
      const buffer = Buffer.from(await this.fileService.getFileByteArray(sourceKey));
      const targetKey = `${marketS3Prefix(identifier)}/files/${fileId}/${fileName}`;
      await this.fileService.uploadBuffer(targetKey, buffer, 'application/octet-stream');
      return targetKey;
    } catch {
      return sourceKey;
    }
  };

  private copyFromMarketS3 = async (
    sourceKey: string,
    marketIdentifier: string,
    fileId: string,
    fileName: string,
  ) => {
    if (!sourceKey || sourceKey.startsWith('http') || sourceKey.startsWith('internal://')) {
      return sourceKey;
    }

    try {
      const buffer = Buffer.from(await this.fileService.getFileByteArray(sourceKey));
      const targetKey = `${installerS3Prefix(this.userId)}/market-import/${marketIdentifier}/${fileId}/${fileName}`;
      await this.fileService.uploadBuffer(targetKey, buffer, 'application/octet-stream');
      return targetKey;
    } catch (error) {
      console.error('[KnowledgeBaseMarket] Failed to copy file from market S3:', {
        error,
        fileId,
        marketIdentifier,
        sourceKey,
      });
      throw error;
    }
  };
}
