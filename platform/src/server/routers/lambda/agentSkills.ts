import type { SkillManifest } from '@lobechat/types';
import { skillManifestSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { ClientPlatform } from '@/const/clientPlatform';
import { CLIENT_PLATFORM_DESKTOP } from '@/const/clientPlatform';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { FileModel } from '@/database/models/file';
import {
  encodeSkillImportMessage,
  mapSkillImportErrorCode,
  parseErrorToPayload,
  skillImportErrorToPayload,
} from '@/helpers/skillImportMessage';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import {
  SkillImporter,
  SkillImportError,
  SkillManifestError,
  SkillParseError,
  SkillParser,
  SkillResourceError,
  SkillResourceService,
} from '@/server/services/skill';
import { SkillSecurityScanner } from '@/server/services/skill/securityScanner';

// ===== Error Handling =====

const skillImportErrorToTRPCCode = (
  code: SkillImportError['code'],
): 'CONFLICT' | 'BAD_REQUEST' | 'NOT_FOUND' | 'BAD_GATEWAY' | 'FORBIDDEN' => {
  switch (code) {
    case 'CONFLICT': {
      return 'CONFLICT';
    }

    case 'SECURITY_SCAN_REJECTED': {
      return 'FORBIDDEN';
    }

    case 'NOT_FOUND':
    case 'FILE_NOT_FOUND': {
      return 'NOT_FOUND';
    }

    case 'DOWNLOAD_FAILED': {
      return 'BAD_GATEWAY';
    }

    default: {
      return 'BAD_REQUEST';
    }
  }
};

const handleSkillImportError = (error: unknown): never => {
  if (error instanceof SkillImportError) {
    throw new TRPCError({
      code: skillImportErrorToTRPCCode(error.code),
      message: encodeSkillImportMessage(
        mapSkillImportErrorCode(error),
        skillImportErrorToPayload(error),
      ),
    });
  }

  if (error instanceof SkillParseError) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: encodeSkillImportMessage(error.code, parseErrorToPayload(error)),
    });
  }

  if (error instanceof SkillManifestError) {
    const invalidManifestPrefix = 'Invalid skill manifest: ';
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: encodeSkillImportMessage('INVALID_MANIFEST', {
        detail: error.message.startsWith(invalidManifestPrefix)
          ? error.message.slice(invalidManifestPrefix.length)
          : error.message,
      }),
    });
  }

  throw error;
};

// ===== Procedure with Context =====

const skillProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      fileService: new FileService(ctx.serverDB, ctx.userId),
      marketService: new MarketService({
        serverDB: ctx.serverDB,
        userInfo: { userId: ctx.userId },
      }),
      skillImporter: new SkillImporter(ctx.serverDB, ctx.userId),
      skillModel: new AgentSkillModel(ctx.serverDB, ctx.userId),
      skillParser: new SkillParser(),
      skillResourceService: new SkillResourceService(ctx.serverDB, ctx.userId),
    },
  });
});

// ===== Input Schemas =====

const createSkillSchema = z.object({
  content: z.string(),
  description: z.string().min(1),
  identifier: z.string().optional(),
  manifest: skillManifestSchema.partial().optional(),
  name: z.string().min(1),
});

const updateSkillSchema = z.object({
  content: z.string().optional(),
  id: z.string(),
  // All metadata should be passed through manifest
  manifest: skillManifestSchema.partial().optional(),
});

const importOptionsSchema = z.object({
  scanId: z.string().optional(),
  skipSecurityScan: z.boolean().optional(),
});

export const normalizeImportOptions = (
  { scanId, skipSecurityScan }: z.infer<typeof importOptionsSchema>,
  ctx: { clientPlatform?: ClientPlatform },
) => ({
  scanId,
  skipSecurityScan: ctx.clientPlatform === CLIENT_PLATFORM_DESKTOP && skipSecurityScan,
});

// ===== Router =====

