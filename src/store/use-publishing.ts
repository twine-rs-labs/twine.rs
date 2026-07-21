import * as React from 'react';
import {
	publishArchive,
	publishStory,
	type PublishOptions
} from '../util/publish';
import {
	createStoryBuildPackage,
	type StoryBuildPackage,
	type StoryHtmlBuildTarget,
	type StoryBuildTarget
} from '../util/build-package';
import {useCoreProjectHost} from '../core/project-host';
import {materializeStoryFromSession} from '../core/materialize-story';
import type {CoreAssetInventoryEntry, CoreAssetsPage} from '../core';
import {usePrefsContext} from './prefs';
import {
	formatWithNameAndVersion,
	loadFormatProperties,
	useStoryFormatsContext
} from './story-formats';
import {StoryWithDocuments, storyWithId, useStoriesContext} from './stories';
import {getAppInfo} from '../util/app-info';
import {
	externalAssetEmbeddingReport,
	inlineReferencedAssets,
	type AssetEmbeddingReport
} from '../util/inline-assets';
import {loadProjectMetadata} from './project-metadata';
import type {TwineElectronWindow} from '../electron/shared';

export const referencedMediaEmbeddingLimits = {
	maxFileBytes: 25 * 1024 * 1024,
	maxFileCount: 25,
	maxTotalEncodedBytes: 25 * 1024 * 1024
} as const;

export type PublishStoryOptions = PublishOptions & {
	buildTarget?: StoryHtmlBuildTarget;
};

export type BuildStoryPackageOptions = PublishOptions & {
	buildTarget?: StoryBuildTarget;
	htmlCompatibility?: boolean;
	jsonPretty?: boolean;
};

export interface ProofingFormatSelection {
	name: string;
	version: string;
}

export type ProofStoryPackageOptions =
	| CoreAssetInventoryEntry[]
	| {
			assetInventory?: CoreAssetInventoryEntry[];
			proofingFormat?: ProofingFormatSelection;
	  };

export interface UsePublishingProps {
	materializeStory: (storyId: string) => Promise<StoryWithDocuments>;
	buildStoryPackage: (
		storyId: string,
		target: StoryBuildTarget,
		publishOptions?: Omit<BuildStoryPackageOptions, 'buildTarget'>
	) => Promise<StoryBuildPackage>;
	proofStoryPackage: (
		storyId: string,
		options?: ProofStoryPackageOptions
	) => Promise<StoryBuildPackage>;
	proofStory: (
		storyId: string,
		proofingFormat?: ProofingFormatSelection
	) => Promise<string>;
	publishArchive: (storyIds?: string[]) => Promise<string>;
	publishStoryPackage: (
		storyId: string,
		publishOptions?: BuildStoryPackageOptions
	) => Promise<StoryBuildPackage>;
	publishStory: (
		storyId: string,
		publishOptions?: PublishStoryOptions
	) => Promise<string>;
	publishStoryData: (storyId: string) => Promise<string>;
}

/**
 * A React hook to publish stories from context. You probably want to use
 * `useStoryLaunch` instead--this is for doing the actual binding of the story
 * and story format.
 */
