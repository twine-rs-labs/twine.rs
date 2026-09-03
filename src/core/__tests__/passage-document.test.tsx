import {act, renderHook, waitFor} from '@testing-library/react';
import {
	useCorePassageDocument,
	useCoreSourceDocument
} from '../passage-document';
import {useCoreProjectHost} from '../project-host-public';

jest.mock('../project-host-public', () => ({useCoreProjectHost: jest.fn()}));

describe('Core document persistence retries', () => {
	const host = {
		applyStoryCommandPersisted: jest.fn(),
		queryPassageDocumentAsync: jest.fn(),
		querySourceDocumentAsync: jest.fn(),
		retryStoryPersistence: jest.fn(),
		sessionStatus: jest.fn(() => ({revision: 3})),
		subscribeToPatches: jest.fn(() => jest.fn())
	};

	beforeEach(() => {
		(useCoreProjectHost as jest.Mock).mockReturnValue(host);
		host.applyStoryCommandPersisted.mockResolvedValue(undefined);
		host.sessionStatus.mockReturnValue({revision: 3});
		host.subscribeToPatches.mockReturnValue(jest.fn());
		host.queryPassageDocumentAsync.mockResolvedValue({
			passageId: 'retry-passage',
			revision: 3,
			storyId: 'retry-passage-story',
			text: 'Core accepted text'
		});
		host.querySourceDocumentAsync.mockResolvedValue({
			kind: 'script',
			revision: 3,
			storyId: 'retry-source-story',
			text: 'Core accepted source'
		});
		host.retryStoryPersistence.mockResolvedValue(true);
	});

	it('retries passage durability without issuing a second Rust text command', async () => {
		const {result} = renderHook(() =>
			useCorePassageDocument('retry-passage-story', 'retry-passage')
		);

		await waitFor(() => expect(result.current.document).toBeDefined());
		await act(async () => result.current.apply('Core accepted text'));

		expect(host.retryStoryPersistence).toHaveBeenCalledWith({
			passageId: 'retry-passage',
			storyId: 'retry-passage-story',
			type: 'passageText'
		});
		expect(host.applyStoryCommandPersisted).not.toHaveBeenCalled();
	});

	it('retries source durability without issuing a second Rust source command', async () => {
		const {result} = renderHook(() =>
			useCoreSourceDocument('retry-source-story', 'script')
		);

		await waitFor(() => expect(result.current.document).toBeDefined());
		await act(async () => result.current.apply('Core accepted source'));

		expect(host.retryStoryPersistence).toHaveBeenCalledWith({
			storyId: 'retry-source-story',
			type: 'script'
		});
		expect(host.applyStoryCommandPersisted).not.toHaveBeenCalled();
	});
});
