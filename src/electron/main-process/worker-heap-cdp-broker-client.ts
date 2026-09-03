/**
 * The application-side half of the TWINE_PERF worker heap measurement.
 *
 * Chromium's browser-root debugging connection belongs to the benchmark runner,
 * not the application being measured. This client can make exactly one
 * loopback request to that runner-owned broker and never attaches a debugger,
 * discovers targets, or sends arbitrary CDP methods itself.
 */
export interface WorkerHeapCdpSample {
	sampledAtEpochMs: number;
	targetId: string;
	targetUrl: string;
	totalSize: number;
	usedSize: number;
}

export const workerHeapCdpCommandTimeoutMs = 4_000;

const brokerUrlEnvironmentKey = 'TWINE_PERF_WORKER_HEAP_BROKER_URL';
const brokerTokenEnvironmentKey = 'TWINE_PERF_WORKER_HEAP_BROKER_TOKEN';

function brokerConfiguration() {
	const configuredUrl = process.env[brokerUrlEnvironmentKey];
	const token = process.env[brokerTokenEnvironmentKey];
	let url: URL;

	try {
		url = new URL(configuredUrl ?? '');
	} catch {
		throw new Error('Worker heap broker URL is unavailable or invalid.');
	}
	if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
		throw new Error('Worker heap broker must use a 127.0.0.1 HTTP URL.');
	}
	if (!token || !/^[a-f0-9]{32,}$/i.test(token)) {
		throw new Error('Worker heap broker token is unavailable or invalid.');
	}

	return {token, url: url.toString()};
}

function sampleFromUnknown(value: unknown): WorkerHeapCdpSample {
	const sample = value as Partial<WorkerHeapCdpSample>;
	if (
		typeof sample?.sampledAtEpochMs !== 'number' ||
		typeof sample.targetId !== 'string' ||
		typeof sample.targetUrl !== 'string' ||
		typeof sample.totalSize !== 'number' ||
		typeof sample.usedSize !== 'number'
	) {
		throw new Error('Worker heap broker returned an invalid sample.');
	}
	return sample as WorkerHeapCdpSample;
}

/** Requests one bounded, runner-owned Runtime.getHeapUsage sample. */
export async function sampleWorkerHeapCdpFromBroker() {
	const {token, url} = brokerConfiguration();
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		workerHeapCdpCommandTimeoutMs
	);
	try {
		const response = await fetch(url, {
			headers: {authorization: `Bearer ${token}`},
			method: 'POST',
			signal: controller.signal
		});
		if (!response.ok) {
			throw new Error(
				`Worker heap broker request failed with HTTP ${response.status}.`
			);
		}
		return sampleFromUnknown(await response.json());
	} catch (error) {
		if (controller.signal.aborted) {
			throw new Error(
				`Worker heap broker request timed out after ${workerHeapCdpCommandTimeoutMs}ms.`
			);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}
