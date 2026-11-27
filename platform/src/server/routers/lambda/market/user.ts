import { router } from '@/libs/trpc/lambda';

export const userRouter = router({});

export type UserRouter = typeof userRouter;
