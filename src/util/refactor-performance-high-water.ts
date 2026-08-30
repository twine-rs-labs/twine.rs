export type RendererCheckpointValues = Record<string, number | undefined>;

function refactorOwnedMemoryBytes(snapshot: RendererCheckpointValues) {
	const rendererJs = snapshot.usedJSHeapSize;
	const workerWasm = snapshot.workerWasmMemoryBytes;

	return typeof rendererJs === 'number' && typeof workerWasm === 'number'
		? rendererJs + workerWasm
		: undefined;
}

/**
 * Retain one real renderer-local observation to decide which callback merits a
 * native checkpoint. The blocking gate itself uses that checkpoint's CDP
 * worker sample; renderer worker self-report is never required.
 */
export function refactorRendererHighWater(
	previous: RendererCheckpointValues | undefined,
	current: RendererCheckpointValues
) {
	if (!previous) {
		return current;
	}

	const previousOwnedBytes = refactorOwnedMemoryBytes(previous);
	const currentOwnedBytes = refactorOwnedMemoryBytes(current);

	if (currentOwnedBytes === undefined) return previous;
	if (previousOwnedBytes === undefined) return current;

	return currentOwnedBytes >= previousOwnedBytes ? current : previous;
}
