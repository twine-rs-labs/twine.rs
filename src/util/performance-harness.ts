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
	collectRetainedMemory(): Promise<void>;
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
		async collectRetainedMemory() {
			(globalThis as typeof globalThis & {gc?: () => void}).gc?.();
			await native.collectGarbage();
			await new Promise(resolve => window.setTimeout(resolve, 0));
			await native.checkpoint(
				'post-gc-retained',
				((): Record<string, number> => {
					const memory = (
						performance as Performance & {
							memory?: {
								totalJSHeapSize: number;
								usedJSHeapSize: number;
							};
						}
					).memory;

					return memory
						? {
								totalJSHeapSize: memory.totalJSHeapSize,
								usedJSHeapSize: memory.usedJSHeapSize
							}
						: {};
				})()
			);
		},
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
