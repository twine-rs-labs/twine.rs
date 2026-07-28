import * as React from 'react';
import {v4 as uuid} from '@lukeed/uuid';
import {usePublishing, type ProofingFormatSelection} from './use-publishing';
import {isElectronRenderer} from '../util/is-electron';
import type {
	NativeStoryPreviewLaunchRequest,
	NativeStoryPreviewTarget,
	TwineElectronWindow
} from '../electron/shared';
import {loadProjectMetadata} from './project-metadata';
import {
	replaceKnownAssetInventoryForStory,
	type CoreAssetInventoryEntry
} from '../core';
import {
	instrumentPreviewHtml,
	storyPreviewPassages
} from '../routes/story-preview-contract';
import {usePrefsContext} from './prefs';
import {useComputedTheme} from './prefs/use-computed-theme';
import type {StoryBuildPackage} from '../util/build-package';

export interface UseStoryLaunchProps {
	playStory: (storyId: string) => Promise<void>;
	playStoryWithBuild: (
		storyId: string
	) => Promise<StoryBuildPackage | undefined>;
	proofStory: (
		storyId: string,
		proofingFormat?: ProofingFormatSelection
	) => Promise<void>;
	proofStoryWithBuild: (
		storyId: string,
		proofingFormat?: ProofingFormatSelection
	) => Promise<StoryBuildPackage | undefined>;
	testStory: (storyId: string, startPassageId?: string) => Promise<void>;
}

export interface PreparedNativeStoryPreview {
	build: StoryBuildPackage;
	projectRoot?: string;
	request: NativeStoryPreviewLaunchRequest;
}

type TwineElectronBridge = NonNullable<TwineElectronWindow['twineElectron']>;

function previewAssetRequests(
	projectRoot: string | undefined,
	assets: Array<{outputPath: string; path: string; sourcePath: string | null}>
) {
	return projectRoot
		? assets
				.filter(asset => asset.sourcePath !== null)
				.map(({outputPath, path}) => ({outputPath, path}))
		: [];
}

async function refreshedProjectAssets(
	storyId: string,
	twineElectron: TwineElectronBridge
) {
	const projectRoot = loadProjectMetadata(storyId)?.rootPath;

	if (!projectRoot) {
		return {assetInventory: undefined, projectRoot: undefined};
	}
	if (
		!twineElectron.projectSessionSnapshot &&
		!twineElectron.listProjectAssets
	) {
		throw new Error(
			'Project assets cannot be refreshed before opening this preview.'
		);
	}

	let inventory: CoreAssetInventoryEntry[];

	try {
		const snapshot = twineElectron.projectSessionSnapshot
			? await twineElectron.projectSessionSnapshot(projectRoot)
			: undefined;

		inventory =
			snapshot?.assets ?? (await twineElectron.listProjectAssets(projectRoot));
	} catch (error) {
		throw new Error('Project assets could not be refreshed before preview.', {
			cause: error
		});
	}

	replaceKnownAssetInventoryForStory(storyId, inventory);
	return {assetInventory: inventory, projectRoot};
}

/**
 * Prepares desktop Play/Test/Proof from one immutable live-session snapshot.
 * The returned descriptor and passage map always describe the HTML that was
 * built, rather than a later React render.
 */
