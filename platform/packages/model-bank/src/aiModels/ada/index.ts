import { adaChatModels } from './chat';
import { adaEmbeddingModels } from './embedding';

export { adaChatModels } from './chat';
export { adaEmbeddingModels } from './embedding';

export const allModels = [...adaChatModels, ...adaEmbeddingModels];

export default allModels;
