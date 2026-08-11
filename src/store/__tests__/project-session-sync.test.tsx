import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {useCoreProjectHost} from '../../core';
import type {
	NativeProjectSessionDelta,
	NativeProjectSessionStart
} from '../../electron/shared';
import {fakeStory} from '../../test-util';
import {
	getProjectMetadataRevision,
	loadProjectMetadata,
	subscribeProjectMetadata
} from '../project-metadata';
import {ProjectSessionSync} from '../project-session-sync';
import {StoriesContext} from '../stories';

let mockProjectMetadataRevision = 0;
const mockProjectMetadataListeners = new Set<() => void>();

jest.mock('../../core', () => ({
	...jest.requireActual('../../core'),
	replaceKnownAssetInventoryForStory: jest.fn(),
	useCoreProjectHost: jest.fn()
}));
jest.mock('../project-metadata', () => ({
	getProjectMetadataRevision: jest.fn(() => mockProjectMetadataRevision),
	loadProjectMetadata: jest.fn(),
	saveProjectMetadata: jest.fn(),
	subscribeProjectMetadata: jest.fn((listener: () => void) => {
		mockProjectMetadataListeners.add(listener);
		return () => mockProjectMetadataListeners.delete(listener);
	})
}));

describe('<ProjectSessionSync>', () => {
	beforeEach(() => {
		(getProjectMetadataRevision as jest.Mock).mockImplementation(
			() => mockProjectMetadataRevision
		);
		(subscribeProjectMetadata as jest.Mock).mockImplementation(
			(listener: () => void) => {
				mockProjectMetadataListeners.add(listener);
				return () => mockProjectMetadataListeners.delete(listener);
			}
		);
	});

	afterEach(() => {
		delete (window as any).twineElectron;
		mockProjectMetadataListeners.clear();
		mockProjectMetadataRevision = 0;
	});

	function start(
		rootPath: string,
		storyIds: string[] = [],
		sessionInstanceId = `session:${rootPath}`
	) {
		return {
			assets: [],
			generation: 1,
			performanceTimings: {
				assetCount: 0,
				baselineFileCount: 0,
				baselinePrimeMs: 0,
				descriptorPathCount: 0
			},
			rootPath,
			sessionInstanceId,
			storyIds
		} satisfies NativeProjectSessionStart;
	}

	function delta(
		id: string,
		rootPath: string,
		options: {recoveryMessage?: string; sessionInstanceId?: string} = {}
	): NativeProjectSessionDelta {
		return {
			baseGeneration: 1,
			candidateGeneration: 2,
			changedPaths: [`${rootPath}/${id}.twee`],
			delta: {changes: [], id},
			fileChanges: [],
			id,
			recovery: options.recoveryMessage
				? {
						changedPaths: [`${rootPath}/${id}.twee`],
						message: options.recoveryMessage,
						reason: 'schema'
					}
				: undefined,
			rootPath,
			scannedAt: new Date(0).toISOString(),
			sessionInstanceId: options.sessionInstanceId ?? `session:${rootPath}`
		};
	}

	function renderTwoRoots(
		options: {
			conflictCount?: number;
			delayFirstConflict?: boolean;
			recovery?: boolean;
		} = {}
	) {
		const stories = [
			{...fakeStory(), id: 'story-one'},
			{...fakeStory(), id: 'story-two'}
		];
		const rootsByStory = new Map([
			['story-one', '/one'],
			['story-two', '/two']
		]);
		let observeDelta: ((delta: NativeProjectSessionDelta) => void) | undefined;
		const conflictResult = {
			conflicts: Array.from(
				{length: options.conflictCount ?? 1},
				(_, index) => ({
					field: 'story:name',
					message: 'changed locally and on disk',
					passageId: null,
					path: index === 0 ? null : `conflict-${index + 1}.twee`,
					storyId: 'story-one'
				})
			),
			outcome: 'conflict'
		};
		let releaseFirstConflict: (() => void) | undefined;
		const firstConflict = options.delayFirstConflict
			? new Promise<typeof conflictResult>(resolve => {
					releaseFirstConflict = () => resolve(conflictResult);
				})
			: Promise.resolve(conflictResult);
		const ingestExternalDelta = jest.fn(
			async (_storyId: string, incoming: {id: string}) =>
				incoming.id === 'conflict-one'
					? firstConflict
					: Promise.resolve(conflictResult)
		);
		const resolveProjectSessionConflicts = jest.fn(async (rootPath: string) =>
			start(rootPath)
		);

		(loadProjectMetadata as jest.Mock).mockImplementation(
			(storyId: string) => ({
				rootPath: rootsByStory.get(storyId),
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			})
		);
		(useCoreProjectHost as jest.Mock).mockReturnValue({
			ensureSessionReady: jest.fn(async () => {}),
			ingestExternalDelta
		});
		(window as any).twineElectron = {
			onProjectSessionChanged: jest.fn(
				(listener: (delta: NativeProjectSessionDelta) => void) => {
					observeDelta = listener;
					return jest.fn();
				}
			),
			resolveProjectSessionConflicts,
			startProjectSession: jest.fn(async (rootPath: string) => start(rootPath)),
			stopProjectSession: jest.fn(async () => {})
		};
		const rendered = render(
			<StoriesContext.Provider value={{dispatch: jest.fn(), stories}}>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);
		const changes = options.recovery
			? [
					delta('recovery-one', '/one', {
						recoveryMessage: 'First project needs recovery.'
					}),
					delta('recovery-two', '/two', {
						recoveryMessage: 'Second project needs recovery.'
					})
				]
			: [delta('conflict-one', '/one'), delta('conflict-two', '/two')];

		return {
			changes,
			emitChange: async (change: NativeProjectSessionDelta) => {
				await waitFor(() => expect(observeDelta).toBeDefined());
				await act(async () => {
					observeDelta!(change);
					await Promise.resolve();
					await Promise.resolve();
				});
			},
			emitChanges: async () => {
				await waitFor(() => expect(observeDelta).toBeDefined());
				await act(async () => {
					for (const change of changes) {
						observeDelta!(change);
					}
					await Promise.resolve();
					await Promise.resolve();
				});
			},
			ingestExternalDelta,
			releaseFirstConflict,
			rendered,
			resolveProjectSessionConflicts
		};
	}

	it('starts, stops, and restarts in StrictMode while ignoring a canceled stale start', async () => {
		const rootPath = '/project';
		const story = fakeStory();
		const ensureSessionReady = jest.fn(async () => {});
		const firstStart = {} as {
			reject: (error: Error) => void;
			promise: Promise<NativeProjectSessionStart>;
		};

		firstStart.promise = new Promise((_resolve, reject) => {
			firstStart.reject = reject;
		});
		const start: NativeProjectSessionStart = {
			assets: [],
			generation: 1,
			performanceTimings: {
				assetCount: 0,
				baselineFileCount: 0,
				baselinePrimeMs: 0,
				descriptorPathCount: 0
			},
			rootPath,
			sessionInstanceId: `session:${rootPath}`,
			storyIds: [story.id]
		};
		const startProjectSession = jest
			.fn()
			.mockReturnValueOnce(firstStart.promise)
			.mockResolvedValueOnce(start);
		const stopProjectSession = jest.fn(async () => {});
		const unsubscribe = jest.fn();

		(loadProjectMetadata as jest.Mock).mockReturnValue({
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(useCoreProjectHost as jest.Mock).mockReturnValue({ensureSessionReady});
		(window as any).twineElectron = {
			onProjectSessionChanged: jest.fn(() => unsubscribe),
			startProjectSession,
			stopProjectSession
		};
		const {unmount} = render(
			<React.StrictMode>
				<StoriesContext.Provider
					value={{dispatch: jest.fn(), stories: [story]}}
				>
					<ProjectSessionSync />
				</StoriesContext.Provider>
			</React.StrictMode>
		);

		await waitFor(() => expect(startProjectSession).toHaveBeenCalledTimes(1));
		await act(async () => {
			firstStart.reject(
				Object.assign(new Error('Project session start was canceled.'), {
					code: 'PROJECT_SESSION_START_CANCELED'
				})
			);
			await Promise.resolve();
		});
		await waitFor(() => expect(startProjectSession).toHaveBeenCalledTimes(2));
		expect(stopProjectSession).toHaveBeenCalledTimes(1);
		expect(startProjectSession.mock.invocationCallOrder[0]).toBeLessThan(
			stopProjectSession.mock.invocationCallOrder[0]
		);
		expect(stopProjectSession.mock.invocationCallOrder[0]).toBeLessThan(
			startProjectSession.mock.invocationCallOrder[1]
		);
		await waitFor(() => expect(ensureSessionReady).toHaveBeenCalledTimes(1));

		expect(ensureSessionReady).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole('status')).toBeNull();

		unmount();
		await waitFor(() => expect(stopProjectSession).toHaveBeenCalledTimes(2));
	});

	it('moves synchronization to a metadata root change without a story update', async () => {
		const story = fakeStory();
		let rootPath = '/old-project';
		let observeDelta: ((delta: NativeProjectSessionDelta) => void) | undefined;
		const ensureSessionReady = jest.fn(async () => {});
		const ingestExternalDelta = jest.fn(async () => ({
			conflicts: [],
			outcome: 'applied'
		}));
		const startProjectSession = jest.fn(async (root: string) =>
			start(root, [story.id])
		);
		const stopProjectSession = jest.fn(async () => {});

		(loadProjectMetadata as jest.Mock).mockImplementation(() => ({
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		}));
		(useCoreProjectHost as jest.Mock).mockReturnValue({
			ensureSessionReady,
			ingestExternalDelta
		});
		(window as any).twineElectron = {
			onProjectSessionChanged: jest.fn(
				(listener: (delta: NativeProjectSessionDelta) => void) => {
					observeDelta = listener;
					return jest.fn();
				}
			),
			startProjectSession,
			stopProjectSession
		};
		const rendered = render(
			<StoriesContext.Provider value={{dispatch: jest.fn(), stories: [story]}}>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);
		await waitFor(() =>
			expect(startProjectSession).toHaveBeenCalledWith('/old-project', [
				story.id
			])
		);
		await waitFor(() => expect(ensureSessionReady).toHaveBeenCalled());
		rootPath = '/new-project';
		await act(async () => {
			observeDelta!(delta('stale-old-root', '/old-project'));
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(ingestExternalDelta).not.toHaveBeenCalled();
		act(() => {
			mockProjectMetadataRevision++;
			for (const listener of [...mockProjectMetadataListeners]) {
				listener();
			}
		});
		await waitFor(() =>
			expect(startProjectSession).toHaveBeenCalledWith('/new-project', [
				story.id
			])
		);
		expect(stopProjectSession).toHaveBeenCalledWith('/old-project');
		rendered.unmount();
	});

	it('restarts a same-root native session after a replacement metadata commit', async () => {
		const story = fakeStory();
		const rootPath = '/same-project';
		let updatedAt = 'before-replacement';
		const ensureSessionReady = jest.fn(async () => {});
		const startProjectSession = jest.fn(async (root: string) =>
			start(root, [story.id])
		);
		const stopProjectSession = jest.fn(async () => {});

		(loadProjectMetadata as jest.Mock).mockImplementation(() => ({
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder',
			updatedAt
		}));
		(useCoreProjectHost as jest.Mock).mockReturnValue({ensureSessionReady});
		(window as any).twineElectron = {
			onProjectSessionChanged: jest.fn(() => jest.fn()),
			startProjectSession,
			stopProjectSession
		};
		const rendered = render(
			<StoriesContext.Provider value={{dispatch: jest.fn(), stories: [story]}}>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);

		await waitFor(() => expect(startProjectSession).toHaveBeenCalledTimes(1));
		updatedAt = 'after-replacement';
		act(() => {
			mockProjectMetadataRevision++;
			for (const listener of [...mockProjectMetadataListeners]) {
				listener();
			}
		});
		await waitFor(() => expect(startProjectSession).toHaveBeenCalledTimes(2));
		expect(stopProjectSession).toHaveBeenCalledWith(rootPath);
		expect(startProjectSession).toHaveBeenLastCalledWith(rootPath, [story.id]);
		rendered.unmount();
	});

	it('does not restart a pending native session for a content-only story update', async () => {
		const rootPath = '/project';
		const story = fakeStory();
		const ensureSessionReady = jest.fn(async () => {});
		let resolveStart: (start: NativeProjectSessionStart) => void = () =>
			undefined;
		const pendingStart = new Promise<NativeProjectSessionStart>(resolve => {
			resolveStart = resolve;
		});
		const startProjectSession = jest.fn(() => pendingStart);
		const stopProjectSession = jest.fn(async () => {});

		(loadProjectMetadata as jest.Mock).mockReturnValue({
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(useCoreProjectHost as jest.Mock).mockReturnValue({ensureSessionReady});
		(window as any).twineElectron = {
			onProjectSessionChanged: jest.fn(() => jest.fn()),
			startProjectSession,
			stopProjectSession
		};
		const rendered = render(
			<StoriesContext.Provider value={{dispatch: jest.fn(), stories: [story]}}>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);

		await waitFor(() => expect(startProjectSession).toHaveBeenCalledTimes(1));
		rendered.rerender(
			<StoriesContext.Provider
				value={{dispatch: jest.fn(), stories: [{...story, name: 'Updated'}]}}
			>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(startProjectSession).toHaveBeenCalledTimes(1);
		expect(stopProjectSession).not.toHaveBeenCalled();

		await act(async () => {
			resolveStart(start(rootPath, [story.id]));
			await Promise.resolve();
		});
		await waitFor(() =>
			expect(ensureSessionReady).toHaveBeenCalledWith(story.id)
		);
		expect(startProjectSession).toHaveBeenCalledTimes(1);
		expect(stopProjectSession).not.toHaveBeenCalled();
		rendered.unmount();
		await waitFor(() => expect(stopProjectSession).toHaveBeenCalledTimes(1));
	});

	it('does not restart a settled native session for a content-only story update', async () => {
		const rootPath = '/project';
		const story = fakeStory();
		const ensureSessionReady = jest.fn(async () => {});
		const startProjectSession = jest.fn(async () =>
			start(rootPath, [story.id])
		);
		const stopProjectSession = jest.fn(async () => {});

		(loadProjectMetadata as jest.Mock).mockReturnValue({
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(useCoreProjectHost as jest.Mock).mockReturnValue({ensureSessionReady});
		(window as any).twineElectron = {
			onProjectSessionChanged: jest.fn(() => jest.fn()),
			startProjectSession,
			stopProjectSession
		};
		const rendered = render(
			<StoriesContext.Provider value={{dispatch: jest.fn(), stories: [story]}}>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);

		await waitFor(() =>
			expect(ensureSessionReady).toHaveBeenCalledWith(story.id)
		);
		rendered.rerender(
			<StoriesContext.Provider
				value={{dispatch: jest.fn(), stories: [{...story, name: 'Updated'}]}}
			>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(startProjectSession).toHaveBeenCalledTimes(1);
		expect(stopProjectSession).not.toHaveBeenCalled();

		rendered.unmount();
		await waitFor(() => expect(stopProjectSession).toHaveBeenCalledTimes(1));
	});

	it('restarts a same-root session when its story membership changes', async () => {
		const rootPath = '/project';
		const firstStory = {...fakeStory(), id: 'story-z'};
		const secondStory = {...fakeStory(), id: 'story-a'};
		const ensureSessionReady = jest.fn(async () => {});
		let resolveFirstStart: (start: NativeProjectSessionStart) => void = () =>
			undefined;
		const firstStart = new Promise<NativeProjectSessionStart>(resolve => {
			resolveFirstStart = resolve;
		});
		const startProjectSession = jest
			.fn(
				async (
					root: string,
					storyIds: string[]
				): Promise<NativeProjectSessionStart> => start(root, storyIds)
			)
			.mockReturnValueOnce(firstStart);
		const stopProjectSession = jest.fn(async () => {});

		(loadProjectMetadata as jest.Mock).mockReturnValue({
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(useCoreProjectHost as jest.Mock).mockReturnValue({ensureSessionReady});
		(window as any).twineElectron = {
			onProjectSessionChanged: jest.fn(() => jest.fn()),
			startProjectSession,
			stopProjectSession
		};
		const rendered = render(
			<StoriesContext.Provider
				value={{dispatch: jest.fn(), stories: [firstStory]}}
			>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);

		await waitFor(() =>
			expect(startProjectSession).toHaveBeenCalledWith(rootPath, ['story-z'])
		);
		rendered.rerender(
			<StoriesContext.Provider
				value={{dispatch: jest.fn(), stories: [firstStory, secondStory]}}
			>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);

		await act(async () => {
			await Promise.resolve();
		});
		expect(startProjectSession).toHaveBeenCalledTimes(1);
		expect(stopProjectSession).toHaveBeenCalledTimes(1);
		await act(async () => {
			resolveFirstStart(start(rootPath, [firstStory.id], 'session:stale'));
			await Promise.resolve();
		});
		await waitFor(() => expect(startProjectSession).toHaveBeenCalledTimes(2));
		expect(stopProjectSession).toHaveBeenCalledTimes(2);
		expect(stopProjectSession).toHaveBeenCalledWith(rootPath);
		expect(startProjectSession).toHaveBeenLastCalledWith(rootPath, [
			'story-a',
			'story-z'
		]);
		expect(stopProjectSession.mock.invocationCallOrder[1]).toBeLessThan(
			startProjectSession.mock.invocationCallOrder[1]
		);
		rendered.unmount();
	});

	it('restarts only a changed root while another root start and delta remain pending', async () => {
		const firstStory = {...fakeStory(), id: 'story-one'};
		const secondStory = {...fakeStory(), id: 'story-two'};
		let firstUpdatedAt = 'before-replacement';
		let observeDelta: ((delta: NativeProjectSessionDelta) => void) | undefined;
		let resolveSecondStart: (value: NativeProjectSessionStart) => void = () =>
			undefined;
		const secondStart = new Promise<NativeProjectSessionStart>(resolve => {
			resolveSecondStart = resolve;
		});
		const ensureSessionReady = jest.fn(async () => {});
		const ingestExternalDelta = jest.fn(async () => ({
			conflicts: [],
			outcome: 'applied'
		}));
		const startProjectSession = jest.fn(
			(rootPath: string, storyIds: string[]) =>
				rootPath === '/two'
					? secondStart
					: Promise.resolve(start(rootPath, storyIds))
		);
		const stopProjectSession = jest.fn(async () => {});
		const resolveProjectSessionConflicts = jest.fn(async (rootPath: string) =>
			start(rootPath)
		);

		(loadProjectMetadata as jest.Mock).mockImplementation(
			(storyId: string) => ({
				rootPath: storyId === firstStory.id ? '/one' : '/two',
				status: 'file-backed',
				storageKind: 'electron-project-folder',
				updatedAt: storyId === firstStory.id ? firstUpdatedAt : 'unchanged'
			})
		);
		(useCoreProjectHost as jest.Mock).mockReturnValue({
			ensureSessionReady,
			ingestExternalDelta
		});
		(window as any).twineElectron = {
			onProjectSessionChanged: jest.fn(
				(listener: (change: NativeProjectSessionDelta) => void) => {
					observeDelta = listener;
					return jest.fn();
				}
			),
			resolveProjectSessionConflicts,
			startProjectSession,
			stopProjectSession
		};
		const rendered = render(
			<StoriesContext.Provider
				value={{dispatch: jest.fn(), stories: [firstStory, secondStory]}}
			>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);

		await waitFor(() =>
			expect(startProjectSession).toHaveBeenCalledWith('/one', [firstStory.id])
		);
		await waitFor(() =>
			expect(startProjectSession).toHaveBeenCalledWith('/two', [secondStory.id])
		);
		await act(async () => {
			observeDelta!(delta('buffered-two', '/two'));
			await Promise.resolve();
		});
		firstUpdatedAt = 'after-replacement';
		act(() => {
			mockProjectMetadataRevision++;
			for (const listener of [...mockProjectMetadataListeners]) {
				listener();
			}
		});

		await waitFor(() => expect(startProjectSession).toHaveBeenCalledTimes(3));
		expect(
			startProjectSession.mock.calls.filter(([rootPath]) => rootPath === '/two')
		).toHaveLength(1);
		expect(stopProjectSession).toHaveBeenCalledTimes(1);
		expect(stopProjectSession).toHaveBeenCalledWith('/one');

		await act(async () => {
			resolveSecondStart(start('/two', [secondStory.id]));
			await Promise.resolve();
		});
		await waitFor(() =>
			expect(ensureSessionReady).toHaveBeenCalledWith(secondStory.id)
		);
		await waitFor(() =>
			expect(ingestExternalDelta).toHaveBeenCalledWith(
				secondStory.id,
				expect.objectContaining({id: 'buffered-two'})
			)
		);
		await waitFor(() =>
			expect(resolveProjectSessionConflicts).toHaveBeenCalledWith(
				'/two',
				'acceptDisk',
				undefined,
				'buffered-two'
			)
		);
		expect(stopProjectSession).not.toHaveBeenCalledWith('/two');
		rendered.unmount();
	});

	it('retains an unchanged root review while another root lifecycle changes', async () => {
		const firstStory = {...fakeStory(), id: 'story-one'};
		const secondStory = {...fakeStory(), id: 'story-two'};
		let firstRootPath = '/one';
		let observeDelta: ((delta: NativeProjectSessionDelta) => void) | undefined;
		const ensureSessionReady = jest.fn(async () => {});
		const ingestExternalDelta = jest.fn(async () => ({
			conflicts: [
				{
					field: 'story:name',
					message: 'changed locally and on disk',
					passageId: null,
					path: 'conflict-two.twee',
					storyId: secondStory.id
				}
			],
			outcome: 'conflict'
		}));
		const startProjectSession = jest.fn(
			async (rootPath: string, storyIds: string[]) => start(rootPath, storyIds)
		);
		const stopProjectSession = jest.fn(async () => {});
		const resolveProjectSessionConflicts = jest.fn(async (rootPath: string) =>
			start(rootPath)
		);

		(loadProjectMetadata as jest.Mock).mockImplementation(
			(storyId: string) => ({
				rootPath: storyId === firstStory.id ? firstRootPath : '/two',
				status: 'file-backed',
				storageKind: 'electron-project-folder',
				updatedAt: 'unchanged'
			})
		);
		(useCoreProjectHost as jest.Mock).mockReturnValue({
			ensureSessionReady,
			ingestExternalDelta
		});
		(window as any).twineElectron = {
			onProjectSessionChanged: jest.fn(
				(listener: (change: NativeProjectSessionDelta) => void) => {
					observeDelta = listener;
					return jest.fn();
				}
			),
			resolveProjectSessionConflicts,
			startProjectSession,
			stopProjectSession
		};
		const rendered = render(
			<StoriesContext.Provider
				value={{dispatch: jest.fn(), stories: [firstStory, secondStory]}}
			>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);

		await waitFor(() => expect(ensureSessionReady).toHaveBeenCalledTimes(2));
		await act(async () => {
			observeDelta!(delta('conflict-two', '/two'));
			await Promise.resolve();
			await Promise.resolve();
		});
		await screen.findByText(/conflict-two\.twee/);
		firstRootPath = '/new-one';
		act(() => {
			mockProjectMetadataRevision++;
			for (const listener of [...mockProjectMetadataListeners]) {
				listener();
			}
		});

		await waitFor(() => expect(startProjectSession).toHaveBeenCalledTimes(3));
		expect(startProjectSession).toHaveBeenCalledWith('/new-one', [
			firstStory.id
		]);
		expect(stopProjectSession).toHaveBeenCalledWith('/one');
		expect(
			startProjectSession.mock.calls.filter(([rootPath]) => rootPath === '/two')
		).toHaveLength(1);
		expect(stopProjectSession).not.toHaveBeenCalledWith('/two');
		expect(screen.getByText(/conflict-two\.twee/)).toBeVisible();
		fireEvent.click(screen.getByRole('button', {name: 'Later'}));
		await waitFor(() =>
			expect(resolveProjectSessionConflicts).toHaveBeenCalledWith(
				'/two',
				'dismiss',
				undefined,
				'conflict-two'
			)
		);
		rendered.unmount();
	});

	it('keeps an active root running when another root is removed', async () => {
		const firstStory = {...fakeStory(), id: 'story-one'};
		const secondStory = {...fakeStory(), id: 'story-two'};
		let observeDelta: ((delta: NativeProjectSessionDelta) => void) | undefined;
		const ensureSessionReady = jest.fn(async () => {});
		const ingestExternalDelta = jest.fn(async () => ({
			conflicts: [],
			outcome: 'applied'
		}));
		const startProjectSession = jest.fn(
			async (rootPath: string, storyIds: string[]) => start(rootPath, storyIds)
		);
		const stopProjectSession = jest.fn(async () => {});
		const resolveProjectSessionConflicts = jest.fn(async (rootPath: string) =>
			start(rootPath)
		);

		(loadProjectMetadata as jest.Mock).mockImplementation(
			(storyId: string) => ({
				rootPath: storyId === firstStory.id ? '/one' : '/two',
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			})
		);
		(useCoreProjectHost as jest.Mock).mockReturnValue({
			ensureSessionReady,
			ingestExternalDelta
		});
		(window as any).twineElectron = {
			onProjectSessionChanged: jest.fn(
				(listener: (change: NativeProjectSessionDelta) => void) => {
					observeDelta = listener;
					return jest.fn();
				}
			),
			resolveProjectSessionConflicts,
			startProjectSession,
			stopProjectSession
		};
		const rendered = render(
			<StoriesContext.Provider
				value={{dispatch: jest.fn(), stories: [firstStory, secondStory]}}
			>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);

		await waitFor(() => expect(ensureSessionReady).toHaveBeenCalledTimes(2));
		rendered.rerender(
			<StoriesContext.Provider
				value={{dispatch: jest.fn(), stories: [secondStory]}}
			>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);
		await waitFor(() =>
			expect(stopProjectSession).toHaveBeenCalledWith('/one')
		);
		expect(startProjectSession).toHaveBeenCalledTimes(2);
		expect(
			startProjectSession.mock.calls.filter(([rootPath]) => rootPath === '/two')
		).toHaveLength(1);
		expect(stopProjectSession).not.toHaveBeenCalledWith('/two');

		await act(async () => {
			observeDelta!(delta('after-removal', '/two'));
			await Promise.resolve();
			await Promise.resolve();
		});
		await waitFor(() =>
			expect(ingestExternalDelta).toHaveBeenCalledWith(
				secondStory.id,
				expect.objectContaining({id: 'after-removal'})
			)
		);
		await waitFor(() =>
			expect(resolveProjectSessionConflicts).toHaveBeenCalledWith(
				'/two',
				'acceptDisk',
				undefined,
				'after-removal'
			)
		);
		expect(stopProjectSession).not.toHaveBeenCalledWith('/two');
		rendered.unmount();
	});

	it('clears an abandoned root classification before showing another root review', async () => {
		const firstStory = {...fakeStory(), id: 'story-one'};
		const secondStory = {...fakeStory(), id: 'story-two'};
		let firstRootPath = '/one';
		let observeDelta: ((delta: NativeProjectSessionDelta) => void) | undefined;
		let resolveFirstIngest: (() => void) | undefined;
		const firstIngest = new Promise<{conflicts: []; outcome: 'applied'}>(
			resolve => {
				resolveFirstIngest = () => resolve({conflicts: [], outcome: 'applied'});
			}
		);
		const ingestExternalDelta = jest.fn((storyId: string) =>
			storyId === firstStory.id
				? firstIngest
				: Promise.resolve({
						conflicts: [
							{
								field: 'story:name',
								message: 'changed locally and on disk',
								passageId: null,
								path: 'conflict-two.twee',
								storyId: secondStory.id
							}
						],
						outcome: 'conflict'
					})
		);
		const resolveProjectSessionConflicts = jest.fn(async (rootPath: string) =>
			start(rootPath)
		);

		(loadProjectMetadata as jest.Mock).mockImplementation(
			(storyId: string) => ({
				rootPath: storyId === firstStory.id ? firstRootPath : '/two',
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			})
		);
		(useCoreProjectHost as jest.Mock).mockReturnValue({
			ensureSessionReady: jest.fn(async () => {}),
			ingestExternalDelta
		});
		(window as any).twineElectron = {
			onProjectSessionChanged: jest.fn(
				(listener: (change: NativeProjectSessionDelta) => void) => {
					observeDelta = listener;
					return jest.fn();
				}
			),
			resolveProjectSessionConflicts,
			startProjectSession: jest.fn(
				async (rootPath: string, storyIds: string[]) =>
					start(rootPath, storyIds)
			),
			stopProjectSession: jest.fn(async () => {})
		};
		const rendered = render(
			<StoriesContext.Provider
				value={{dispatch: jest.fn(), stories: [firstStory, secondStory]}}
			>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);

		await waitFor(() => expect(observeDelta).toBeDefined());
		await act(async () => {
			observeDelta!(delta('pending-one', '/one'));
			await Promise.resolve();
		});
		await waitFor(() =>
			expect(ingestExternalDelta).toHaveBeenCalledWith(
				firstStory.id,
				expect.anything()
			)
		);
		firstRootPath = '/new-one';
		act(() => {
			mockProjectMetadataRevision++;
			for (const listener of [...mockProjectMetadataListeners]) {
				listener();
			}
		});
		await act(async () => {
			observeDelta!(delta('conflict-two', '/two'));
			await Promise.resolve();
			await Promise.resolve();
		});

		await screen.findByText(/conflict-two\.twee/);
		fireEvent.click(screen.getByRole('button', {name: 'Later'}));
		await waitFor(() =>
			expect(resolveProjectSessionConflicts).toHaveBeenCalledWith(
				'/two',
				'dismiss',
				undefined,
				'conflict-two'
			)
		);
		expect(resolveFirstIngest).toBeDefined();
		rendered.unmount();
	});

	it('subscribes before a native session start emits its first delta', async () => {
		const rootPath = '/project';
		const story = fakeStory();
		let observeDelta: ((delta: NativeProjectSessionDelta) => void) | undefined;
		const ingestExternalDelta = jest.fn(async () => ({
			conflicts: [],
			outcome: 'applied'
		}));
		const resolveProjectSessionConflicts = jest.fn(async (path: string) =>
			start(path)
		);

		(loadProjectMetadata as jest.Mock).mockReturnValue({
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(useCoreProjectHost as jest.Mock).mockReturnValue({
			ensureSessionReady: jest.fn(async () => {}),
			ingestExternalDelta
		});
		(window as any).twineElectron = {
			onProjectSessionChanged: jest.fn(
				(listener: (change: NativeProjectSessionDelta) => void) => {
					observeDelta = listener;
					return jest.fn();
				}
			),
			resolveProjectSessionConflicts,
			startProjectSession: jest.fn(async () => {
				observeDelta!(delta('start-delta', rootPath));
				return start(rootPath, [story.id]);
			}),
			stopProjectSession: jest.fn(async () => {})
		};
		const rendered = render(
			<StoriesContext.Provider value={{dispatch: jest.fn(), stories: [story]}}>
				<ProjectSessionSync />
			</StoriesContext.Provider>
		);

		await waitFor(() =>
			expect(ingestExternalDelta).toHaveBeenCalledWith(
				story.id,
				expect.objectContaining({id: 'start-delta'})
			)
		);
		await waitFor(() =>
			expect(resolveProjectSessionConflicts).toHaveBeenCalledWith(
				rootPath,
				'acceptDisk',
				undefined,
				'start-delta'
			)
		);
		rendered.unmount();
	});

	it('reviews simultaneous conflicts for different roots in FIFO order', async () => {
		const context = renderTwoRoots();

		await context.emitChanges();
		await screen.findByText(/conflict-one\.twee/);
		expect(screen.getByText(/1 disk change requires review/)).toBeVisible();
		expect(
			screen.getByText(
				'Using the disk version replaces conflicting app values. Keeping the app version overwrites the changed project files on disk.'
			)
		).toBeVisible();
		expect(
			screen.getByRole('button', {name: 'Use Disk Version'})
		).toBeVisible();
		expect(
			screen.getByRole('button', {name: 'Keep App Version'})
		).toBeVisible();
		expect(screen.getByText('1 more project change queued.')).toBeVisible();

		fireEvent.click(screen.getByRole('button', {name: 'Later'}));
		await waitFor(() =>
			expect(context.resolveProjectSessionConflicts).toHaveBeenCalledWith(
				'/one',
				'dismiss',
				undefined,
				'conflict-one'
			)
		);
		await screen.findByText(/conflict-two\.twee/);
		fireEvent.click(screen.getByRole('button', {name: 'Later'}));
		await waitFor(() =>
			expect(context.resolveProjectSessionConflicts).toHaveBeenCalledWith(
				'/two',
				'dismiss',
				undefined,
				'conflict-two'
			)
		);
		await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
	});

	it('preserves observation order when the first conflict resolves last', async () => {
		const context = renderTwoRoots({delayFirstConflict: true});

		await context.emitChanges();
		expect(screen.queryByRole('status')).toBeNull();
		await act(async () => {
			context.releaseFirstConflict!();
			await Promise.resolve();
		});
		await screen.findByText(/conflict-one\.twee/);
		expect(screen.queryByText(/conflict-two\.twee/)).toBeNull();

		fireEvent.click(screen.getByRole('button', {name: 'Later'}));
		await screen.findByText(/conflict-two\.twee/);
	});

	it('uses plural grammar when multiple disk changes need review', async () => {
		const context = renderTwoRoots({conflictCount: 2});

		await context.emitChange(context.changes[0]);
		expect(screen.getByText(/2 disk changes require review/)).toBeVisible();
		context.rendered.unmount();
	});

	it('keeps simultaneous recovery reviews for different roots reachable', async () => {
		const context = renderTwoRoots({recovery: true});

		await context.emitChanges();
		await screen.findByText('First project needs recovery.');
		expect(
			screen.getByText(
				'Reloading from disk replaces the app version and resets undo history. Keeping the app version overwrites the changed project files on disk.'
			)
		).toBeVisible();
		expect(
			screen.getByRole('button', {name: 'Reload From Disk'})
		).toBeVisible();
		expect(screen.getByText('1 more project change queued.')).toBeVisible();

		fireEvent.click(screen.getByRole('button', {name: 'Later'}));
		await screen.findByText('Second project needs recovery.');
		fireEvent.click(screen.getByRole('button', {name: 'Later'}));
		await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
		expect(context.ingestExternalDelta).not.toHaveBeenCalled();
		expect(context.resolveProjectSessionConflicts.mock.calls).toEqual([
			['/one', 'dismiss', undefined, 'recovery-one'],
			['/two', 'dismiss', undefined, 'recovery-two']
		]);
	});

	it('ignores late notifications from a retired session instance', async () => {
		const context = renderTwoRoots();

		await context.emitChange(
			delta('stale', '/one', {sessionInstanceId: 'retired-session'})
		);
		await Promise.resolve();
		expect(context.ingestExternalDelta).not.toHaveBeenCalled();
		expect(screen.queryByRole('status')).toBeNull();
	});
});
