import type {CoreGraphProjection} from '../bindings/CoreGraphProjection';
import type {CoreExternalDelta} from '../bindings/CoreExternalDelta';
import type {CoreExternalIngestResult} from '../bindings/CoreExternalIngestResult';
import type {CoreGraphProjectionOptions} from '../bindings/CoreGraphProjectionOptions';
import type {CoreAssetsPage} from '../bindings/CoreAssetsPage';
import type {CoreAssetsQuery} from '../bindings/CoreAssetsQuery';
import type {CoreBacklinksPage} from '../bindings/CoreBacklinksPage';
import type {CoreBacklinksQuery} from '../bindings/CoreBacklinksQuery';
import type {CoreDefinitionQuery} from '../bindings/CoreDefinitionQuery';
import type {CoreDefinitionResult} from '../bindings/CoreDefinitionResult';
import type {CoreContentsPage} from '../bindings/CoreContentsPage';
import type {CoreContentsQuery} from '../bindings/CoreContentsQuery';
import type {CoreDiagnosticsPage} from '../bindings/CoreDiagnosticsPage';
import type {CoreDiagnosticsQuery} from '../bindings/CoreDiagnosticsQuery';
import type {CoreDiagnosticsSummary} from '../bindings/CoreDiagnosticsSummary';
import type {CoreDiagnosticsSummaryQuery} from '../bindings/CoreDiagnosticsSummaryQuery';
import type {CoreDocumentPage} from '../bindings/CoreDocumentPage';
import type {CoreDocumentQuery} from '../bindings/CoreDocumentQuery';
import type {CorePassageFacts} from '../bindings/CorePassageFacts';
import type {CorePassageLocalFacts} from '../bindings/CorePassageLocalFacts';
import type {CorePassageDocument} from '../bindings/CorePassageDocument';
import type {CorePassageReferencesPage} from '../bindings/CorePassageReferencesPage';
import type {CorePassageReferencesQuery} from '../bindings/CorePassageReferencesQuery';
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
import type {RefactorPlanApplyRequest} from '../bindings/RefactorPlanApplyRequest';
import type {RefactorPlanApplyResult} from '../bindings/RefactorPlanApplyResult';
import type {RefactorPlanCursor} from '../bindings/RefactorPlanCursor';
import type {RefactorPlanDetailResult} from '../bindings/RefactorPlanDetailResult';
import type {RefactorRuntimeState} from '../bindings/RefactorRuntimeState';
import type {PlanPassageRenameRequest} from '../bindings/PlanPassageRenameRequest';
import type {PlanPassageRenameBeginResult} from '../bindings/PlanPassageRenameBeginResult';
import type {PlanPassageRenameResult} from '../bindings/PlanPassageRenameResult';
import type {PlanProjectReplaceRequest} from '../bindings/PlanProjectReplaceRequest';
import type {PlanProjectReplaceBeginResult} from '../bindings/PlanProjectReplaceBeginResult';
import type {PlanProjectReplaceResult} from '../bindings/PlanProjectReplaceResult';
import type {RefactorPlanningTaskHandle} from '../bindings/RefactorPlanningTaskHandle';
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
	projectMutationMs: number;
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
		backlinkCacheBytes: number;
		backlinkCacheEntryCount: number;
		backlinkCacheHitCount: number;
		backlinkScanCount: number;
		backlinkScannedSourceCount: number;
		fingerprintEntryCount: number;
		graphCacheStoryCount: number;
		historyBytes: number;
		parsedSourceCount: number;
		passageCount: number;
		projectDocumentBytes: number;
		refactorPlanningTaskBytes: number;
		refactorPlanningTaskCount: number;
		refactorPlanStoreBytes: number;
		refactorPlanStoreEntryCount: number;
		refactorPlanStoreFingerprint: string;
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
	/**
	 * Dedicated Worker V8 heap observed with `wasmMemoryBytes` immediately
	 * before this response is posted. It is intentionally a pair, not an
	 * independently accumulated maximum.
	 */
	workerJsHeapUsedBytes?: number;
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
			kind: 'abortProjectBootstrap';
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
			kind: 'syncRefactorRuntime';
			revision: number;
			runtime: RefactorRuntimeState;
			sessionId: string;
	  }
	| {
			id: number;
			kind: 'beginPassageRenamePlan';
			request: PlanPassageRenameRequest;
			refactorRuntimeEpoch: number;
			revision: number;
			sessionId: string;
	  }
	| {
			id: number;
			kind: 'continuePassageRenamePlan';
			sessionId: string;
			task: RefactorPlanningTaskHandle;
	  }
	| {
			id: number;
			kind: 'cancelPassageRenamePlan';
			sessionId: string;
			task: RefactorPlanningTaskHandle;
	  }
	| {
			id: number;
			kind: 'beginProjectReplacePlan';
			request: PlanProjectReplaceRequest;
			refactorRuntimeEpoch: number;
			revision: number;
			sessionId: string;
	  }
	| {
			id: number;
			kind: 'continueProjectReplacePlan';
			sessionId: string;
			task: RefactorPlanningTaskHandle;
	  }
	| {
			id: number;
			kind: 'cancelProjectReplacePlan';
			sessionId: string;
			task: RefactorPlanningTaskHandle;
	  }
	| {
			applyRequest: RefactorPlanApplyRequest;
			id: number;
			kind: 'applyRefactorPlan';
			refactorRuntimeEpoch: number;
			revision: number;
			sessionId: string;
	  }
	| {
			cursor: RefactorPlanCursor;
			id: number;
			kind: 'queryRefactorPlanDetail';
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
			kind: 'queryDiagnosticsSummary';
			options: CoreDiagnosticsSummaryQuery;
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
			kind: 'queryPassageLocalFacts';
			passageId: string;
			revision: number;
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'queryBacklinksPage';
			options: CoreBacklinksQuery;
			passageId: string;
			revision: number;
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'queryPassageReferencesPage';
			options: CorePassageReferencesQuery;
			passageId: string;
			revision: number;
			sessionId: string;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'queryDefinition';
			query: CoreDefinitionQuery;
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
	  }
	| {
			/** Narrow TWINE_PERF-only ownership probe; never a product operation. */
			action: 'release' | 'retain';
			bytes?: number;
			id: number;
			kind: 'performanceProbeWorkerJs';
	  };

