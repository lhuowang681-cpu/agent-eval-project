'use client';

import { ActionIcon, Center, Flexbox, Icon, lobeStaticStylish } from '@lobehub/ui';
import { useSize } from 'ahooks';
import { createStaticStyles, cx } from 'antd-style';
import { InfoIcon, XIcon } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import Marquee from 'react-fast-marquee';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';
import { type GlobalAnnouncementConfig } from '@/types/serverConfig';
import { isOnServerSide } from '@/utils/env';

import { BANNER_HEIGHT } from './CloudBanner';

const styles = createStaticStyles(({ css, cssVar }) => ({
  background: cx(
    lobeStaticStylish.gradientAnimation,
    css`
      position: absolute;

      width: max(64%, 1280px);
      height: 100%;

      opacity: 0.45;
      filter: blur(60px);
    `,
  ),
  containerDark: css`
    position: relative;
    overflow: hidden;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background-color: ${cssVar.colorFill};
  `,
  containerLight: css`
    position: relative;
    overflow: hidden;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background-color: ${cssVar.colorFillSecondary};
  `,
  icon: css`
    color: ${cssVar.colorWarning};
  `,
  iconInfo: css`
    color: ${cssVar.colorInfo};
  `,
  wrapper: css`
    z-index: 1;
    overflow: hidden;
    max-width: 100%;
  `,
}));

interface AnnouncementBannerProps extends Pick<
  GlobalAnnouncementConfig,
  'level' | 'message' | 'title'
> {
  mobile?: boolean;
  onClose?: () => void;
}

const AnnouncementBanner = memo<AnnouncementBannerProps>(
  ({ level = 'info', message, mobile, onClose, title }) => {
    const ref = useRef(null);
    const contentRef = useRef(null);
    const size = useSize(ref);
    const contentSize = useSize(contentRef);
    const isDarkMode = useIsDark();
    const { t } = useTranslation('common');
    const [isTruncated, setIsTruncated] = useState(mobile);

    useEffect(() => {
      if (mobile || isOnServerSide || !size || !contentSize) return;
      setIsTruncated(contentSize.width > size.width - 32);
    }, [size, contentSize, mobile]);

    const content = (
      <Flexbox horizontal align={'center'} flex={'none'} gap={8} ref={contentRef}>
        <Icon
          className={level === 'warning' ? styles.icon : styles.iconInfo}
          icon={InfoIcon}
          size={16}
        />
        {title && <b>{title}:</b>}
        <span>{message}</span>
      </Flexbox>
    );

    return (
      <Center
        className={isDarkMode ? styles.containerDark : styles.containerLight}
        flex={'none'}
        height={BANNER_HEIGHT}
        paddingInline={16}
        ref={ref}
        width={'100%'}
      >
        <div className={styles.background} />
        <Center horizontal className={styles.wrapper} gap={16} width={'100%'}>
          {isTruncated ? <Marquee pauseOnHover>{content}</Marquee> : content}
          <ActionIcon
            flex={'none'}
            icon={XIcon}
            size={'small'}
            title={t('close')}
            onClick={onClose}
          />
        </Center>
      </Center>
    );
  },
);

AnnouncementBanner.displayName = 'AnnouncementBanner';

export default AnnouncementBanner;