export function useNativeStoryPreviewPreparation() {
	const {buildStoryPreviewPackage} = usePublishing();
	const computedTheme = useComputedTheme();
	const {prefs} = usePrefsContext();
	const appearanceRef = React.useRef({
		highContrast: prefs.highContrast,
		reducedMotion: prefs.reducedMotion,
		theme: computedTheme
	});

	appearanceRef.current = {
		highContrast: prefs.highContrast,
		reducedMotion: prefs.reducedMotion,
		theme: computedTheme
	};

	return React.useCallback(
		async (
			storyId: string,
			target: NativeStoryPreviewTarget,
			options: {
				proofingFormat?: ProofingFormatSelection;
				startPassageId?: string;
			} = {}
		): Promise<PreparedNativeStoryPreview> => {
			const twineElectron = (window as TwineElectronWindow).twineElectron;

			if (!twineElectron) {
				throw new Error('Electron bridge is not present on window.');
			}

			const {assetInventory, projectRoot} = await refreshedProjectAssets(
				storyId,
				twineElectron
			);
			const preview = await buildStoryPreviewPackage(storyId, target, {
				assetInventory,
				...(target === 'proof'
					? {proofingFormat: options.proofingFormat}
					: undefined),
				...(target === 'test'
					? {
							formatOptions: 'debug',
							...(options.startPassageId
								? {
										startId: options.startPassageId,
										startMode: 'afterStartup' as const
									}
								: {startId: undefined})
						}
					: undefined)
			});
			const bridgeSessionId = `preview-${uuid()}`;
			const launchPassageId =
				options.startPassageId ?? preview.story.startPassage;
			const launchPassage = preview.story.passages.find(
				passage => passage.id === launchPassageId
			);
			const htmlBytes = new Blob([preview.build.html]).size;

			return {
				build: preview.build,
				projectRoot,
				request: {
					assets: previewAssetRequests(projectRoot, preview.build.assets),
					descriptor: {
						appearance: {...appearanceRef.current},
						bridgeSessionId,
						htmlBytes,
						launchPassage: launchPassage
							? {id: launchPassage.id, name: launchPassage.name}
							: undefined,
						passages: storyPreviewPassages(preview.story),
						storyDataCount:
							preview.build.html.match(/<tw-storydata\b/g)?.length ?? 0,
						storyId: preview.story.id,
						storyName: preview.story.name,
						summary: preview.summary,
						target
					},
					instrumentedHtml: instrumentPreviewHtml(
						preview.build.html,
						bridgeSessionId
					)
				}
			};
		},
		[buildStoryPreviewPackage, appearanceRef]
	);
}

/**
 * Provides functions to launch a story that include the correct handling for
 * both web and Electron contexts.
 */
export function useStoryLaunch(): UseStoryLaunchProps {
	const prepareNativePreview = useNativeStoryPreviewPreparation();

	if (isElectronRenderer()) {
		const {twineElectron} = window as TwineElectronWindow;

		if (!twineElectron?.openStoryPreview) {
			throw new Error('Managed Electron story previews are unavailable.');
		}

		const playStoryWithBuild = async (storyId: string) => {
			const prepared = await prepareNativePreview(storyId, 'play');

			await twineElectron.openStoryPreview(
				prepared.request,
				prepared.projectRoot
			);
			return prepared.build;
		};
		const proofStoryWithBuild = async (
			storyId: string,
			proofingFormat?: ProofingFormatSelection
		) => {
			const prepared = await prepareNativePreview(storyId, 'proof', {
				proofingFormat
			});

			await twineElectron.openStoryPreview(
				prepared.request,
				prepared.projectRoot
			);
			return prepared.build;
		};

		return {
			playStory: async storyId => {
				await playStoryWithBuild(storyId);
			},
			playStoryWithBuild,
			proofStory: async (storyId, proofingFormat) => {
				await proofStoryWithBuild(storyId, proofingFormat);
			},
			proofStoryWithBuild,
			testStory: async (storyId, startPassageId) => {
				const prepared = await prepareNativePreview(storyId, 'test', {
					startPassageId
				});

				await twineElectron.openStoryPreview(
					prepared.request,
					prepared.projectRoot
				);
			}
		};
	}

	const playStoryWithBuild = async (storyId: string) => {
		window.open(`#/stories/${storyId}/play`, '_blank');
		return undefined;
	};
	const proofStoryWithBuild = async (
		storyId: string,
		proofingFormat?: ProofingFormatSelection
	) => {
		const query = proofingFormat
			? `?${new URLSearchParams({
					proofingFormatName: proofingFormat.name,
					proofingFormatVersion: proofingFormat.version
				}).toString()}`
			: '';

		window.open(`#/stories/${storyId}/proof${query}`, '_blank');
		return undefined;
	};

	return {
		playStory: async storyId => {
			await playStoryWithBuild(storyId);
		},
		playStoryWithBuild,
		proofStory: async (storyId, proofingFormat) => {
			await proofStoryWithBuild(storyId, proofingFormat);
		},
		proofStoryWithBuild,
		testStory: async (storyId, startPassageId) => {
			window.open(
				startPassageId
					? `#/stories/${storyId}/test/${startPassageId}`
					: `#/stories/${storyId}/test`,
				'_blank'
			);
		}
	};
}
