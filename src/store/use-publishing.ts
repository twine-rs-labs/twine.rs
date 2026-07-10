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
import type {CoreAssetInventoryEntry, CoreAssetsPage} from '../core';
import {usePrefsContext} from './prefs';
import {
	formatWithNameAndVersion,
	loadFormatProperties,
	useStoryFormatsContext
} from './story-formats';
import {storyWithId, useStoriesContext} from './stories';
import {getAppInfo} from '../util/app-info';

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

	const loadProofFormatProperties = React.useCallback(
		async (proofingFormat?: ProofingFormatSelection) => {
			const selectedFormat = proofingFormat ?? prefs.proofingFormat;
			const format = formatWithNameAndVersion(
				formats,
				selectedFormat.name,
				selectedFormat.version
			);
			const formatProperties =
				await loadFormatProperties(format)(storyFormatsDispatch);

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
			const story = storyWithId(stories, storyId);
			const format = formatWithNameAndVersion(
				formats,
				story.storyFormat,
				story.storyFormatVersion
			);
			const formatProperties =
				await loadFormatProperties(format)(storyFormatsDispatch);

			if (!formatProperties) {
				throw new Error(`Couldn't load story format properties`);
			}

			return createStoryBuildPackage(story, getAppInfo(), {
				...publishOptions,
				assetInventory:
					publishOptions?.assetInventory ??
					(await assetInventoryForStory(storyId)),
				formatProperties,
				target
			});
		},
		[assetInventoryForStory, formats, stories, storyFormatsDispatch]
	);

	return {
		buildStoryPackage,
		publishArchive: React.useCallback(
			async storyIds =>
				publishArchive(
					storyIds
						? stories.filter(story => storyIds.includes(story.id))
						: stories,
					getAppInfo()
				),
			[stories]
		),
		proofStory: React.useCallback(
			async (storyId, proofingFormat) => {
				const story = storyWithId(stories, storyId);
				const formatProperties =
					await loadProofFormatProperties(proofingFormat);

				return createStoryBuildPackage(story, getAppInfo(), {
					assetInventory: await assetInventoryForStory(storyId),
					formatProperties,
					target: 'proof'
				}).html;
			},
			[assetInventoryForStory, loadProofFormatProperties, stories]
		),
		proofStoryPackage: React.useCallback(
			async (storyId, options) => {
				const proofOptions = normalizeProofPackageOptions(options);
				const story = storyWithId(stories, storyId);
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
				loadProofFormatProperties,
				normalizeProofPackageOptions,
				stories
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
				const story = storyWithId(stories, storyId);

				return publishStory(story, getAppInfo(), {
					assetInventory: await assetInventoryForStory(storyId),
					startOptional: true
				});
			},
			[assetInventoryForStory, stories]
		)
	};
}
