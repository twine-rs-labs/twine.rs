import type {CoreGraphProjection} from '../bindings/CoreGraphProjection';
import type {CoreExternalDelta} from '../bindings/CoreExternalDelta';
import type {CoreExternalIngestResult} from '../bindings/CoreExternalIngestResult';
import type {CoreGraphProjectionOptions} from '../bindings/CoreGraphProjectionOptions';
import type {CoreAssetsPage} from '../bindings/CoreAssetsPage';
import type {CoreAssetsQuery} from '../bindings/CoreAssetsQuery';
import type {CoreContentsPage} from '../bindings/CoreContentsPage';
import type {CoreContentsQuery} from '../bindings/CoreContentsQuery';
import type {CoreDiagnosticsPage} from '../bindings/CoreDiagnosticsPage';
import type {CoreDiagnosticsQuery} from '../bindings/CoreDiagnosticsQuery';
import type {CoreDocumentPage} from '../bindings/CoreDocumentPage';
import type {CoreDocumentQuery} from '../bindings/CoreDocumentQuery';
import type {CorePassageFacts} from '../bindings/CorePassageFacts';
import type {CorePassageDocument} from '../bindings/CorePassageDocument';
import type {CoreSourceDocument} from '../bindings/CoreSourceDocument';
import type {CoreSearchPage} from '../bindings/CoreSearchPage';
import type {CoreSearchQuery} from '../bindings/CoreSearchQuery';
import type {CoreSessionStatus} from '../bindings/CoreSessionStatus';
import type {CoreStoryIndex} from '../bindings/CoreStoryIndex';
import type {CoreStoryIndexOptions} from '../bindings/CoreStoryIndexOptions';
import type {CoreStorySummary} from '../bindings/CoreStorySummary';
import type {PatchBatch} from '../bindings/PatchBatch';
import type {ProjectSnapshot} from '../bindings/ProjectSnapshot';
import type {PassageSnapshot} from '../bindings/PassageSnapshot';
import type {StoryCommand} from '../bindings/StoryCommand';
import type {CoreBridgeMetric} from './performance';

export interface WasmMutationStageTimings {
	analysisMs: number;
	deltaId: string;
	fingerprintMs: number;
	graphMs: number;
	graphParsedSourceCount: number;
	historyMs: number;
	lookupAndDeltaMs: number;
	operation: string;
	patchFinalizeMs: number;
	readModelMs: number;
	revision: number;
	savepointMs: number;
	topologyChanged: boolean;
	totalMs: number;
}

export interface WasmWorkerMetricBase {
	computeMs: number;
	computeFinishedAtEpochMs: number;
	computeStartedAtEpochMs: number;
	payloadBytes: number;
	requestBytes: number;
	responseBytes: number;
	readModel?: {
		analysisCacheSourceCount: number;
		fingerprintEntryCount: number;
		graphCacheStoryCount: number;
		historyBytes: number;
		parsedSourceCount: number;
		passageCount: number;
		projectDocumentBytes: number;
		readModelCacheStoryCount: number;
		readModelFullBuildCount: number;
		readModelIncrementalUpdateCount: number;
		readModelLastTouchedSourceCount: number;
		redoEntryCount: number;
		undoEntryCount: number;
	};
	mutationStages?: WasmMutationStageTimings;
	rustFinishedAtEpochMs?: number;
	rustStartedAtEpochMs?: number;
	traceId?: string;
	workerReceivedAt: number;
	workerReceivedAtEpochMs: number;
	workerRespondedAt: number;
	workerRespondedAtEpochMs: number;
	wasmMemoryBytes?: number;
}

