import { builtinSkills } from '@lobechat/builtin-skills';
import { LocalSystemApiName, LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import { type CommandResult, SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import {
  type ExportFileResult,
  type SkillRuntimeService,
  SkillsExecutionRuntime,
} from '@lobechat/builtin-tool-skills/executionRuntime';
import type { SkillItem, SkillListItem, SkillResourceContent } from '@lobechat/types';
import type { CodeInterpreterToolName } from '@lobehub/market-sdk';
import debug from 'debug';
import { sha256 } from 'js-sha256';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { FileModel } from '@/database/models/file';
import { UserModel } from '@/database/models/user';
import { filterBuiltinSkills } from '@/helpers/skillFilters';
import { FileS3 } from '@/server/modules/S3';
import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import { SkillResourceService } from '@/server/services/skill/resource';
import { preprocessLhCommand } from '@/server/services/toolExecution/preprocessLhCommand';

import { deviceProxy } from '../deviceProxy';
import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:skills-runtime');
const WEB_UNSAFE_SKILL_MESSAGE =
  'Skill has not passed security scan for web usage. Please sync it to web first.';

export class SkillServerRuntimeService implements SkillRuntimeService {
  private resourceService: SkillResourceService;
  private skillModel: AgentSkillModel;
  private marketService: MarketService;
  private fileService: FileService;
  private fileModel: FileModel;
  private topicId?: string;
  private userId: string;
  private activeDeviceId?: string;

  constructor(options: {
    activeDeviceId?: string;
    fileModel: FileModel;
    fileService: FileService;
    marketService: MarketService;
    resourceService: SkillResourceService;
    skillModel: AgentSkillModel;
    topicId?: string;
    userId: string;
  }) {
    this.skillModel = options.skillModel;
    this.resourceService = options.resourceService;
    this.marketService = options.marketService;
    this.fileService = options.fileService;
    this.fileModel = options.fileModel;
    this.topicId = options.topicId;
    this.userId = options.userId;
    this.activeDeviceId = options.activeDeviceId;
  }

  /**
   * Run a skill shell command on the active `lh connect` device instead of the
   * cloud sandbox. Mirrors the desktop client (which runs skill commands
   * locally): the bundled CLI (lark-cli / lh) lives on the device's PATH, so we
   * forward the raw command through the device's `local-system` runCommand —
   * the one device-side tool contract we know is supported.
   *
   * Note: this forwards only the command + description. Zip-bundled DB skills
   * that need their archive mounted are not handled here (builtin desktop skills
   * like lark-cli are global binaries with no archive, which is the case this
   * device routing targets).
   */
  private runOnDevice = async (command: string, description: string): Promise<CommandResult> => {
    const result = await deviceProxy.executeToolCall(
      { deviceId: this.activeDeviceId!, userId: this.userId },
      {
        apiName: LocalSystemApiName.runCommand,
        arguments: JSON.stringify({ command, description }),
        identifier: LocalSystemIdentifier,
      },
      // Skill commands (e.g. lark-cli calls) can exceed the 30s default.
      120_000,
    );

    return {
      exitCode: result.success ? 0 : 1,
      output: result.success ? result.content : '',
      stderr: result.success ? '' : result.error || result.content,
      success: result.success,
    };
  };

  private isCloudRuntime = () => !this.activeDeviceId;

  private isSkillWebAvailable = (skill: SkillItem | SkillListItem) =>
    !this.isCloudRuntime() || skill.webSafeScanPassed !== false;

  findAll = (): Promise<{ data: SkillListItem[]; total: number }> => {
    return this.skillModel.findAll().then((result) => {
      if (!this.isCloudRuntime()) return result;

      const data = result.data.filter((skill) => this.isSkillWebAvailable(skill));
      return { data, total: data.length };
    });
  };

  findById = async (id: string): Promise<SkillItem | undefined> => {
    const skill = await this.skillModel.findById(id);
    if (!skill || !this.isSkillWebAvailable(skill)) return undefined;

    return skill;
  };

  findByName = async (name: string): Promise<SkillItem | undefined> => {
    const skill = await this.skillModel.findByName(name);
    if (!skill || !this.isSkillWebAvailable(skill)) return undefined;

    return skill;
  };

  readResource = async (id: string, path: string): Promise<SkillResourceContent> => {
    const skill = await this.skillModel.findById(id);
    if (!skill) throw new Error(`Skill not found: ${id}`);
    if (!this.isSkillWebAvailable(skill)) throw new Error(WEB_UNSAFE_SKILL_MESSAGE);
    if (!skill.resources) throw new Error(`Skill has no resources: ${id}`);
    return this.resourceService.readResource(skill.resources, path);
  };

  runCommand = async (options: { command: string }): Promise<CommandResult> => {
    // When a device is active, run on the device (where the bundled CLI lives)
    // rather than the cloud sandbox.
    if (this.activeDeviceId) {
      return this.runOnDevice(options.command, 'Execute skill command');
    }

    if (!this.topicId) {
      throw new Error('topicId is required for runCommand');
    }

    // Preprocess lh commands: rewrite to npx @ctrip/tripyoyo-cli + inject auth env vars
    const lhResult = await preprocessLhCommand(options.command, this.userId);
    if (lhResult.error) {
      return { exitCode: 1, output: '', stderr: lhResult.error, success: false };
    }

    try {
      const market = this.marketService.market;
      const response = await market.plugins.runBuildInTool(
        'runCommand' as any,
        { command: lhResult.command },
        { topicId: this.topicId, userId: this.userId },
      );

      log('runCommand response: %O', response);

      if (!response.success) {
        return {
          exitCode: 1,
          output: '',
          stderr: response.error?.message || 'Command execution failed',
          success: false,
        };
      }

      const result = response.data?.result || {};

      return {
        exitCode: result.exitCode ?? (response.success ? 0 : 1),
        output: result.stdout || result.output || '',
        stderr: result.stderr || '',
        success: response.success && (result.exitCode === 0 || result.exitCode === undefined),
      };
    } catch (error) {
      log('Error running command: %O', error);
      return {
        exitCode: 1,
        output: '',
        stderr: (error as Error).message || 'Command execution failed',
        success: false,
      };
    }
  };

  execScript = async (
    command: string,
    options: {
      config?: { description?: string; id?: string; name?: string };
      description: string;
      runInClient?: boolean;
    },
  ): Promise<CommandResult> => {
    const { config, description } = options;

    // When a device is active, run on the device (where the bundled CLI lives,
    // e.g. lark-cli) rather than the cloud sandbox — mirroring the desktop
    // client, which runs skill commands locally.
    if (this.activeDeviceId) {
      return this.runOnDevice(command, description);
    }

    if (!this.topicId) {
      throw new Error('topicId is required for execScript');
    }

    try {
      // Look up skill zipUrl if config is provided (same logic as market.ts)
      const enhancedParams: any = {
        command,
        config,
        description,
      };

      if (config?.name) {
        const skill = await this.skillModel.findByName(config.name);

        // If skill not found, return error with available skills
        if (!skill) {
          const allSkills = await this.skillModel.findAll();
          const availableSkills = allSkills.data.map((s) => s.name).join(', ');

          const errorMessage = availableSkills
            ? `Skill "${config.name}" not found. Available skills: ${availableSkills}`
            : `Skill "${config.name}" not found. No skills available. Please import a skill first.`;

          log('Skill not found: %s. Available skills: %s', config.name, availableSkills);

          return {
            exitCode: 1,
            output: '',
            stderr: errorMessage,
            success: false,
          };
        }

        if (!this.isSkillWebAvailable(skill)) {
          return {
            exitCode: 1,
            output: '',
            stderr: WEB_UNSAFE_SKILL_MESSAGE,
            success: false,
          };
        }

        if (skill.zipFileHash) {
          // Get S3 key from globalFiles
          const fileInfo = await this.fileModel.checkHash(skill.zipFileHash);

          if (fileInfo.isExist && fileInfo.url) {
            // Convert S3 key to full URL
            const fullUrl = await this.fileService.getFullFileUrl(fileInfo.url);
            if (fullUrl) {
              enhancedParams.zipUrl = fullUrl;
              log('Added zipUrl to execScript params for skill %s: %s', skill.name, fullUrl);
            }
          }
        }
      }

      // Call market-sdk's runBuildInTool
      const market = this.marketService.market;
      const response = await market.plugins.runBuildInTool(
        'execScript' as CodeInterpreterToolName,
        enhancedParams,
        { topicId: this.topicId, userId: this.userId },
      );

      log('execScript response: %O', response);

      if (!response.success) {
        return {
          exitCode: 1,
          output: '',
          stderr: response.error?.message || 'Command execution failed',
          success: false,
        };
      }

      const result = response.data?.result || {};

      return {
        exitCode: result.exitCode ?? (response.success ? 0 : 1),
        output: result.stdout || result.output || '',
        stderr: result.stderr || '',
        success: response.success && (result.exitCode === 0 || result.exitCode === undefined),
      };
    } catch (error) {
      log('Error executing script: %O', error);
      return {
        exitCode: 1,
        output: '',
        stderr: (error as Error).message || 'Command execution failed',
        success: false,
      };
    }
  };

  exportFile = async (path: string, filename: string): Promise<ExportFileResult> => {
    if (!this.topicId) {
      throw new Error('topicId is required for exportFile');
    }

    try {
      const s3 = new FileS3();

      // Use date-based sharding (same as market.ts)
      const today = new Date().toISOString().split('T')[0];
      const key = `code-interpreter-exports/${today}/${this.topicId}/${filename}`;

      // Step 1: Generate pre-signed upload URL
      const uploadUrl = await s3.createPreSignedUrl(key);
      log('Generated upload URL for key: %s', key);

      // Step 2: Call sandbox's exportFile tool with the upload URL
      const market = this.marketService.market;
      const response = await market.plugins.runBuildInTool(
        'exportFile' as CodeInterpreterToolName,
        { path, uploadUrl },
        { topicId: this.topicId, userId: this.userId },
      );

      log('Sandbox exportFile response: %O', response);

      if (!response.success) {
        return {
          filename,
          success: false,
        };
      }

      const result = response.data?.result;
      const uploadSuccess = result?.success !== false;

      if (!uploadSuccess) {
        return {
          filename,
          success: false,
        };
      }

      // Step 3: Get file metadata from S3
      const metadata = await s3.getFileMetadata(key);
      const fileSize = metadata.contentLength;
      const mimeType = metadata.contentType || result?.mimeType || 'application/octet-stream';

      // Step 4: Create persistent file record
      const fileHash = sha256(key + Date.now().toString());

      const { fileId, url } = await this.fileService.createFileRecord({
        fileHash,
        fileType: mimeType,
        name: filename,
        size: fileSize,
        url: key, // Store S3 key
      });

      log('Created file record: fileId=%s, url=%s', fileId, url);

      return {
        fileId,
        filename,
        mimeType,
        size: fileSize,
        success: true,
        url, // This is the permanent /f:id URL
      };
    } catch (error) {
      log('Error exporting file: %O', error);
      return {
        filename,
        success: false,
      };
    }
  };
}

/**
 * Skills Server Runtime
 * Per-request runtime (needs serverDB, userId, topicId)
 */
export const skillsRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for Skills execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for Skills execution');
    }

    // Fetch market access token from user settings
    let marketAccessToken: string | undefined;
    try {
      const userModel = new UserModel(context.serverDB, context.userId);
      const userSettings = await userModel.getUserSettings();
      marketAccessToken = (userSettings?.market as any)?.accessToken;
      log(
        'Fetched market accessToken for user %s: %s',
        context.userId,
        marketAccessToken ? 'exists' : 'not found',
      );
    } catch (error) {
      log('Failed to fetch market accessToken for user %s: %O', context.userId, error);
    }

    const skillModel = new AgentSkillModel(context.serverDB, context.userId);
    const resourceService = new SkillResourceService(context.serverDB, context.userId);
    const marketService = new MarketService({
      accessToken: marketAccessToken,
      serverDB: context.serverDB,
      userInfo: { userId: context.userId },
    });
    const fileService = new FileService(context.serverDB, context.userId);
    const fileModel = new FileModel(context.serverDB, context.userId);

    const service = new SkillServerRuntimeService({
      activeDeviceId: context.activeDeviceId,
      fileModel,
      fileService,
      marketService,
      resourceService,
      skillModel,
      topicId: context.topicId,
      userId: context.userId,
    });

    return new SkillsExecutionRuntime({
      // Desktop-only skills (lark-cli / open-cli) become
      // activatable on the cloud when an online device can run their bundled
      // CLI on the user's behalf. Keep advertise (`aiAgent` skillMetas) and
      // execute filters aligned so the model is never offered a skill it can't
      // activate (the silent "Skill not found" class of bug).
      builtinSkills: filterBuiltinSkills(builtinSkills, {
        activeDevice: !!context.activeDeviceId,
        isDesktop: false,
      }),
      service,
    });
  },
  identifier: SkillsIdentifier,
};
