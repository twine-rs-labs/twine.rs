import type {CoreGraphProjection} from '../bindings/CoreGraphProjection';
import type {CoreGraphProjectionOptions} from '../bindings/CoreGraphProjectionOptions';
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
			revision: number;
	  }
	| {
			id: number;
			kind: 'queryGraphProjection';
			options: CoreGraphProjectionOptions;
			revision: number;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'queryStoryIndex';
			options: CoreStoryIndexOptions;
			revision: number;
			storyId: string;
	  }
	| {
			id: number;
			kind: 'replaceProject';
			revision: number;
			snapshot: ProjectSnapshot;
	  };

export type WasmWorkerSuccess =
	| {
			id: number;
			kind: 'apply';
			metrics: WasmWorkerMetricBase;
			ok: true;
			result: PatchBatch;
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
			result: {revision: number};
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