export type WasmWorkerMutationResult = {
	batch: PatchBatch;
	revision: number;
	status: CoreSessionStatus;
};

export type WasmWorkerExternalIngestResult = CoreExternalIngestResult & {
	revision: number;
};

export type WasmWorkerRefactorApplyResult =
	| (Extract<RefactorPlanApplyResult, {type: 'applied'}> & {
			revision: number;
			status: CoreSessionStatus;
	  })
	| (Extract<RefactorPlanApplyResult, {type: 'failure'}> & {
			revision: number;
	  });

export type WasmWorkerSuccess =
	| {
			id: number;
			kind: 'syncRefactorRuntime';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: {refactorRuntimeEpoch: number};
	  }
	| {
			id: number;
			kind: 'beginPassageRenamePlan';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: PlanPassageRenameBeginResult;
	  }
	| {
			id: number;
			kind: 'continuePassageRenamePlan';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: PlanPassageRenameResult;
	  }
	| {
			id: number;
			kind: 'cancelPassageRenamePlan';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: {cancelled: boolean};
	  }
	| {
			id: number;
			kind: 'beginProjectReplacePlan';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: PlanProjectReplaceBeginResult;
	  }
	| {
			id: number;
			kind: 'continueProjectReplacePlan';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: PlanProjectReplaceResult;
	  }
	| {
			id: number;
			kind: 'cancelProjectReplacePlan';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: {cancelled: boolean};
	  }
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
			kind: 'abortProjectBootstrap';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: {aborted: boolean};
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
			kind: 'applyRefactorPlan';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: WasmWorkerRefactorApplyResult;
	  }
	| {
			id: number;
			kind: 'queryRefactorPlanDetail';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: RefactorPlanDetailResult;
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
			kind: 'queryDiagnosticsSummary';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CoreDiagnosticsSummary;
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
			kind: 'queryPassageLocalFacts';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CorePassageLocalFacts;
	  }
	| {
			id: number;
			kind: 'queryBacklinksPage';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CoreBacklinksPage;
	  }
	| {
			id: number;
			kind: 'queryPassageReferencesPage';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CorePassageReferencesPage;
	  }
	| {
			id: number;
			kind: 'queryDefinition';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: CoreDefinitionResult;
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
	  }
	| {
			id: number;
			kind: 'performanceProbeWorkerJs';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: {allocatedBytes: number; retained: boolean};
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
