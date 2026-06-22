import {WasmCoreWorkerClient, wasmQueryKey} from '../wasm/twine-wasm-client';

describe('WasmCoreWorkerClient', () => {
	it('uses stable cache keys for semantically identical query objects', () => {
		expect(wasmQueryKey('story', {b: 2, a: 1})).toBe(
			wasmQueryKey('story', {a: 1, b: 2})
		);
	});

	it('stays disabled under Jest so tests use deterministic JS fallback', () => {
		const client = new WasmCoreWorkerClient();

		expect(client.enabled).toBe(false);
		expect(client.mode).toBe('unavailable');
	});
});
