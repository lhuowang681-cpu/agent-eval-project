import { SiApple, SiLinux } from '@icons-pack/react-simple-icons';
import { Microsoft } from '@lobehub/icons';
import { Icon } from '@lobehub/ui';
import { MonitorIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Map a device platform string to its OS brand icon.
 *
 * Accepts both Node/Electron platform strings (`darwin` / `win32` / `linux`,
 * as reported by registered devices) and `getPlatform()` UA names
 * (`Mac OS` / `Windows` / `Linux`, used for the current machine's local chip),
 * so the same helper serves the local, device and picker rows.
 */
export const getDeviceIcon = (platform: string | null | undefined, size = 14): ReactNode => {
  const p = (platform || '').toLowerCase();
  if (p.includes('darwin') || p.includes('mac'))
    return <SiApple color="currentColor" size={size} />;
  if (p.includes('win')) return <Microsoft size={size} />;
  if (p.includes('linux')) return <SiLinux color="currentColor" size={size} />;
  return <Icon icon={MonitorIcon} size={size} />;
};
