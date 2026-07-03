import {
	coreBridgeMetricsSnapshot,
	coreProjectHostPerformanceSnapshot,
	resetCoreBridgeMetrics
} from '../core';
import type {TwineElectronWindow} from '../electron/shared';
import {
	performanceEventSnapshot,
	performanceSnapshot,
	resetRendererPerformance
} from './performance';

export interface TwinePerformanceHarness {
	reset(): Promise<void>;
	snapshot(): Promise<{
		main: unknown;
		renderer: {
			bridgeMetrics: ReturnType<typeof coreBridgeMetricsSnapshot>;
			core: ReturnType<typeof coreProjectHostPerformanceSnapshot>;
			entries: ReturnType<typeof performanceSnapshot>;
			events: ReturnType<typeof performanceEventSnapshot>;
		};
	}>;
}

export interface TwinePerformanceWindow extends TwineElectronWindow {
	twinePerformance?: TwinePerformanceHarness;
}

export function installPerformanceHarness() {
	const harnessWindow = window as TwinePerformanceWindow;
	const native = harnessWindow.twinePerformanceNative;

	if (!native) {
		return;
	}

	harnessWindow.twinePerformance = {
		async reset() {
			resetRendererPerformance();
			resetCoreBridgeMetrics();
			await native.reset();
		},
		async snapshot() {
			return {
				main: await native.snapshot(),
				renderer: {
					bridgeMetrics: coreBridgeMetricsSnapshot(),
					core: coreProjectHostPerformanceSnapshot(),
					entries: performanceSnapshot(),
					events: performanceEventSnapshot()
				}
			};
		}
	};
}
