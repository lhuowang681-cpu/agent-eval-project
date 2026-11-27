import { useCallback, useEffect, useState } from 'react';

import { type GlobalAnnouncementConfig } from '@/types/serverConfig';

const STORAGE_KEY = 'chathub_dismissed_announcement';

const hashAnnouncement = (announcement: GlobalAnnouncementConfig | undefined): string => {
  if (!announcement) return '';
  const raw = `${announcement.level ?? 'info'}|${announcement.title ?? ''}|${announcement.message ?? ''}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
};

const readDismissedHash = (): string => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

const writeDismissedHash = (hash: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, hash);
  } catch {
    // 隐私模式或存储受限时静默失败，退化为会话级关闭
  }
};

export interface AnnouncementDismissal {
  dismiss: () => void;
  isDismissed: boolean;
}

export const useAnnouncementDismissal = (
  announcement: GlobalAnnouncementConfig | undefined,
): AnnouncementDismissal => {
  const currentHash = hashAnnouncement(announcement);
  const [dismissedHash, setDismissedHash] = useState<string>('');

  useEffect(() => {
    setDismissedHash(readDismissedHash());
  }, []);

  const dismiss = useCallback(() => {
    if (!currentHash) return;
    writeDismissedHash(currentHash);
    setDismissedHash(currentHash);
  }, [currentHash]);

  return {
    dismiss,
    isDismissed: !!currentHash && dismissedHash === currentHash,
  };
};
