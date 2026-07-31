import {
	deleteProjectMetadata,
	getProjectMetadataRevision,
	saveProjectMetadata,
	subscribeProjectMetadata
} from '../project-metadata';

describe('project metadata notifications', () => {
	beforeEach(() => window.localStorage.clear());

	it('notifies subscribers when metadata is saved or deleted', () => {
		const initialRevision = getProjectMetadataRevision();
		const listener = jest.fn();
		const unsubscribe = subscribeProjectMetadata(listener);

		saveProjectMetadata('story-id', {
			rootPath: '/native/story.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		expect(getProjectMetadataRevision()).toBe(initialRevision + 1);
		expect(listener).toHaveBeenCalledTimes(1);

		deleteProjectMetadata('story-id');
		expect(getProjectMetadataRevision()).toBe(initialRevision + 2);
		expect(listener).toHaveBeenCalledTimes(2);

		unsubscribe();
		saveProjectMetadata('story-id', {
			status: 'local-only',
			storageKind: 'web-local'
		});
		expect(listener).toHaveBeenCalledTimes(2);
	});
});
