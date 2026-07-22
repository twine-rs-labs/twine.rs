import {usePublishing, type ProofingFormatSelection} from './use-publishing';
import {isElectronRenderer} from '../util/is-electron';
import {TwineElectronWindow} from '../electron/shared';
import {loadProjectMetadata} from './project-metadata';
import {
	replaceKnownAssetInventoryForStory,
	type CoreAssetInventoryEntry
} from '../core';

export interface UseStoryLaunchProps {
	playStory: (storyId: string) => Promise<void>;
	proofStory: (
		storyId: string,
		proofingFormat?: ProofingFormatSelection
	) => Promise<void>;
	testStory: (storyId: string, startPassageId?: string) => Promise<void>;
}

type TwineElectronBridge = NonNullable<TwineElectronWindow['twineElectron']>;

function scratchAssetRequests(
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

	if (
		!projectRoot ||
		(!twineElectron.projectSessionSnapshot && !twineElectron.listProjectAssets)
	) {
		return {assetInventory: undefined, projectRoot: undefined};
	}

	let inventory: CoreAssetInventoryEntry[];

	try {
		const snapshot = twineElectron.projectSessionSnapshot
			? await twineElectron.projectSessionSnapshot(projectRoot)
			: undefined;

		inventory =
			snapshot?.assets ?? (await twineElectron.listProjectAssets(projectRoot));
	} catch (error) {
		console.warn('Unable to refresh project assets before preview.', error);
		return {assetInventory: undefined, projectRoot: undefined};
	}

	replaceKnownAssetInventoryForStory(storyId, inventory);
	return {assetInventory: inventory, projectRoot};
}

/**
 * Provides functions to launch a story that include the correct handling for
 * both web and Electron contexts.
 */
export function useStoryLaunch(): UseStoryLaunchProps {
	const {proofStoryPackage, publishStoryPackage} = usePublishing();

	if (isElectronRenderer()) {
		const {twineElectron} = window as TwineElectronWindow;

		if (!twineElectron) {
			throw new Error('Electron bridge is not present on window.');
		}
		const twineElectronBridge = twineElectron;

		// These are async to match the type in the browser context.
		return {
			playStory: async storyId => {
				const {assetInventory, projectRoot} = await refreshedProjectAssets(
					storyId,
					twineElectronBridge
				);
				const build = await publishStoryPackage(storyId, {
					assetInventory,
					buildTarget: 'play'
				});

				await twineElectronBridge.openWithScratchPackage(
					build.html,
					projectRoot,
					scratchAssetRequests(projectRoot, build.assets)
				);
			},
			proofStory: async (storyId, proofingFormat) => {
				const {assetInventory, projectRoot} = await refreshedProjectAssets(
					storyId,
					twineElectronBridge
				);
				const build = await proofStoryPackage(storyId, {
					assetInventory,
					proofingFormat
				});

				await twineElectronBridge.openWithScratchPackage(
					build.html,
					projectRoot,
					scratchAssetRequests(projectRoot, build.assets)
				);
			},
			testStory: async (storyId, startPassageId) => {
				const {assetInventory, projectRoot} = await refreshedProjectAssets(
					storyId,
					twineElectronBridge
				);
				const build = await publishStoryPackage(storyId, {
					assetInventory,
					buildTarget: 'test',
					formatOptions: 'debug',
					...(startPassageId
						? {startId: startPassageId, startMode: 'afterStartup' as const}
						: {startId: undefined})
				});

				await twineElectronBridge.openWithScratchPackage(
					build.html,
					projectRoot,
					scratchAssetRequests(projectRoot, build.assets)
				);
			}
		};
	}

	return {
		playStory: async storyId => {
			window.open(`#/stories/${storyId}/play`, '_blank');
		},
		proofStory: async (storyId, proofingFormat) => {
			const query = proofingFormat
				? `?${new URLSearchParams({
						proofingFormatName: proofingFormat.name,
						proofingFormatVersion: proofingFormat.version
					}).toString()}`
				: '';

			window.open(`#/stories/${storyId}/proof${query}`, '_blank');
		},
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
