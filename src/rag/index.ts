// Curtis — Vault retrieval (RAG) public surface

export { RagIndexManager, type PulseMatch } from './index-manager';
export { formatRetrievedContext } from './retrieval';
export { rebuildIndexWithProgress } from './progress';
export {
	LOCAL_EMBEDDING_PROVIDER_ID,
	DEFAULT_LOCAL_EMBEDDING_MODEL,
	isLocalEmbeddingProvider,
} from './local-embeddings';
export { ragIndexPaths, type RagIndexLocation } from './index-paths';
