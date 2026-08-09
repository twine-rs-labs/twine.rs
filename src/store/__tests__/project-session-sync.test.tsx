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