export const agentSkillsRouter = router({
  // ===== Security Scan =====

  startScanForZip: skillProcedure
    .input(z.object({ zipFileId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const scanId = await ctx.skillImporter.startScanForZip(input);
        return { scanId };
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  startScanForGitHub: skillProcedure
    .input(z.object({ branch: z.string().optional(), gitUrl: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const scanId = await ctx.skillImporter.startScanForGitHub(input);
        return { scanId };
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  startScanForUrl: skillProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const scanId = await ctx.skillImporter.startScanForUrl(input.url);
        return { scanId };
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  getScanStatus: skillProcedure.input(z.object({ scanId: z.string() })).query(async ({ input }) => {
    const scanner = new SkillSecurityScanner();
    if (!scanner.enabled) {
      return { scanId: input.scanId, status: 'completed' };
    }
    try {
      return await scanner.fetchScanStatus(input.scanId);
    } catch (error) {
      handleSkillImportError(error);
    }
  }),

  syncToWeb: skillProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.skillImporter.syncToWeb(input.id);
    } catch (error) {
      handleSkillImportError(error);
    }
  }),

  // ===== Create =====

  create: skillProcedure.input(createSkillSchema).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.skillImporter.createUserSkill(input);
    } catch (error) {
      handleSkillImportError(error);
    }
  }),

  // ===== Delete =====

  delete: skillProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    return ctx.skillModel.delete(input.id);
  }),

  // ===== Query =====

  getById: skillProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    return ctx.skillModel.findById(input.id);
  }),

  getByIdWithZipUrl: skillProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const skill = await ctx.skillModel.findById(input.id);
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
      }

      if (!skill.zipFileHash) {
        return { name: skill.name, url: null };
      }

      const fileInfo = await ctx.fileModel.checkHash(skill.zipFileHash);
      if (!fileInfo.isExist || !fileInfo.url) {
        return { name: skill.name, url: null };
      }

      const fullUrl = await ctx.fileService.getFullFileUrl(fileInfo.url);
      return { name: skill.name, url: fullUrl || null };
    }),

  getByIdentifier: skillProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.skillModel.findByIdentifier(input.identifier);
    }),

  getByName: skillProcedure.input(z.object({ name: z.string() })).query(async ({ ctx, input }) => {
    return ctx.skillModel.findByName(input.name);
  }),

  importFromGitHub: skillProcedure
    .input(
      z
        .object({
          branch: z.string().optional(),
          gitUrl: z.string().url(),
        })
        .merge(importOptionsSchema),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { scanId, skipSecurityScan, ...importInput } = input;
        return await ctx.skillImporter.importFromGitHub(
          importInput,
          normalizeImportOptions({ scanId, skipSecurityScan }, ctx),
        );
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  importFromUrl: skillProcedure
    .input(z.object({ url: z.string().url() }).merge(importOptionsSchema))
    .mutation(async ({ ctx, input }) => {
      try {
        const { scanId, skipSecurityScan, ...importInput } = input;
        return await ctx.skillImporter.importFromUrl(
          importInput,
          normalizeImportOptions({ scanId, skipSecurityScan }, ctx),
        );
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  importFromZip: skillProcedure
    .input(z.object({ zipFileId: z.string() }).merge(importOptionsSchema))
    .mutation(async ({ ctx, input }) => {
      try {
        const { scanId, skipSecurityScan, ...importInput } = input;
        return await ctx.skillImporter.importFromZip(
          importInput,
          normalizeImportOptions({ scanId, skipSecurityScan }, ctx),
        );
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  importFromMarket: skillProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        // Get download URL from market service
        const downloadUrl = ctx.marketService.getSkillDownloadUrl(input.identifier);
        // Import using the download URL
        return await ctx.skillImporter.importFromUrl(
          { url: downloadUrl },
          { identifier: input.identifier, source: 'market' },
        );
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  list: skillProcedure
    .input(
      z
        .object({
          source: z.enum(['builtin', 'market', 'user']).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (input?.source) {
        return ctx.skillModel.listBySource(input.source);
      }

      return ctx.skillModel.findAll();
    }),

  listResources: skillProcedure
    .input(z.object({ id: z.string(), includeContent: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const skill = await ctx.skillModel.findById(input.id);
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
      }

      if (!skill.resources) {
        return [];
      }

      return ctx.skillResourceService.listResources(skill.resources, input.includeContent);
    }),

  readResource: skillProcedure
    .input(
      z.object({
        id: z.string(),
        path: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const skill = await ctx.skillModel.findById(input.id);
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
      }

      if (!skill.resources || Object.keys(skill.resources).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Skill has no resources' });
      }

      try {
        return await ctx.skillResourceService.readResource(skill.resources, input.path);
      } catch (error) {
        if (error instanceof SkillResourceError) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
        }

        throw error;
      }
    }),

  search: skillProcedure.input(z.object({ query: z.string() })).query(async ({ ctx, input }) => {
    return ctx.skillModel.search(input.query);
  }),

  // ===== Update =====

  update: skillProcedure.input(updateSkillSchema).mutation(async ({ ctx, input }) => {
    const { id, content, manifest } = input;
    const existing = await ctx.skillModel.findById(id);
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
    }

    // Determine whether this edit affects anything that requires re-scanning.
    // Cosmetic-only changes (icon / backgroundColor / description / display name)
    // MUST NOT reset webSafeScanPassed — otherwise updating an avatar demotes
    // an already-published web-safe skill to "desktop-only".
    const COSMETIC_FIELDS = new Set(['icon', 'avatar', 'backgroundColor', 'description', 'name']);
    const contentChanged = content !== undefined && content !== (existing.content ?? '');
    const manifestChanged =
      manifest !== undefined &&
      Object.keys(manifest).some((key) => {
        if (COSMETIC_FIELDS.has(key)) return false;
        const prev = (existing.manifest as Record<string, unknown> | null)?.[key];
        return JSON.stringify(prev) !== JSON.stringify((manifest as Record<string, unknown>)[key]);
      });
    const requiresRescan = contentChanged || manifestChanged;

    let zipFileHash: string | undefined;
    if (existing.zipFileHash && (content !== undefined || manifest !== undefined)) {
      const resources = new Map<string, Buffer>();

      for (const path of Object.keys(existing.resources ?? {}).sort()) {
        const resource = await ctx.skillResourceService.readResource(existing.resources!, path);
        resources.set(
          path,
          Buffer.from(resource.content, resource.encoding === 'base64' ? 'base64' : 'utf8'),
        );
      }

      const nextManifest = { ...existing.manifest, ...manifest } as SkillManifest;
      const nextContent = content ?? existing.content ?? '';
      const { buffer, hash } = await ctx.skillParser.buildSkillZipPackage({
        content: nextContent,
        manifest: nextManifest,
        resources,
      });
      const zipKey = `skills/zip/${hash}.zip`;

      await ctx.fileService.uploadBuffer(zipKey, buffer, 'application/zip');
      await ctx.fileService.createGlobalFile({
        fileHash: hash,
        fileType: 'application/zip',
        metadata: {
          dirname: 'skills/zip',
          filename: `${hash}.zip`,
          path: zipKey,
        },
        size: buffer.length,
        url: zipKey,
      });
      zipFileHash = hash;
    }

    return ctx.skillModel.update(id, {
      content,
      // Sync name/description from manifest to top-level fields
      description: manifest?.description,
      manifest: manifest as SkillManifest | undefined,
      name: manifest?.name,
      ...(requiresRescan ? { webSafeScanPassed: false } : {}),
      ...(zipFileHash && { zipFileHash }),
    });
  }),
});

export type AgentSkillsRouter = typeof agentSkillsRouter;
