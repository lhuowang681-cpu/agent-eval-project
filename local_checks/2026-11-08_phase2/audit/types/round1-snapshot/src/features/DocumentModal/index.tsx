'use client';

import { Flexbox, Modal } from '@lobehub/ui';
import { memo } from 'react';

import { PageAgentPanelOverrideProvider } from '@/features/PageEditor/RightPanel/OverrideContext';
import PageExplorer from '@/features/PageExplorer';

import DocumentModalHeader from './Header';

interface DocumentModalProps {
  documentId?: string | null;
  onClose: () => void;
  open: boolean;
}

/**
 * Generic document preview modal. Pass `documentId` + `open` + `onClose`;
 * the modal owns its own page-agent panel state (collapsed by default,
 * ephemeral — does not persist to the global preference).
 */
const DocumentModal = memo<DocumentModalProps>(({ documentId, open, onClose }) => {
  return (
    <Modal
      allowFullscreen
      centered
      destroyOnHidden
      closable={false}
      footer={null}
      open={open}
      title={null}
      width={'min(95vw, 1600px)'}
      styles={{
        body: { flex: 1, maxHeight: 'none', minHeight: 0, overflow: 'hidden', padding: 0 },
        container: { display: 'flex', flexDirection: 'column', height: '92vh' },
      }}
      onCancel={onClose}
    >
      {open && documentId && (
        <PageAgentPanelOverrideProvider defaultExpand={false}>
          {/*
            calcifer's PageExplorer does not accept `header` / `fullWidthHeader`,
            so the modal header is rendered as a sibling above the explorer.
          */}
          <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
            <DocumentModalHeader onClose={onClose} />
            <Flexbox flex={1} style={{ overflow: 'hidden' }}>
              <PageExplorer pageId={documentId} />
            </Flexbox>
          </Flexbox>
        </PageAgentPanelOverrideProvider>
      )}
    </Modal>
  );
});

DocumentModal.displayName = 'DocumentModal';

export default DocumentModal;