export function usePublishing(): UsePublishingProps {
	// As little logic as possible should live here--instead it should be in
	// util/publish.ts.

	const {prefs} = usePrefsContext();
	const {dispatch: storyFormatsDispatch, formats} = useStoryFormatsContext();
	const {stories} = useStoriesContext();
	const coreProjectHost = useCoreProjectHost();

	const assetInventoryForStory = React.useCallback(
		async (storyId: string) => {
			const inventory: CoreAssetInventoryEntry[] = [];
			let cursor: string | null = null;

			do {
				const page: CoreAssetsPage = await coreProjectHost.queryAssetsPageAsync(
					storyId,
					{
						cursor,
						limit: 250
					}
				);

				inventory.push(...page.assets);
				cursor = page.nextCursor;
			} while (cursor);

			return inventory;
		},
		[coreProjectHost]
	);

	const completeStoryForPublishing = React.useCallback(
		async (storyId: string) => {
			const story = storyWithId(stories, storyId);

			return materializeStoryFromSession(coreProjectHost, story);
		},
		[coreProjectHost, stories]
	);

	const loadProofFormatProperties = React.useCallback(
		async (proofingFormat?: ProofingFormatSelection) => {
			const selectedFormat = proofingFormat ?? prefs.proofingFormat;
			const format = formatWithNameAndVersion(
				formats,
				selectedFormat.name,
				selectedFormat.version
			);
			const formatProperties = await storyFormatsDispatch(
				loadFormatProperties(format)
			);

			if (!formatProperties) {
				throw new Error(`Couldn't load story format properties`);
			}

			return formatProperties;
		},
		[
			formats,
			prefs.proofingFormat.name,
			prefs.proofingFormat.version,
			storyFormatsDispatch
		]
	);

	const normalizeProofPackageOptions = React.useCallback(
		(options?: ProofStoryPackageOptions) =>
			Array.isArray(options) ? {assetInventory: options} : (options ?? {}),
		[]
	);

	const buildStoryPackage = React.useCallback(
		async (
			storyId: string,
			target: StoryBuildTarget,
			publishOptions?: Omit<BuildStoryPackageOptions, 'buildTarget'>
		) => {
			const story = await completeStoryForPublishing(storyId);
			const assetInventory =
				publishOptions?.assetInventory ??
				(await assetInventoryForStory(storyId));
			const assetMode = publishOptions?.assetMode ?? 'external';
			let storyForBuild = story;
			let assetEmbeddingReport: AssetEmbeddingReport =
				externalAssetEmbeddingReport(assetInventory);

			if (assetMode === 'inline-referenced') {
				if (target !== 'export-html' && target !== 'publish') {
					throw new Error(
						'Referenced media embedding is available only for Playable HTML export.'
					);
				}

				const metadata = loadProjectMetadata(storyId);
				const rootPath =
					metadata?.storageKind === 'electron-project-folder' &&
					metadata.status === 'file-backed'
						? metadata.rootPath
						: undefined;
				const bridge = (window as TwineElectronWindow).twineElectron;

				if (!rootPath || !bridge?.readProjectAssetPayloads) {
					throw new Error(
						'Referenced media embedding requires a file-backed project in the desktop app.'
					);
				}

				const referencedAssets = assetInventory.filter(
					asset => asset.referenceCount > 0
				);
				const supportedAssets = referencedAssets.filter(asset =>
					['image', 'audio', 'video'].includes(asset.kind)
				);
				const requestedAssets = supportedAssets.slice(
					0,
					referencedMediaEmbeddingLimits.maxFileCount
				);
				const localFailures = [
					...referencedAssets
						.filter(asset => !['image', 'audio', 'video'].includes(asset.kind))
						.map(asset => ({
							message: `Asset type "${asset.kind}" is not supported for media embedding.`,
							path: asset.path,
							reason: 'unsupported-type'
						})),
					...supportedAssets
						.slice(referencedMediaEmbeddingLimits.maxFileCount)
						.map(asset => ({
							message: `Embedding would exceed the ${referencedMediaEmbeddingLimits.maxFileCount}-file limit.`,
							path: asset.path,
							reason: 'file-count-exceeded'
						}))
				];
				const loaded = await bridge.readProjectAssetPayloads(
					rootPath,
					requestedAssets.map(asset => asset.path),
					referencedMediaEmbeddingLimits
				);
				const transformed = inlineReferencedAssets({
					assetInventory,
					failures: [...localFailures, ...loaded.failures].map(failure => ({
						path: failure.path,
						reason: failure.message,
						type:
							failure.reason === 'unsupported-type'
								? 'unsupported'
								: 'unavailable'
					})),
					payloads: loaded.payloads,
					policy: {
						maxFileEncodedBytes: referencedMediaEmbeddingLimits.maxFileBytes,
						maxFileCount: referencedMediaEmbeddingLimits.maxFileCount,
						maxTotalEncodedBytes:
							referencedMediaEmbeddingLimits.maxTotalEncodedBytes
					},
					story
				});

				storyForBuild = transformed.story;
				assetEmbeddingReport = transformed.report;
			}
			const format = formatWithNameAndVersion(
				formats,
				story.storyFormat,
				story.storyFormatVersion
			);
			const formatProperties = await storyFormatsDispatch(
				loadFormatProperties(format)
			);

			if (!formatProperties) {
				throw new Error(`Couldn't load story format properties`);
			}

			return createStoryBuildPackage(storyForBuild, getAppInfo(), {
				...publishOptions,
				assetEmbeddingReport,
				assetInventory,
				assetMode,
				formatProperties,
				target
			});
		},
		[
			assetInventoryForStory,
			completeStoryForPublishing,
			formats,
			storyFormatsDispatch
		]
	);

	return {
		materializeStory: completeStoryForPublishing,
		buildStoryPackage,
		publishArchive: React.useCallback(
			async storyIds => {
				const selected = storyIds
					? stories.filter(story => storyIds.includes(story.id))
					: stories;
				return publishArchive(
					await Promise.all(
						selected.map(story => completeStoryForPublishing(story.id))
					),
					getAppInfo()
				);
			},
			[completeStoryForPublishing, stories]
		),
		proofStory: React.useCallback(
			async (storyId, proofingFormat) => {
				const story = await completeStoryForPublishing(storyId);
				const formatProperties =
					await loadProofFormatProperties(proofingFormat);

				return createStoryBuildPackage(story, getAppInfo(), {
					assetInventory: await assetInventoryForStory(storyId),
					formatProperties,
					target: 'proof'
				}).html;
			},
			[
				assetInventoryForStory,
				completeStoryForPublishing,
				loadProofFormatProperties
			]
		),
		proofStoryPackage: React.useCallback(
			async (storyId, options) => {
				const proofOptions = normalizeProofPackageOptions(options);
				const story = await completeStoryForPublishing(storyId);
				const formatProperties = await loadProofFormatProperties(
					proofOptions.proofingFormat
				);

				return createStoryBuildPackage(story, getAppInfo(), {
					assetInventory:
						proofOptions.assetInventory ??
						(await assetInventoryForStory(storyId)),
					formatProperties,
					target: 'proof'
				});
			},
			[
				assetInventoryForStory,
				completeStoryForPublishing,
				loadProofFormatProperties,
				normalizeProofPackageOptions
			]
		),
		publishStory: React.useCallback(
			async (storyId, publishOptions) => {
				const {buildTarget = 'play', ...htmlOptions} = publishOptions ?? {};

				return (await buildStoryPackage(storyId, buildTarget, htmlOptions))
					.html;
			},
			[buildStoryPackage]
		),
		publishStoryPackage: React.useCallback(
			async (storyId, publishOptions) => {
				const {buildTarget = 'play', ...htmlOptions} = publishOptions ?? {};

				return buildStoryPackage(storyId, buildTarget, htmlOptions);
			},
			[buildStoryPackage]
		),
		publishStoryData: React.useCallback(
			async (storyId: string) => {
				const story = await completeStoryForPublishing(storyId);

				return publishStory(story, getAppInfo(), {
					assetInventory: await assetInventoryForStory(storyId),
					startOptional: true
				});
			},
			[assetInventoryForStory, completeStoryForPublishing]
		)
	};
}
