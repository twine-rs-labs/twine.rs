import {act, renderHook, waitFor} from '@testing-library/react';
import {fakeStory} from '../../test-util';
import {reportStoryLaunchError} from '../report-story-launch-error';
import {
	firstLiveAssetUsagePassage,
	useTestFromHereAction
} from '../use-test-from-here-action';
import {useStoryLaunch} from '../use-story-launch';

jest.mock('../report-story-launch-error');
jest.mock('../use-story-launch');

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return {promise, reject, resolve};
}

describe('useTestFromHereAction', () => {
	const useStoryLaunchMock = useStoryLaunch as jest.Mock;
	const reportStoryLaunchErrorMock = reportStoryLaunchError as jest.Mock;
	let testStory: jest.Mock;

	beforeEach(() => {
		testStory = jest.fn();
		useStoryLaunchMock.mockReturnValue({testStory});
	});

	afterEach(() => jest.resetAllMocks());

	it('starts synchronously, guards duplicate launches, and clears on success', async () => {
		const story = fakeStory(1);
		const launch = deferred<void>();
		testStory.mockReturnValue(launch.promise);
		const {result} = renderHook(() => useTestFromHereAction(story));

		act(() => {
			result.current.run(story.passages[0].id);
			expect(testStory).toHaveBeenCalledWith(story.id, story.passages[0].id);
			result.current.run(story.passages[0].id);
		});

		expect(testStory).toHaveBeenCalledTimes(1);
		expect(result.current).toMatchObject({
			pending: true,
			pendingPassageId: story.passages[0].id
		});

		act(() => launch.resolve());
		await waitFor(() => expect(result.current.pending).toBe(false));
	});

	it('does not launch a passage that is absent from the current story', () => {
		const story = fakeStory(1);
		const {result} = renderHook(() => useTestFromHereAction(story));

		act(() => result.current.run('missing-passage'));

		expect(testStory).not.toHaveBeenCalled();
		expect(result.current.pending).toBe(false);
	});

	it('reports an active failure once and permits retry', async () => {
		const story = fakeStory(1);
		const failedLaunch = deferred<void>();
		testStory
			.mockReturnValueOnce(failedLaunch.promise)
			.mockResolvedValueOnce(undefined);
		const {result} = renderHook(() => useTestFromHereAction(story));
		const error = new Error('launch failed');

		act(() => result.current.run(story.passages[0].id));
		act(() => failedLaunch.reject(error));

		await waitFor(() => expect(result.current.pending).toBe(false));
		expect(reportStoryLaunchErrorMock).toHaveBeenCalledTimes(1);
		expect(reportStoryLaunchErrorMock).toHaveBeenCalledWith(error);

		act(() => result.current.run(story.passages[0].id));
		await waitFor(() => expect(result.current.pending).toBe(false));
		expect(testStory).toHaveBeenCalledTimes(2);
	});

	it('reports a synchronous launch failure once and permits retry', async () => {
		const story = fakeStory(1);
		const error = new Error('synchronous launch failure');
		testStory
			.mockImplementationOnce(() => {
				throw error;
			})
			.mockResolvedValueOnce(undefined);
		const {result} = renderHook(() => useTestFromHereAction(story));

		act(() => result.current.run(story.passages[0].id));

		expect(result.current.pending).toBe(false);
		expect(reportStoryLaunchErrorMock).toHaveBeenCalledTimes(1);
		expect(reportStoryLaunchErrorMock).toHaveBeenCalledWith(error);

		act(() => result.current.run(story.passages[0].id));
		await waitFor(() => expect(result.current.pending).toBe(false));
		expect(testStory).toHaveBeenCalledTimes(2);
	});

	it('keeps ownership across ordinary updates to the same story', () => {
		const story = fakeStory(1);
		const launch = deferred<void>();
		testStory.mockReturnValue(launch.promise);
		const {rerender, result} = renderHook(
			({value}) => useTestFromHereAction(value),
			{initialProps: {value: story}}
		);

		act(() => result.current.run(story.passages[0].id));
		rerender({value: {...story, name: 'Updated name'}});
		act(() => result.current.run(story.passages[0].id));

		expect(result.current.pending).toBe(true);
		expect(testStory).toHaveBeenCalledTimes(1);
	});

	it('reports an old failure after story change without disturbing the new launch', async () => {
		const storyA = {...fakeStory(1), id: 'story-a'};
		const storyB = {...fakeStory(1), id: 'story-b'};
		storyA.passages[0].story = storyA.id;
		storyB.passages[0].story = storyB.id;
		const launchA = deferred<void>();
		const launchB = deferred<void>();
		testStory
			.mockReturnValueOnce(launchA.promise)
			.mockReturnValueOnce(launchB.promise);
		const {rerender, result} = renderHook(
			({value}) => useTestFromHereAction(value),
			{initialProps: {value: storyA}}
		);

		act(() => result.current.run(storyA.passages[0].id));
		rerender({value: storyB});
		expect(result.current.pending).toBe(false);

		act(() => result.current.run(storyB.passages[0].id));
		expect(result.current.pendingPassageId).toBe(storyB.passages[0].id);

		const staleError = new Error('stale failure');
		act(() => launchA.reject(staleError));
		await act(async () => await Promise.resolve());
		expect(reportStoryLaunchErrorMock).toHaveBeenCalledTimes(1);
		expect(reportStoryLaunchErrorMock).toHaveBeenCalledWith(staleError);
		expect(result.current.pendingPassageId).toBe(storyB.passages[0].id);

		const currentError = new Error('current failure');
		act(() => launchB.reject(currentError));
		await waitFor(() => expect(result.current.pending).toBe(false));
		expect(reportStoryLaunchErrorMock).toHaveBeenCalledTimes(2);
		expect(reportStoryLaunchErrorMock).toHaveBeenNthCalledWith(2, currentError);
	});

	it('does not restore stale pending state after returning to an earlier story', async () => {
		const storyA = {...fakeStory(1), id: 'story-a'};
		const storyB = {...fakeStory(1), id: 'story-b'};
		storyA.passages[0].story = storyA.id;
		storyB.passages[0].story = storyB.id;
		const staleLaunch = deferred<void>();
		const currentLaunch = deferred<void>();
		testStory
			.mockReturnValueOnce(staleLaunch.promise)
			.mockReturnValueOnce(currentLaunch.promise);
		const {rerender, result} = renderHook(
			({value}) => useTestFromHereAction(value),
			{initialProps: {value: storyA}}
		);

		act(() => result.current.run(storyA.passages[0].id));
		rerender({value: storyB});
		rerender({value: storyA});

		expect(result.current.pending).toBe(false);
		act(() => result.current.run(storyA.passages[0].id));
		expect(result.current.pending).toBe(true);
		expect(testStory).toHaveBeenCalledTimes(2);

		const staleError = new Error('stale failure');
		act(() => staleLaunch.reject(staleError));
		await act(async () => await Promise.resolve());
		expect(reportStoryLaunchErrorMock).toHaveBeenCalledTimes(1);
		expect(reportStoryLaunchErrorMock).toHaveBeenCalledWith(staleError);
		expect(result.current.pending).toBe(true);

		act(() => currentLaunch.resolve());
		await waitFor(() => expect(result.current.pending).toBe(false));
	});

	it('reports a launch failure once after unmount', async () => {
		const story = fakeStory(1);
		const launch = deferred<void>();
		const error = new Error('late failure');
		testStory.mockReturnValue(launch.promise);
		const {result, unmount} = renderHook(() => useTestFromHereAction(story));

		act(() => result.current.run(story.passages[0].id));
		unmount();
		act(() => launch.reject(error));
		await act(async () => await Promise.resolve());

		expect(reportStoryLaunchErrorMock).toHaveBeenCalledTimes(1);
		expect(reportStoryLaunchErrorMock).toHaveBeenCalledWith(error);
	});
});

describe('firstLiveAssetUsagePassage', () => {
	it('returns the first live passage reference in indexed order', () => {
		const story = fakeStory(2);
		const result = firstLiveAssetUsagePassage(story, [
			{passageId: story.passages[1].id},
			{passageId: story.passages[0].id}
		]);

		expect(result).toBe(story.passages[1]);
	});

	it('skips non-passage and stale references before a live passage', () => {
		const story = fakeStory(1);
		const result = firstLiveAssetUsagePassage(story, [
			{passageId: null},
			{passageId: 'deleted-passage'},
			{passageId: story.passages[0].id}
		]);

		expect(result).toBe(story.passages[0]);
	});

	it('returns undefined when no reference resolves to a live passage', () => {
		const story = fakeStory(1);

		expect(
			firstLiveAssetUsagePassage(story, [
				{passageId: null},
				{passageId: 'deleted-passage'}
			])
		).toBeUndefined();
	});
});
