const prefix = 'twine';

export interface TwinePerformanceEntry {
	duration: number;
	name: string;
	startTime: number;
	type: string;
}

export interface TwinePerformanceEvent {
	detail?: Record<string, unknown>;
	epochTime: number;
	name: string;
	time: number;
}

const harnessEvents: TwinePerformanceEvent[] = [];

function performanceApi() {
	return typeof window !== 'undefined' ? window.performance : undefined;
}

export function markPerformance(name: string) {
	const performance = performanceApi();

	if (!performance?.mark) {
		return;
	}

	try {
		performance.mark(`${prefix}:${name}`);
	} catch {
		// Performance marks are diagnostics only.
	}
}

export function markPerformanceAfterPaint(name: string) {
	if (typeof window === 'undefined') {
		markPerformance(name);
		return;
	}

	const requestFrame = window.requestAnimationFrame;

	if (!requestFrame) {
		window.setTimeout(() => markPerformance(name), 0);
		return;
	}

	requestFrame(() => markPerformance(name));
}

export function measurePerformanceAfterPaint(name: string, start: string) {
	if (typeof window === 'undefined') {
		return;
	}

	const finish = () => {
		markPerformance(`${name}-end`);
		measurePerformance(name, start, `${name}-end`);
	};
	const requestFrame = window.requestAnimationFrame;

	if (!requestFrame) {
		window.setTimeout(finish, 0);
		return;
	}
	requestFrame(finish);
}

export function recordPerformanceHarnessEvent(
	name: string,
	detail?: Record<string, unknown>
) {
	if (
		typeof window === 'undefined' ||
		!(window as Window & {twinePerformanceNative?: unknown})
			.twinePerformanceNative
	) {
		return;
	}

	const performance = performanceApi();
	const time = performance?.now() ?? Date.now();
	harnessEvents.push({
		detail,
		epochTime:
			typeof performance?.timeOrigin === 'number'
				? performance.timeOrigin + time
				: Date.now(),
		name,
		time
	});
	if (harnessEvents.length > 1000) {
		harnessEvents.splice(0, harnessEvents.length - 1000);
	}
}

export function performanceEventSnapshot() {
	return [...harnessEvents];
}

export function resetRendererPerformance() {
	harnessEvents.length = 0;
	const performance = performanceApi();

	performance?.clearMarks?.();
	performance?.clearMeasures?.();
}

export function measurePerformance(
	name: string,
	start: string,
	end: string = name
) {
	const performance = performanceApi();

	if (!performance?.measure) {
		return;
	}

	try {
		performance.measure(
			`${prefix}:${name}`,
			`${prefix}:${start}`,
			`${prefix}:${end}`
		);
	} catch {
		// Missing marks should never affect app behavior.
	}
}

export function performanceSnapshot(): TwinePerformanceEntry[] {
	const performance = performanceApi();

	if (!performance?.getEntries) {
		return [];
	}

	return performance
		.getEntries()
		.filter(entry => entry.name.startsWith(`${prefix}:`))
		.map(entry => ({
			duration: entry.duration,
			name: entry.name.slice(prefix.length + 1),
			startTime: entry.startTime,
			type: entry.entryType
		}));
}

export function scheduleIdleWork(callback: () => void) {
	const requestIdleCallback = (
		window as Window & {
			requestIdleCallback?: (callback: () => void) => number;
		}
	).requestIdleCallback;

	if (requestIdleCallback) {
		const cancelIdleCallback = (
			window as Window & {
				cancelIdleCallback?: (handle: number) => void;
			}
		).cancelIdleCallback;
		const handle = requestIdleCallback(callback);

		return () => cancelIdleCallback?.(handle);
	}

	const handle = window.setTimeout(callback, 0);

	return () => window.clearTimeout(handle);
}
