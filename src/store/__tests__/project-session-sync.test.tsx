import {act, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {useCoreProjectHost} from '../../core';
import type {NativeProjectSessionStart} from '../../electron/shared';
import {fakeStory} from '../../test-util';
import {loadProjectMetadata} from '../project-metadata';
import {ProjectSessionSync} from '../project-session-sync';
import {StoriesContext} from '../stories';

jest.mock('../../core', () => ({
	...jest.requireActual('../../core'),
	replaceKnownAssetInventoryForStory: jest.fn(),
	useCoreProjectHost: jest.fn()
}));
jest.mock('../project-metadata', () => ({
	loadProjectMetadata: jest.fn(),
	saveProjectMetadata: jest.fn()
}));

describe('<ProjectSessionSync>', () => {
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

		await waitFor(() => expect(startProjectSession).toHaveBeenCalledTimes(2));
		expect(stopProjectSession).toHaveBeenCalledTimes(1);
		expect(startProjectSession.mock.invocationCallOrder[0]).toBeLessThan(
			stopProjectSession.mock.invocationCallOrder[0]
		);
		expect(stopProjectSession.mock.invocationCallOrder[0]).toBeLessThan(
			startProjectSession.mock.invocationCallOrder[1]
		);
		await waitFor(() => expect(ensureSessionReady).toHaveBeenCalledTimes(1));

		await act(async () => {
			firstStart.reject(
				Object.assign(new Error('Project session start was canceled.'), {
					code: 'PROJECT_SESSION_START_CANCELED'
				})
			);
			await Promise.resolve();
		});
		expect(ensureSessionReady).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole('status')).toBeNull();

		unmount();
		await waitFor(() => expect(stopProjectSession).toHaveBeenCalledTimes(2));
	});
});
