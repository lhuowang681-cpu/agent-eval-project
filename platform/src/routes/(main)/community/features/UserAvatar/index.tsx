'use client';

import { Avatar, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

import { useMarketAuth, useMarketUserProfile } from '@/layout/AuthProvider/MarketAuth';

const UserAvatar = memo(() => {
  const { isAuthenticated, isLoading, getCurrentUserInfo } = useMarketAuth();

  const userInfo = getCurrentUserInfo();
  const username = userInfo?.sub;

  const { data: userProfile } = useMarketUserProfile(username);

  if (isLoading) {
    return <Skeleton.Avatar active shape={'square'} size={28} style={{ borderRadius: 6 }} />;
  }

  if (!isAuthenticated) return null;

  const avatarUrl = userProfile?.avatarUrl;

  return (
    <Avatar avatar={avatarUrl || userProfile?.userName || username} shape={'square'} size={28} />
  );
});

export default UserAvatar;
