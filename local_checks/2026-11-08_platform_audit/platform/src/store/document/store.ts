import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type DocumentAction } from './slices/document';
import { createDocumentSlice } from './slices/document';
import { type EditorAction, type EditorState } from './slices/editor';
import { createEditorSlice, initialEditorState } from './slices/editor';
import { type PreviewAction, type PreviewState } from './slices/preview';
import { createPreviewSlice, initialPreviewState } from './slices/preview';

// State type
export type DocumentState = EditorState & PreviewState;

// Action type
export type DocumentStoreAction = DocumentAction & EditorAction & PreviewAction;

// Full store type
export type DocumentStore = DocumentState & DocumentStoreAction;

// Initial state
const initialState: DocumentState = {
  ...initialEditorState,
  ...initialPreviewState,
};

const createStore: StateCreator<DocumentStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<DocumentStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<DocumentStoreAction>([
    createDocumentSlice(...parameters),
    createEditorSlice(...parameters),
    createPreviewSlice(...parameters),
  ]),
});

const devtools = createDevtools('document');

export const useDocumentStore = createWithEqualityFn<DocumentStore>()(
  devtools(createStore),
  shallow,
);

export const getDocumentStoreState = () => useDocumentStore.getState();
