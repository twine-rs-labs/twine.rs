import {renderHook, waitFor} from '@testing-library/react';
import {useStoryLaunch} from '../use-story-launch';
import {isElectronRenderer} from '../../util/is-electron';
import {usePublishing} from '../use-publishing';
import {saveProjectMetadata} from '../project-metadata';
import {useComputedTheme} from '../prefs/use-computed-theme';
import {usePrefsContext} from '../prefs';

jest.mock('../use-publishing');
jest.mock('../../util/is-electron');
jest.mock('../prefs/use-computed-theme');
jest.mock('../prefs');
jest.mock('@lukeed/uuid', () => ({v4: () => 'bridge-id'}));

describe('useStoryLaunch', () => {
	const isElectronRendererMock = isElectronRenderer as jest.Mock;
	const usePublishingMock = usePublishing as jest.Mock;
	const useComputedThemeMock = useComputedTheme as jest.Mock;
	const usePrefsContextMock = usePrefsContext as jest.Mock;
	let buildStoryPreviewPackage: jest.Mock;
	let openSpy: jest.Mock;

	beforeEach(() => {
		window.localStorage.clear();
		useComputedThemeMock.mockReturnValue('dark');
		usePrefsContextMock.mockReturnValue({
			prefs: {highContrast: true, reducedMotion: false}
		});
		buildStoryPreviewPackage = jest.fn(
			async (storyId: string, target: string) => ({
				build: {
					assets: [
						{
							outputPath: 'assets/cover.png',
							path: 'assets/cover.png',
							sourcePath: '/tmp/cover.png'
						}
					],
					html: `<html><head></head><body><tw-storydata>${target}</tw-storydata></body></html>`,
					report: {}
				},
				revision: 7,
				story: {
					id: storyId,
					name: 'Live story',
					passages: [
						{id: 'start-id', name: 'Start'},
						{id: 'current-id', name: 'Current'}
					],
					startPassage: 'start-id'
				},
				summary: {
					assetCount: 1,
					diagnosticCount: 0,
					graph: {passages: 2},
					revision: 7,
					storyId
				}
			})
		);
		usePublishingMock.mockReturnValue({buildStoryPreviewPackage});
	});

	describe('in a browser context', () => {
		beforeEach(() => {
			openSpy = jest.fn();
			isElectronRendererMock.mockReturnValue(false);
			(window as any).open = openSpy;
		});

		it('opens Play, Proof, and Test routes without building locally', async () => {
			const {result} = renderHook(() => useStoryLaunch());

			await result.current.playStory('mock-story-id');
			await result.current.proofStory('mock-story-id', {
				name: 'Paper',
				version: '1.0.0'
			});
			await result.current.testStory('mock-story-id', 'current-id');

			expect(openSpy.mock.calls).toEqual([
				['#/stories/mock-story-id/preview?target=play', '_blank'],
				[
					'#/stories/mock-story-id/preview?target=proof&proofingFormatName=Paper&proofingFormatVersion=1.0.0',
					'_blank'
				],
				[
					'#/stories/mock-story-id/preview?target=test&passage=current-id',
					'_blank'
				]
			]);
			expect(buildStoryPreviewPackage).not.toHaveBeenCalled();
		});
	});

	describe('in an Electron context', () => {
		let openStoryPreview: jest.Mock;

		beforeEach(() => {
			openStoryPreview = jest.fn().mockResolvedValue({});
			isElectronRendererMock.mockReturnValue(true);
			(window as any).twineElectron = {openStoryPreview};
		});

		it.each([
			{
				invoke: (launch: ReturnType<typeof useStoryLaunch>) =>
					launch.playStory('mock-story-id'),
				options: {assetInventory: undefined},
				target: 'play'
			},
			{
				invoke: (launch: ReturnType<typeof useStoryLaunch>) =>
					launch.proofStory('mock-story-id', {
						name: 'Paper',
						version: '1.0.0'
					}),
				options: {
					assetInventory: undefined,
					proofingFormat: {name: 'Paper', version: '1.0.0'}
				},
				target: 'proof'
			},
			{
				invoke: (launch: ReturnType<typeof useStoryLaunch>) =>
					launch.testStory('mock-story-id', 'current-id'),
				options: {
					assetInventory: undefined,
					formatOptions: 'debug',
					startId: 'current-id',
					startMode: 'afterStartup'
				},
				target: 'test'
			}
		])(
			'builds one snapshot-matched $target package and opens a managed preview',
			async ({invoke, options, target}) => {
				const {result} = renderHook(() => useStoryLaunch());

				await invoke(result.current);

				expect(buildStoryPreviewPackage).toHaveBeenCalledTimes(1);
				expect(buildStoryPreviewPackage).toHaveBeenCalledWith(
					'mock-story-id',
					target,
					options
				);
				expect(openStoryPreview).toHaveBeenCalledTimes(1);
				expect(openStoryPreview).toHaveBeenCalledWith(
					{
						assets: [],
						descriptor: expect.objectContaining({
							appearance: {
								highContrast: true,
								reducedMotion: false,
								theme: 'dark'
							},
							bridgeSessionId: 'preview-bridge-id',
							launchPassage:
								target === 'test'
									? {id: 'current-id', name: 'Current'}
									: {id: 'start-id', name: 'Start'},
							passages: [
								{id: 'start-id', localId: '1', name: 'Start'},
								{id: 'current-id', localId: '2', name: 'Current'}
							],
							storyDataCount: 1,
							storyId: 'mock-story-id',
							storyName: 'Live story',
							target
						}),
						instrumentedHtml: expect.stringContaining('preview-bridge-id')
					},
					undefined
				);
			}
		);

		it('refreshes project assets and sends only exact logical requests', async () => {
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
				openStoryPreview,
				projectSessionSnapshot
			};

			const {result} = renderHook(() => useStoryLaunch());

			await result.current.playStory('mock-story-id');

			expect(projectSessionSnapshot).toHaveBeenCalledWith('/native/project');
			expect(buildStoryPreviewPackage).toHaveBeenCalledWith(
				'mock-story-id',
				'play',
				{assetInventory: inventory}
			);
			expect(openStoryPreview).toHaveBeenCalledWith(
				expect.objectContaining({
					assets: [{outputPath: 'assets/cover.png', path: 'assets/cover.png'}]
				}),
				'/native/project'
			);
		});

		it('reads the latest appearance after asynchronous preparation', async () => {
			const buildImplementation =
				buildStoryPreviewPackage.getMockImplementation()!;
			let finishBuild!: () => void;

			buildStoryPreviewPackage.mockImplementationOnce(
				(storyId: string, target: string) =>
					new Promise(resolve => {
						finishBuild = () => {
							void Promise.resolve(buildImplementation(storyId, target)).then(
								resolve
							);
						};
					})
			);
			const {rerender, result} = renderHook(() => useStoryLaunch());
			const launch = result.current.playStory('mock-story-id');

			await waitFor(() =>
				expect(buildStoryPreviewPackage).toHaveBeenCalledTimes(1)
			);
			useComputedThemeMock.mockReturnValue('light');
			usePrefsContextMock.mockReturnValue({
				prefs: {highContrast: false, reducedMotion: true}
			});
			rerender();
			finishBuild();
			await launch;

			expect(openStoryPreview).toHaveBeenCalledWith(
				expect.objectContaining({
					descriptor: expect.objectContaining({
						appearance: {
							highContrast: false,
							reducedMotion: true,
							theme: 'light'
						}
					})
				}),
				undefined
			);
		});

		it('fails actionably instead of dropping a known project asset root', async () => {
			saveProjectMetadata('mock-story-id', {
				rootPath: '/native/project',
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});

			const {result} = renderHook(() => useStoryLaunch());

			await expect(result.current.playStory('mock-story-id')).rejects.toThrow(
				'Project assets cannot be refreshed'
			);
			expect(openStoryPreview).not.toHaveBeenCalled();
		});

		it('throws during render when the managed bridge is absent', () => {
			delete (window as any).twineElectron;

			expect(() => renderHook(() => useStoryLaunch())).toThrow(
				'Managed Electron story previews are unavailable.'
			);
		});
	});
});
