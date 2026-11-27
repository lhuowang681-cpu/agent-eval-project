'use client';

import { type DropdownItem, type DropdownMenuCheckboxItem } from '@lobehub/ui';
import { Button, DropdownMenu, Icon } from '@lobehub/ui';
import { ChevronDown, UserCheck } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useQuery } from '@/hooks/useQuery';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { usePathname } from '@/libs/router/navigation';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

const MyPublishedFilter = memo(() => {
  const { t } = useTranslation('discover');
  const pathname = usePathname();
  const query = useQuery();
  const router = useQueryRoute();
  const isLogin = useUserStore(authSelectors.isLogin);

  type FilterItem = Extract<DropdownItem, { type?: 'item' }> & {
    key: string;
    label: string;
  };

  const items = useMemo<FilterItem[]>(
    () => [
      {
        key: 'all',
        label: t('filter.all'),
      },
      {
        key: 'mine',
        label: t('filter.myPublished'),
      },
    ],
    [t],
  );

  const currentFilter = query.mine === 'true' ? 'mine' : 'all';

  const handleChange = (value: string) => {
    if (!isLogin) return;

    router.push(pathname, {
      query: {
        mine: value === 'mine' ? 'true' : null,
        page: null,
      },
    });
  };

  const menuItems = useMemo<DropdownMenuCheckboxItem[]>(
    () =>
      items.map(
        (item): DropdownMenuCheckboxItem => ({
          checked: item.key === currentFilter,
          closeOnClick: true,
          key: item.key,
          label: item.label,
          onCheckedChange: (checked: boolean) => {
            if (checked) {
              handleChange(item.key);
            }
          },
          type: 'checkbox',
        }),
      ),
    [currentFilter, handleChange, items],
  );

  if (!isLogin) return null;

  const activeItem = items.find((item) => item.key === currentFilter);

  return (
    <DropdownMenu items={menuItems} trigger="both">
      <Button icon={<Icon icon={UserCheck} />} type={'text'}>
        {activeItem?.label ?? items[0]?.label}
        <Icon icon={ChevronDown} />
      </Button>
    </DropdownMenu>
  );
});

MyPublishedFilter.displayName = 'MyPublishedFilter';

export default MyPublishedFilter;
