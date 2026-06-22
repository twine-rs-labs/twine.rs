const prefix = 'twine';

export interface TwinePerformanceEntry {
	duration: number;
	name: string;
	startTime: number;
	type: string;
}

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
