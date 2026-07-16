import {renderHook} from '@testing-library/react';
import {useStoryLaunch} from '../use-story-launch';
import {isElectronRenderer} from '../../util/is-electron';
import {usePublishing} from '../use-publishing';
import {saveProjectMetadata} from '../project-metadata';

jest.mock('../use-publishing');
jest.mock('../../util/is-electron');

describe('useStoryLaunch', () => {
	const isElectronRendererMock = isElectronRenderer as jest.Mock;
	const usePublishingMock = usePublishing as jest.Mock;
	let openSpy: jest.SpyInstance;
	let proofStoryPackageMock: jest.Mock;
	let publishStoryPackageMock: jest.Mock;

	beforeEach(() => {
		window.localStorage.clear();
		const assets = [
			{outputPath: 'assets/cover.png', sourcePath: '/tmp/cover.png'}
		];
		proofStoryPackageMock = jest.fn((storyId: string) =>
			Promise.resolve({
				assets,
				html: `mock-proofed-story-${storyId}`,
				report: {}
			})
		);
		publishStoryPackageMock = jest.fn((storyId: string, options: any) =>
			Promise.resolve({
				assets,
				html: `mock-published-story-${storyId}-${JSON.stringify(options)}`,
				report: {}
			})
		);

		usePublishingMock.mockReturnValue({
			proofStoryPackage: proofStoryPackageMock,
			publishStoryPackage: publishStoryPackageMock,
			proofStory: (storyId: string) =>
				Promise.resolve(`mock-proofed-story-${storyId}`),
			publishStory: (storyId: string, options: any) =>
				Promise.resolve(
					`mock-published-story-${storyId}-${JSON.stringify(options)}`
				)
		});
	});

	describe('in a browser context', () => {
		beforeEach(() => {
			openSpy = jest.fn();
			isElectronRendererMock.mockReturnValue(false);
			(window as any).open = openSpy;
		});

		it('opens a new browser window when playing a story', () => {
			const {result} = renderHook(() => useStoryLaunch());

			expect(openSpy).not.toHaveBeenCalled();
			result.current.playStory('mock-story-id');
			expect(openSpy.mock.calls).toEqual([
				['#/stories/mock-story-id/play', '_blank']
			]);
		});

		it('opens a new browser window when proofing a story', () => {
			const {result} = renderHook(() => useStoryLaunch());

			expect(openSpy).not.toHaveBeenCalled();
			result.current.proofStory('mock-story-id');
			expect(openSpy.mock.calls).toEqual([
				['#/stories/mock-story-id/proof', '_blank']
			]);
		});

		it('opens a new browser window when testing a story', () => {
			const {result} = renderHook(() => useStoryLaunch());

			expect(openSpy).not.toHaveBeenCalled();
			result.current.testStory('mock-story-id');
			expect(openSpy.mock.calls).toEqual([
				['#/stories/mock-story-id/test', '_blank']
			]);
		});
	});

	describe('in an Electron context', () => {
		let openWithScratchPackage: jest.SpyInstance;

		beforeEach(() => {
			openWithScratchPackage = jest.fn();
			isElectronRendererMock.mockReturnValue(true);
			(window as any).twineElectron = {openWithScratchPackage};
		});

		it('calls openWithScratchPackage() on the twineElectron global when playing a story', async () => {
			const {result} = renderHook(() => useStoryLaunch());

			expect(openWithScratchPackage).not.toHaveBeenCalled();
			await result.current.playStory('mock-story-id');
			expect(openWithScratchPackage.mock.calls).toEqual([
				[
					'mock-published-story-mock-story-id-{"buildTarget":"play"}',
					'play-mock-story-id.html',
					[{outputPath: 'assets/cover.png', sourcePath: '/tmp/cover.png'}]
				]
			]);
		});

		it('refreshes project assets before building an Electron play package', async () => {
			const inventory = [
				{
					exists: true,
					kind: 'image',
					missing: false,
					path: 'assets/live-cover.png',
					previewUrl: 'file:///native/project/assets/live-cover.png',
					publish: {
						copy: true,
						outputPath: 'assets/live-cover.png',
						reason: 'Copy asset into published output'
					},
					thumbnailUrl: 'file:///native/project/assets/live-cover.png'
				}
			];
			const projectSessionSnapshot = jest.fn(async () => ({assets: inventory}));

			saveProjectMetadata('mock-story-id', {
				rootPath: '/native/project',
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});
			(window as any).twineElectron = {
				openWithScratchPackage,
				projectSessionSnapshot
			};

			const {result} = renderHook(() => useStoryLaunch());

			await result.current.playStory('mock-story-id');

			expect(projectSessionSnapshot).toHaveBeenCalledWith('/native/project');
			expect(publishStoryPackageMock).toHaveBeenCalledWith('mock-story-id', {
				assetInventory: inventory,
				buildTarget: 'play'
			});
		});

		it('throws an error when playing a story if the twineElectron global is not present', () => {
			delete (window as any).twineElectron;

			expect(() => renderHook(() => useStoryLaunch())).toThrow(
				'Electron bridge is not present on window.'
			);
		});

		it('calls openWithScratchPackage() on the twineElectron global when proofing a story', async () => {
			const {result} = renderHook(() => useStoryLaunch());

			expect(openWithScratchPackage).not.toHaveBeenCalled();
			await result.current.proofStory('mock-story-id');
			expect(openWithScratchPackage.mock.calls).toEqual([
				[
					'mock-proofed-story-mock-story-id',
					'proof-mock-story-id.html',
					[{outputPath: 'assets/cover.png', sourcePath: '/tmp/cover.png'}]
				]
			]);
		});

		it('throws an error when proofing a story if the twineElectron global is not present', () => {
			delete (window as any).twineElectron;

			expect(() => renderHook(() => useStoryLaunch())).toThrow(
				'Electron bridge is not present on window.'
			);
		});

		it('calls openWithScratchPackage() on the twineElectron global when testing a story', async () => {
			const {result} = renderHook(() => useStoryLaunch());

			expect(openWithScratchPackage).not.toHaveBeenCalled();
			await result.current.testStory('mock-story-id');
			expect(openWithScratchPackage.mock.calls).toEqual([
				[
					'mock-published-story-mock-story-id-{"buildTarget":"test","formatOptions":"debug"}',
					'test-mock-story-id.html',
					[{outputPath: 'assets/cover.png', sourcePath: '/tmp/cover.png'}]
				]
			]);
		});

		it('throws an error when testing a story if the twineElectron global is not present', () => {
			delete (window as any).twineElectron;

			expect(() => renderHook(() => useStoryLaunch())).toThrow(
				'Electron bridge is not present on window.'
			);
		});
	});
});
