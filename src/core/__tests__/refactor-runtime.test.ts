import {RefactorRuntimeCoordinator} from '../refactor-runtime';

describe('refactor runtime state', () => {
	const storyId = 'refactor-runtime-story';

	it('tracks watcher and exact provider generations in trusted host state', async () => {
		const runtime = new RefactorRuntimeCoordinator();
		await runtime.recordExternalSession([storyId], {
			generation: 3,
			sessionInstanceId: 'native-1'
		});
		await runtime.registerSemanticProvider(storyId, {
			capabilityRevision: 7,
			formatVersion: '3.3.9',
			identifier: 'harlowe'
		});

		expect(
			runtime.runtimeState(storyId, 11, [
				{
					bufferId: 'passage:start',
					generation: 5,
					registrationId: 'editor-1'
				}
			])
		).toEqual({
			buffers: [
				{
					bufferId: 'passage:start',
					generation: 5,
					registrationId: 'editor-1'
				}
			],
			external: {generation: 3, sessionInstanceId: 'native-1'},
			projectRevision: 11,
			provider: {
				capabilityRevision: 7,
				formatVersion: '3.3.9',
				identifier: 'harlowe'
			}
		});
	});

	it('does not let cleanup for an old native session erase its replacement', async () => {
		const runtime = new RefactorRuntimeCoordinator();
		await runtime.recordExternalSession([storyId], {
			generation: 3,
			sessionInstanceId: 'native-1'
		});
		await runtime.recordExternalSession([storyId], {
			generation: 1,
			sessionInstanceId: 'native-2'
		});
		await runtime.clearExternalSession([storyId], 'native-1');

		expect(runtime.runtimeState(storyId, 1, []).external).toEqual({
			generation: 1,
			sessionInstanceId: 'native-2'
		});
	});

	it('keeps provider null until an exact semantic descriptor is registered', async () => {
		const runtime = new RefactorRuntimeCoordinator();

		expect(runtime.runtimeState(storyId, 1, []).provider).toBeNull();
		const dispose = await runtime.registerSemanticProvider(storyId, {
			capabilityRevision: 1,
			formatVersion: 'test',
			identifier: 'test-exact-provider'
		});
		expect(runtime.runtimeState(storyId, 1, []).provider).toEqual({
			capabilityRevision: 1,
			formatVersion: 'test',
			identifier: 'test-exact-provider'
		});
		await dispose();
		expect(runtime.runtimeState(storyId, 1, []).provider).toBeNull();
	});

	it('does not let disposal of a replaced exact provider erase its successor', async () => {
		const runtime = new RefactorRuntimeCoordinator();
		const disposeFirst = await runtime.registerSemanticProvider(storyId, {
			capabilityRevision: 1,
			formatVersion: 'test',
			identifier: 'first'
		});
		const disposeSecond = await runtime.registerSemanticProvider(storyId, {
			capabilityRevision: 2,
			formatVersion: 'test',
			identifier: 'second'
		});

		await disposeFirst();
		expect(runtime.runtimeState(storyId, 1, []).provider).toEqual({
			capabilityRevision: 2,
			formatVersion: 'test',
			identifier: 'second'
		});
		await disposeSecond();
		expect(runtime.runtimeState(storyId, 1, []).provider).toBeNull();
	});
});
