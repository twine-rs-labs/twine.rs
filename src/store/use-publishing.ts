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
import {type CoreProjectHost, useCoreProjectHost} from '../core/project-host';
import {
	materializeStoryFromSession,
	materializeStorySnapshotFromSession
} from '../core/materialize-story';
import type {
	CoreAssetInventoryEntry,
	CoreAssetsPage,
	CoreStorySummary
} from '../core';
import {usePrefsContext} from './prefs';
import {
	formatWithNameAndVersion,
	loadFormatProperties,
	useStoryFormatsContext
} from './story-formats';
import {
	type Story,
	StoryWithDocuments,
	storyWithId,
	useStoriesContext
} from './stories';
import {getAppInfo} from '../util/app-info';
import {
	externalAssetEmbeddingReport,
	inlineReferencedAssets,
	type AssetEmbeddingReport
} from '../util/inline-assets';
import {loadProjectMetadata} from './project-metadata';
import {projectStoryHydration} from './project-hydration';
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

export type BuildStoryPreviewPackageOptions = PublishOptions & {
	assetInventory?: CoreAssetInventoryEntry[];
	proofingFormat?: ProofingFormatSelection;
};

export interface StoryPreviewBuild {
	build: StoryBuildPackage;
	revision: number;
	story: StoryWithDocuments;
	summary: CoreStorySummary;
}

interface RevisionedStoryMetadata {
	revision: number;
	story: Story;
}

export function currentStoryPreviewMetadata(
	coreProjectHost: CoreProjectHost,
	stories: Story[],
	storyId: string
): RevisionedStoryMetadata {
	return {
		revision: coreProjectHost.sessionStatus(storyId).revision,
		story: storyWithId(stories, storyId)
	};
}

export async function materializeStoryPreviewSnapshot(
	coreProjectHost: CoreProjectHost,
	storyId: string,
	currentMetadata: () => RevisionedStoryMetadata
) {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const metadata = currentMetadata();
		const snapshot = await materializeStorySnapshotFromSession(
			coreProjectHost,
			metadata.story
		);
		const summary = await coreProjectHost.queryStorySummaryAsync(storyId);
		const latestMetadata = currentMetadata();

		if (
			snapshot.revision === metadata.revision &&
			summary.revision === metadata.revision &&
			coreProjectHost.sessionStatus(storyId).revision === metadata.revision &&
			latestMetadata.revision === metadata.revision &&
			latestMetadata.story === metadata.story
		) {
			return {...snapshot, summary};
		}
	}

	throw new Error(
		'The story changed while its preview metadata was being prepared.'
	);
}

export interface UsePublishingProps {
	materializeStory: (storyId: string) => Promise<StoryWithDocuments>;
	buildStoryPackage: (
		storyId: string,
		target: StoryBuildTarget,
		publishOptions?: Omit<BuildStoryPackageOptions, 'buildTarget'>
	) => Promise<StoryBuildPackage>;
	buildStoryPreviewPackage: (
		storyId: string,
		target: Extract<StoryBuildTarget, 'play' | 'proof' | 'test'>,
		options?: BuildStoryPreviewPackageOptions
	) => Promise<StoryPreviewBuild>;
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
	const previewMetadataRef = React.useRef(stories);

	previewMetadataRef.current = stories;

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

	const completeStorySnapshotForPreview = React.useCallback(
		(storyId: string) =>
			materializeStoryPreviewSnapshot(coreProjectHost, storyId, () =>
				currentStoryPreviewMetadata(
					coreProjectHost,
					previewMetadataRef.current,
					storyId
				)
			),
		[coreProjectHost]
	);

	const hydrateArchiveStories = React.useCallback(async (selected: Story[]) => {
		const bridge = (window as TwineElectronWindow).twineElectron;
		const storiesByRoot = new Map<string, Story[]>();

		for (const story of selected) {
			const metadata = loadProjectMetadata(story.id);

			if (
				metadata?.storageKind === 'electron-project-folder' &&
				metadata.status === 'file-backed' &&
				metadata.rootPath &&
				projectStoryHydration(story.id)?.passageTextLoaded === false
			) {
				storiesByRoot.set(metadata.rootPath, [
					...(storiesByRoot.get(metadata.rootPath) ?? []),
					story
				]);
			}
		}

		if (storiesByRoot.size === 0) {
			return new Map<string, StoryWithDocuments>();
		}
		if (!bridge?.hydrateProjectFolder) {
			throw new Error(
				'The desktop project-folder hydration bridge is unavailable.'
			);
		}

		const hydratedById = new Map<string, StoryWithDocuments>();

		// Hydrate roots serially. A library archive already retains the complete
		// output, so avoiding several simultaneous full-folder reads keeps its
		// transient memory bounded.
		for (const [rootPath, rootStories] of storiesByRoot) {
			const result = await bridge.hydrateProjectFolder(
				rootPath,
				rootStories.map(story => story.id)
			);

			for (const story of result.stories) {
				hydratedById.set(story.id, story);
			}
			for (const story of rootStories) {
				if (!hydratedById.has(story.id)) {
					throw new Error(
						`Project folder hydration did not return story ${story.id}.`
					);
				}
			}
		}

		return hydratedById;
	}, []);

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

	const buildStoryPreviewPackage = React.useCallback(
		async (
			storyId: string,
			target: Extract<StoryBuildTarget, 'play' | 'proof' | 'test'>,
			options: BuildStoryPreviewPackageOptions = {}
		): Promise<StoryPreviewBuild> => {
			const {assetInventory, proofingFormat, ...publishOptions} = options;
			const snapshot = await completeStorySnapshotForPreview(storyId);
			const inventory =
				assetInventory ?? (await assetInventoryForStory(storyId));
			const formatProperties =
				target === 'proof'
					? await loadProofFormatProperties(proofingFormat)
					: await storyFormatsDispatch(
							loadFormatProperties(
								formatWithNameAndVersion(
									formats,
									snapshot.story.storyFormat,
									snapshot.story.storyFormatVersion
								)
							)
						);

			if (!formatProperties) {
				throw new Error(`Couldn't load story format properties`);
			}

			return {
				build: createStoryBuildPackage(snapshot.story, getAppInfo(), {
					...publishOptions,
					assetInventory: inventory,
					formatProperties,
					target
				}),
				revision: snapshot.revision,
				story: snapshot.story,
				summary: snapshot.summary
			};
		},
		[
			assetInventoryForStory,
			completeStorySnapshotForPreview,
			formats,
			loadProofFormatProperties,
			storyFormatsDispatch
		]
	);

	return {
		materializeStory: completeStoryForPublishing,
		buildStoryPackage,
		buildStoryPreviewPackage,
		publishArchive: React.useCallback(
			async storyIds => {
				const selected = storyIds
					? stories.filter(story => storyIds.includes(story.id))
					: stories;
				const hydratedById = await hydrateArchiveStories(selected);

				return publishArchive(
					await Promise.all(
						selected.map(
							story =>
								hydratedById.get(story.id) ??
								completeStoryForPublishing(story.id)
						)
					),
					getAppInfo()
				);
			},
			[completeStoryForPublishing, hydrateArchiveStories, stories]
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
