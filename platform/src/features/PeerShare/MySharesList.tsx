'use client';

import { Avatar, Button, Flexbox, Tag, Text } from '@lobehub/ui';
import { App, Table } from 'antd';
import { Share2, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { communityApiService } from '@/services/marketApi';

interface ShareRow {
  createdAt: string | number | Date | null;
  installCount: number | null;
  itemType: 'agent' | 'mcp' | 'skill';
  marketIdentifier: string;
  name: string | null;
  revokedAt: string | number | Date | null;
  token: string;
  viewCount: number | null;
}

const MySharesList = memo(() => {
  const { t } = useTranslation('share');
  const { modal, message } = App.useApp();
  const appOrigin = useAppOrigin();
  const { data, mutate, isLoading } = useSWR('my-shares', () => communityApiService.getMyShares());

  const handleRevoke = (token: string) => {
    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        await communityApiService.revokeShare(token);
        await mutate();
        message.success(t('myShares.statusRevoked'));
      },
      title: t('myShares.confirmRevoke'),
      type: 'error',
    });
  };

  const handleCopy = async (token: string) => {
    await navigator.clipboard.writeText(`${appOrigin}/share/${token}`);
    message.success(t('result.copied'));
  };

  if (!isLoading && (!data || data.length === 0)) {
    return (
      <Flexbox align={'center'} justify={'center'} style={{ padding: 64 }}>
        <Text type={'secondary'}>{t('myShares.empty')}</Text>
      </Flexbox>
    );
  }

  const typeLabel = (itemType: ShareRow['itemType']) =>
    itemType === 'skill'
      ? t('myShares.typeSkill')
      : itemType === 'mcp'
        ? t('myShares.typeMcp')
        : t('myShares.typeAgent');

  const columns = [
    {
      dataIndex: 'name',
      key: 'name',
      render: (v: string | null, r: ShareRow) => (
        <Flexbox horizontal align={'center'} gap={8}>
          <Avatar size={24} />
          <span>{v ?? r.marketIdentifier}</span>
        </Flexbox>
      ),
      title: t('myShares.colName'),
    },
    {
      dataIndex: 'itemType',
      key: 'itemType',
      render: (v: ShareRow['itemType']) => <Tag>{typeLabel(v)}</Tag>,
      title: t('myShares.colType'),
    },
    { dataIndex: 'viewCount', key: 'viewCount', title: t('myShares.colViews') },
    { dataIndex: 'installCount', key: 'installCount', title: t('myShares.colInstalls') },
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: ShareRow['createdAt']) => (
        <span>{v ? new Date(v as any).toLocaleDateString() : '-'}</span>
      ),
      title: t('myShares.colCreated'),
    },
    {
      dataIndex: 'status',
      key: 'status',
      render: (_: unknown, r: ShareRow) => (
        <Tag color={r.revokedAt ? 'red' : 'green'}>
          {r.revokedAt ? t('myShares.statusRevoked') : t('myShares.statusActive')}
        </Tag>
      ),
      title: t('myShares.colStatus'),
    },
    {
      dataIndex: 'actions',
      key: 'actions',
      render: (_: unknown, r: ShareRow) => (
        <Flexbox horizontal gap={8}>
          <Button icon={Share2} size={'small'} type={'text'} onClick={() => handleCopy(r.token)}>
            {t('button.copy')}
          </Button>
          {!r.revokedAt && (
            <Button
              danger
              icon={Trash2}
              size={'small'}
              type={'text'}
              onClick={() => handleRevoke(r.token)}
            >
              {t('button.revoke')}
            </Button>
          )}
        </Flexbox>
      ),
      title: '',
    },
  ];

  return (
    <Table columns={columns} dataSource={data as ShareRow[]} loading={isLoading} rowKey={'token'} />
  );
});

export default MySharesList;