export type WasmWorkerRequest =
	| {
			assets: CoreAssetInventoryEntry[];
			id: number;
			kind: 'beginProjectBootstrap';
			revision: number;
			sessionId: string;
			snapshot: ProjectSnapshot;
	  }
	| {
			id: number;
			kind: 'appendProjectBootstrap';
			passages: PassageSnapshot[];
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'finishProjectBootstrap';
			revision: number;
			sessionId: string;
	  }
	| {
			id: number;
			kind: 'apply';
			command: StoryCommand;
			history: 'record' | 'skip';
			revision: number;
			sessionId: string;
	  }
	| {
			id: number;
			kind: 'undo';
			revision: number;
			sessionId: string;
	  }
	| {
			id: number;
			kind: 'redo';
			revision: number;
			sessionId: string;
	  }
	| {
			id: number;
			kind: 'acknowledgeSaved';
			revision: number;
			sessionId: string;
	  }
	| {
			delta: CoreExternalDelta;
			force: boolean;
			id: number;
			kind: 'ingestExternalDelta';
			revision: number;
			sessionId: string;
	  }
	| {
			id: number;
			kind: 'queryGraphProjection';
			options: CoreGraphProjectionOptions;
			revision: number;
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'queryStoryIndex';
			options: CoreStoryIndexOptions;
			revision: number;
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'queryStorySummary';
			revision: number;
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'queryStoryWordCount';
			revision: number;
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'queryContentsPage';
			options: CoreContentsQuery;
			revision: number;
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'querySearchPage';
			options: CoreSearchQuery;
			revision: number;
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'queryDocumentPage';
			options: CoreDocumentQuery;
			revision: number;
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'queryDiagnosticsPage';
			options: CoreDiagnosticsQuery;
			revision: number;
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'queryAssetsPage';
			options: CoreAssetsQuery;
			revision: number;
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'queryPassageFacts';
			passageId: string;
			revision: number;
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'queryPassageDocument';
			passageId: string;
			revision: number;
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'querySourceDocument';
			revision: number;
			sessionId: string;
			sourceKind: 'script' | 'stylesheet';
			storyId: string;
	  }
	| {
			assets: CoreAssetInventoryEntry[];
			id: number;
			kind: 'replaceProject';
			revision: number;
			sessionId: string;
			snapshot: ProjectSnapshot;
	  }
	| {
			id: number;
			kind: 'removeSession';
			sessionId: string;
	  }
	| {
			id: number;
			kind: 'status';
			revision: number;
			sessionId: string;
	  };

export type WasmWorkerMutationResult = {
	batch: PatchBatch;
	revision: number;
	status: CoreSessionStatus;
};

export type WasmWorkerExternalIngestResult = CoreExternalIngestResult & {
	revision: number;
};

export type WasmWorkerSuccess =
	| {
			id: number;
			kind: 'appendProjectBootstrap' | 'beginProjectBootstrap';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: {accepted: boolean};
	  }
	| {
			id: number;
			kind: 'finishProjectBootstrap';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: {revision: number; status: CoreSessionStatus};
	  }
	| {
			id: number;
			kind: 'apply';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: WasmWorkerMutationResult;
	  }
	| {
			id: number;
			kind: 'acknowledgeSaved';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: WasmWorkerMutationResult;
	  }
	| {
			id: number;
			kind: 'ingestExternalDelta';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: WasmWorkerExternalIngestResult;
	  }
	| {
			id: number;
			kind: 'undo';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: WasmWorkerMutationResult | null;
	  }
	| {
			id: number;
			kind: 'redo';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: WasmWorkerMutationResult | null;
	  }
	| {
			id: number;
			kind: 'queryGraphProjection';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CoreGraphProjection;
	  }
	| {
			id: number;
			kind: 'queryStoryIndex';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CoreStoryIndex;
	  }
	| {
			id: number;
			kind: 'queryStorySummary';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CoreStorySummary;
	  }
	| {
			id: number;
			kind: 'queryStoryWordCount';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: number;
	  }
	| {
			id: number;
			kind: 'queryContentsPage';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CoreContentsPage;
	  }
	| {
			id: number;
			kind: 'querySearchPage';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CoreSearchPage;
	  }
	| {
			id: number;
			kind: 'queryDocumentPage';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CoreDocumentPage;
	  }
	| {
			id: number;
			kind: 'queryDiagnosticsPage';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CoreDiagnosticsPage;
	  }
	| {
			id: number;
			kind: 'queryAssetsPage';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CoreAssetsPage;
	  }
	| {
			id: number;
			kind: 'queryPassageFacts';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CorePassageFacts;
	  }
	| {
			id: number;
			kind: 'queryPassageDocument';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CorePassageDocument;
	  }
	| {
			id: number;
			kind: 'querySourceDocument';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CoreSourceDocument;
	  }
	| {
			id: number;
			kind: 'replaceProject';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: {revision: number; status: CoreSessionStatus};
	  }
	| {
			id: number;
			kind: 'removeSession';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: {removed: boolean};
	  }
	| {
			id: number;
			kind: 'status';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CoreSessionStatus;
	  };

export type WasmWorkerFailure = {
	error: string;
	id: number;
	kind: WasmWorkerRequest['kind'];
	metrics?: WasmWorkerMetricBase;
	ok: false;
};

export type WasmWorkerResponse = WasmWorkerFailure | WasmWorkerSuccess;

export type WasmClientMetric = CoreBridgeMetric & {
	kind: WasmWorkerRequest['kind'];
};
import type {CoreAssetInventoryEntry} from '../bindings/CoreAssetInventoryEntry';
