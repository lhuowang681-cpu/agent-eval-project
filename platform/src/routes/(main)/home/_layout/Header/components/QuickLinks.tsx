'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { Lark } from '@lobehub/ui/icons';
import { BookOpen, ShieldCheck } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const COMPLIANCE_NOTICE_URL = 'https://trip.larkenterprise.com/wiki/PVgXwqm1wi2GMek6LGEc0Ob8nXd';
const USAGE_GUIDE_URL = 'https://trip.larkenterprise.com/wiki/D6zbwvS3dizJvekuoQJcZzH9nhT';
const TECH_SUPPORT_GROUP_URL =
  'https://applink.larkenterprise.com/client/chat/chatter/add_by_link?link_token=ff1u6703-fc88-48a1-8de0-03351cfc4d57';
const TechSupportIcon = 'Color' in Lark ? Lark.Color : Lark;

const QuickLinks = memo(() => {
  const { t } = useTranslation('common');

  return (
    <Flexbox horizontal gap={6}>
      <a
        aria-label={t('userPanel.usageGuide')}
        href={USAGE_GUIDE_URL}
        rel="noopener noreferrer"
        style={{ textDecoration: 'none' }}
        target="_blank"
      >
        <Button icon={<BookOpen size={16} />} size="small" variant="filled">
          {t('userPanel.usageGuide')}
        </Button>
      </a>
      <a
        aria-label={t('userPanel.compliance')}
        href={COMPLIANCE_NOTICE_URL}
        rel="noopener noreferrer"
        style={{ textDecoration: 'none' }}
        target="_blank"
      >
        <Button icon={ShieldCheck} size="small" variant="filled">
          {t('userPanel.compliance')}
        </Button>
      </a>
      <a
        aria-label={t('userPanel.techSupport')}
        href={TECH_SUPPORT_GROUP_URL}
        rel="noopener noreferrer"
        style={{ textDecoration: 'none' }}
        target="_blank"
      >
        <Button icon={<TechSupportIcon size={16} />} size="small" variant="filled">
          {t('userPanel.techSupport')}
        </Button>
      </a>
    </Flexbox>
  );
});

export default QuickLinks;
