import type {CoreGraphProjection} from '../bindings/CoreGraphProjection';
import type {CoreExternalDelta} from '../bindings/CoreExternalDelta';
import type {CoreGraphProjectionOptions} from '../bindings/CoreGraphProjectionOptions';
import type {CoreSessionStatus} from '../bindings/CoreSessionStatus';
import type {CoreStoryIndex} from '../bindings/CoreStoryIndex';
import type {CoreStoryIndexOptions} from '../bindings/CoreStoryIndexOptions';
import type {PatchBatch} from '../bindings/PatchBatch';
import type {ProjectSnapshot} from '../bindings/ProjectSnapshot';
import type {StoryCommand} from '../bindings/StoryCommand';
import type {CoreBridgeMetric} from './performance';

export interface WasmWorkerMetricBase {
	computeMs: number;
	payloadBytes: number;
	requestBytes: number;
	responseBytes: number;
	workerReceivedAt: number;
	workerRespondedAt: number;
}

export type WasmWorkerRequest =
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
			id: number;
			kind: 'applyExternalDelta';
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

export type WasmWorkerSuccess =
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
			kind: 'applyExternalDelta';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: WasmWorkerMutationResult;
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
