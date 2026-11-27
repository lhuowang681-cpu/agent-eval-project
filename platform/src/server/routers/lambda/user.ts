import { isDesktop } from '@lobechat/const';
import {
  type UserInitializationState,
  type UserPreference,
  type UserSettings,
} from '@lobechat/types';
import {
  Plans,
  UserGuideSchema,
  UserOnboardingSchema,
  UserPreferenceSchema,
  UserSettingsSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { after } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { getReferralStatus, getSubscriptionPlan } from '@/business/server/user';
import { MessageModel } from '@/database/models/message';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import { appEnv } from '@/envs/app';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { FileS3 } from '@/server/modules/S3';
import { FileService } from '@/server/services/file';

const usernameSchema = z
  .string()
  .trim()
  .min(1, { message: 'USERNAME_REQUIRED' })
  .max(64, { message: 'USERNAME_TOO_LONG' })
  .regex(/^\w+$/, { message: 'USERNAME_INVALID' });

const userProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  return next({
    ctx: {
      fileService: new FileService(ctx.serverDB, ctx.userId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      sessionModel: new SessionModel(ctx.serverDB, ctx.userId),
      userModel: new UserModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const userRouter = router({
  getUserRegistrationDuration: userProcedure.query(async ({ ctx }) => {
    return ctx.userModel.getUserRegistrationDuration();
  }),

  getUserSSOProviders: userProcedure.query(async ({ ctx }) => {
    return ctx.userModel.getUserSSOProviders();
  }),

  getUserState: userProcedure.query(async ({ ctx }): Promise<UserInitializationState> => {
    try {
      after(async () => {
        try {
          await ctx.userModel.updateUser({ lastActiveAt: new Date() });
        } catch (err) {
          console.error('update lastActiveAt failed, error:', err);
        }
      });
    } catch {
      // `after` may fail outside request scope (e.g., in tests), ignore silently
    }

    // For desktop mode, ensure user exists before getting state
    if (isDesktop) {
      await UserModel.makeSureUserExist(ctx.serverDB, ctx.userId);
    }

    // Run user state fetch and count queries in parallel
    const [state, messageCount, hasExtraSession, referralStatus, subscriptionPlan] =
      await Promise.all([
        ctx.userModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults),
        ctx.messageModel.countUpTo(5),
        ctx.sessionModel.hasMoreThanN(1),
        getReferralStatus(ctx.userId),
        getSubscriptionPlan(ctx.userId),
      ]);

    const hasMoreThan4Messages = messageCount > 4;
    const hasAnyMessages = messageCount > 0;
    return {
      avatar: state.avatar,
      canEnablePWAGuide: hasMoreThan4Messages,
      canEnableTrace: hasMoreThan4Messages,
      email: state.email,
      feishuOpenId: state.feishuOpenId,
      feishuUnionId: state.feishuUnionId,
      firstName: state.firstName,
      fullName: state.fullName,

      // Has conversation if there are messages or has created any assistant
      hasConversation: hasAnyMessages || hasExtraSession,

      interests: state.interests,

      // always return true for community version
      isOnboard: state.isOnboarded ?? true,
      lastName: state.lastName,
      mcpAdaToken: state.mcpAdaToken,
      onboarding: state.onboarding,
      preference: state.preference as UserPreference,
      settings: state.settings,
      userId: ctx.userId,
      username: state.username,

      // business features
      referralStatus,
      subscriptionPlan,
      isFreePlan: !subscriptionPlan || subscriptionPlan === Plans.Free,
    } satisfies UserInitializationState;
  }),

  makeUserOnboarded: userProcedure.mutation(async ({ ctx }) => {
    return ctx.userModel.updateUser({ isOnboarded: true });
  }),

  resetSettings: userProcedure.mutation(async ({ ctx }) => {
    return ctx.userModel.deleteSetting();
  }),

  updateAvatar: userProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    // If it's Base64 data, need to upload to S3
    if (input.startsWith('data:image')) {
      try {
        // Extract mimeType, e.g., "image/png"
        const prefix = 'data:';
        const semicolonIndex = input.indexOf(';');
        const mimeType =
          semicolonIndex !== -1 ? input.slice(prefix.length, semicolonIndex) : 'image/png';
        const fileType = mimeType.split('/')[1];

        // Split string to get the Base64 part
        const commaIndex = input.indexOf(',');
        if (commaIndex === -1) {
          throw new Error('Invalid Base64 data');
        }
        const base64Data = input.slice(commaIndex + 1);

        // Create S3 client
        const s3 = new FileS3();

        // Use UUID to generate unique filename to prevent caching issues
        // Get old avatar URL for later deletion
        const userState = await ctx.userModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults);
        const oldAvatarUrl = userState.avatar;

        const fileName = `${uuidv4()}.${fileType}`;
        const filePath = `user/avatar/${ctx.userId}/${fileName}`;

        // Convert Base64 data to Buffer and upload to S3
        const buffer = Buffer.from(base64Data, 'base64');

        await s3.uploadBuffer(filePath, buffer, mimeType);

        // Delete old avatar
        if (oldAvatarUrl && oldAvatarUrl.startsWith('/webapi/')) {
          const oldFilePath = oldAvatarUrl.replace('/webapi/', '');
          await s3.deleteFile(oldFilePath);
        }

        const avatarUrl = '/webapi/' + filePath;

        return ctx.userModel.updateUser({ avatar: avatarUrl });
      } catch (error) {
        throw new Error(
          'Error uploading avatar: ' + (error instanceof Error ? error.message : String(error)),
          { cause: error },
        );
      }
    }

    // If it's not Base64 data, directly use URL to update user avatar
    return ctx.userModel.updateUser({ avatar: input });
  }),

  updateFeishuBinding: userProcedure
    .input(
      z.object({
        feishuOpenId: z.string().min(1),
        feishuUnionId: z.string().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.userModel.updateUser({
        feishuOpenId: input.feishuOpenId,
        feishuUnionId: input.feishuUnionId ?? null,
      });
    }),

  syncFeishuBindingFromToken: userProcedure
    .input(z.object({ accessToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const response = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${input.accessToken}` },
      });
      if (!response.ok) return null;

      const payload = (await response.json()) as {
        code?: number;
        data?: {
          open_id?: string;
          union_id?: string;
        };
      };
      if (payload.code && payload.code !== 0) return null;

      const profile = payload.data;
      if (!profile?.open_id) return null;

      return ctx.userModel.updateUser({
        feishuOpenId: profile.open_id,
        feishuUnionId: profile.union_id ?? null,
      });
    }),

  updateFullName: userProcedure
    .input(z.string().trim().max(64, { message: 'FULLNAME_TOO_LONG' }))
    .mutation(async ({ ctx, input }) => {
      return ctx.userModel.updateUser({ fullName: input });
    }),

  updateGuide: userProcedure.input(UserGuideSchema).mutation(async ({ ctx, input }) => {
    return ctx.userModel.updateGuide(input);
  }),

  updateInterests: userProcedure.input(z.array(z.string())).mutation(async ({ ctx, input }) => {
    return ctx.userModel.updateUser({ interests: input });
  }),

  updateMcpAdaToken: userProcedure
    .input(z.string().trim().nullable())
    .mutation(async ({ ctx, input }) => {
      const token = input?.trim();
      return ctx.userModel.updateUser({ mcpAdaToken: token || null });
    }),

  updateOnboarding: userProcedure.input(UserOnboardingSchema).mutation(async ({ ctx, input }) => {
    return ctx.userModel.updateUser({ onboarding: input });
  }),

  updatePreference: userProcedure.input(UserPreferenceSchema).mutation(async ({ ctx, input }) => {
    return ctx.userModel.updatePreference(input);
  }),

  updateSettings: userProcedure.input(UserSettingsSchema).mutation(async ({ ctx, input }) => {
    const { keyVaults, ...res } = input as Partial<UserSettings>;

    // Encrypt keyVaults
    let encryptedKeyVaults: string | null = null;

    if (keyVaults) {
      // TODO: better to add a validation
      const data = JSON.stringify(keyVaults);
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

      encryptedKeyVaults = await gateKeeper.encrypt(data);
    }

    const nextValue = { ...res, keyVaults: encryptedKeyVaults };

    return ctx.userModel.updateSetting(nextValue);
  }),

  updateUsername: userProcedure.input(usernameSchema).mutation(async ({ ctx, input }) => {
    if (!appEnv.ENABLE_APP_DEV_MODE) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'IDENTITY_FIELDS_LOCKED' });
    }

    const existedUser = await UserModel.findByUsername(ctx.serverDB, input);
    if (existedUser && existedUser.id !== ctx.userId) {
      throw new TRPCError({ code: 'CONFLICT', message: 'USERNAME_TAKEN' });
    }

    return ctx.userModel.updateUser({ username: input });
  }),
});

export type UserRouter = typeof userRouter;
