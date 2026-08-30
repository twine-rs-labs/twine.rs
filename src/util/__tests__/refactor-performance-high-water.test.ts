import {refactorRendererHighWater} from '../refactor-performance-high-water';

describe('refactorRendererHighWater', () => {
	it('retains one coherent renderer tuple instead of combining field maxima', () => {
		const highJavascript = {
			usedJSHeapSize: 90,
			workerWasmMemoryBytes: 10,
			marker: 1
		};
		const highWasm = {
			usedJSHeapSize: 20,
			workerWasmMemoryBytes: 90,
			marker: 2
		};

		expect(refactorRendererHighWater(undefined, highJavascript)).toBe(
			highJavascript
		);
		expect(refactorRendererHighWater(highJavascript, highWasm)).toBe(highWasm);
		expect(refactorRendererHighWater(highWasm, highJavascript)).toBe(highWasm);
	});

	it('does not replace a supported tuple with a missing worker observation', () => {
		const supported = {
			usedJSHeapSize: 20,
			workerWasmMemoryBytes: 40
		};

		expect(refactorRendererHighWater(supported, {usedJSHeapSize: 500})).toBe(
			supported
		);
	});
});
