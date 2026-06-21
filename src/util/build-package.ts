import type {CoreAssetInventoryEntry} from '../core/bindings/CoreAssetInventoryEntry';
import type {StoryFormatProperties} from '../store/story-formats';
import type {Story} from '../store/stories';
import type {AppInfo} from './app-info';
import type {PublishOptions} from './publish';
import {publishStoryWithFormat} from './publish';
import {storyToTwee} from './twee';
import {
	inspectStoryFormatPublishSafety,
	storyFormatCapabilities,
	type StoryFormatCapabilityManifest,
	type StoryFormatPublishSafetyIssue
} from './story-format';

export type StoryBuildTarget =
	| 'play'
	| 'test'
	| 'proof'
	| 'publish'
	| 'export-html'
	| 'export-json'
	| 'export-twee'
	| 'package';

export type StoryHtmlBuildTarget =
	| 'play'
	| 'test'
	| 'proof'
	| 'publish'
	| 'export-html';

export type StoryBuildOutputKind =
	| 'html'
	| 'json'
	| 'package-manifest'
	| 'twee';

export type StoryBuildOutputRole = 'manifest' | 'primary' | 'supporting';

export interface StoryBuildAsset {
	kind: string;
	outputPath: string;
	path: string;
	sizeBytes: number | null;
	sourcePath: string | null;
	sourceUrl: string | null;
}

export interface StoryBuildOutput {
	filename: string;
	kind: StoryBuildOutputKind;
	mediaType: string;
	role: StoryBuildOutputRole;
	sizeBytes: number;
	target: StoryBuildTarget;
}

export interface StoryBuildFile extends StoryBuildOutput {
	contents: string;
}

export interface StoryBuildFidelityReport {
	omits: string[];
	preserves: string[];
}

export interface StoryBuildReport {
	assetCount: number;
	capabilities: StoryFormatCapabilityManifest;
	copiedAssetCount: number;
	fidelity: StoryBuildFidelityReport;
	generatedAt: string;
	missingAssets: string[];
	outputCount: number;
	outputs: StoryBuildOutput[];
	publishSafe: boolean;
	safetyIssues: StoryFormatPublishSafetyIssue[];
	target: StoryBuildTarget;
}

export interface StoryBuildPackage {
	assets: StoryBuildAsset[];
	files: StoryBuildFile[];
	html: string;
	report: StoryBuildReport;
}

export interface StoryBuildPackageOptions extends PublishOptions {
	formatProperties: StoryFormatProperties;
	target: StoryBuildTarget;
}

function hasUrlScheme(path: string) {
	return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path);
}

export function safeBuildAssetOutputPath(path: string) {
	const normalized = path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
	const segments = normalized.split('/').filter(segment => segment.length > 0);

	if (
		normalized.startsWith('/') ||
		hasUrlScheme(normalized) ||
		segments.length === 0 ||
		segments.some(segment => segment === '.' || segment === '..')
	) {
		throw new Error(`Unsafe asset output path "${path}".`);
	}

	return segments.join('/');
}

export function filePathFromFileUrl(url: string | null | undefined) {
	if (!url?.toLowerCase().startsWith('file:')) {
		return null;
	}

	try {
		const parsed = new URL(url);
		const pathname = decodeURIComponent(parsed.pathname);

		if (/^\/[A-Za-z]:\//.test(pathname)) {
			return pathname.slice(1);
		}

		return pathname;
	} catch {
		return null;
	}
}

function storyFilename(story: Story, extension: string) {
	const baseName = story.name.replace(/[^\w. -]/g, '_').trim() || 'Story';

	return `${baseName}${extension}`;
}

function byteLength(source: string) {
	return new Blob([source]).size;
}

function outputDescriptor(
	target: StoryBuildTarget,
	kind: StoryBuildOutputKind,
	role: StoryBuildOutputRole,
	filename: string,
	mediaType: string,
	contents: string
): StoryBuildFile {
	return {
		contents,
		filename,
		kind,
		mediaType,
		role,
		sizeBytes: byteLength(contents),
		target
	};
}

function storyToJson(story: Story) {
	return JSON.stringify(story, null, 2);
}

function shouldRenderHtml(target: StoryBuildTarget) {
	return target !== 'export-json' && target !== 'export-twee';
}

function publishOptionsForTarget(
	target: StoryBuildTarget,
	publishOptions: PublishOptions
) {
	if (target === 'package') {
		return {...publishOptions, startOptional: true};
	}

	return publishOptions;
}

function targetFidelity(target: StoryBuildTarget): StoryBuildFidelityReport {
	switch (target) {
		case 'export-json':
			return {
				omits: [
					'asset binaries',
					'story format runtime bundle',
					'future project-folder sidecars outside the current web store model'
				],
				preserves: [
					'current story store fields',
					'passages and layout positions',
					'story tags, tag colors, format, IFID, JavaScript, and CSS'
				]
			};

		case 'export-twee':
			return {
				omits: [
					'asset binaries',
					'runtime HTML',
					'editor selection/highlight state',
					'future graph groups, collapsed state, hierarchy, and workspace views'
				],
				preserves: [
					'StoryTitle and StoryData',
					'passage text, tags, and positions',
					'story IFID, format, start passage, tag colors, zoom, JavaScript, and CSS'
				]
			};

		case 'package':
			return {
				omits: [
					'asset file bytes when no file-backed source path is available',
					'future project-folder sidecars outside the current web store model'
				],
				preserves: [
					'HTML, JSON, and Twee compatibility outputs',
					'asset copy plan',
					'capability manifest and publish-safety report'
				]
			};

		default:
			return {
				omits: [
					'asset binaries, except through the asset copy plan',
					'editor selection/highlight state',
					'future graph groups, collapsed state, hierarchy, and workspace views'
				],
				preserves: [
					'standard Twine story data',
					'passage text, tags, and positions',
					'story IFID, format, start passage, tag colors, JavaScript, and CSS'
				]
			};
	}
}

function reportOutputs(files: StoryBuildFile[]): StoryBuildOutput[] {
	return files.map(file => ({
		filename: file.filename,
		kind: file.kind,
		mediaType: file.mediaType,
		role: file.role,
		sizeBytes: file.sizeBytes,
		target: file.target
	}));
}

function packageManifest(
	story: Story,
	generatedAt: string,
	files: StoryBuildFile[],
	assets: StoryBuildAsset[]
) {
	return JSON.stringify(
		{
			type: 'twine.rs/story-build-package',
			version: 1,
			generatedAt,
			story: {
				format: story.storyFormat,
				formatVersion: story.storyFormatVersion,
				id: story.id,
				ifid: story.ifid,
				name: story.name
			},
			files: reportOutputs(files),
			assets
		},
		null,
		2
	);
}

function buildOutputFiles(
	story: Story,
	target: StoryBuildTarget,
	html: string,
	generatedAt: string,
	assets: StoryBuildAsset[]
) {
	const htmlFile =
		html.trim() !== ''
			? outputDescriptor(
					target,
					'html',
					target === 'package' ? 'supporting' : 'primary',
					storyFilename(story, '.html'),
					'text/html;charset=utf-8',
					html
				)
			: undefined;
	const jsonFile = outputDescriptor(
		target,
		'json',
		target === 'export-json' ? 'primary' : 'supporting',
		storyFilename(story, '.json'),
		'application/json;charset=utf-8',
		storyToJson(story)
	);
	const tweeFile = outputDescriptor(
		target,
		'twee',
		target === 'export-twee' ? 'primary' : 'supporting',
		storyFilename(story, '.twee'),
		'text/plain;charset=utf-8',
		storyToTwee(story)
	);

	switch (target) {
		case 'export-json':
			return [jsonFile];

		case 'export-twee':
			return [tweeFile];

		case 'package': {
			const packageFiles = [htmlFile, jsonFile, tweeFile].filter(
				(file): file is StoryBuildFile => !!file
			);
			const manifest = outputDescriptor(
				target,
				'package-manifest',
				'manifest',
				storyFilename(story, '.twine-package.json'),
				'application/json;charset=utf-8',
				packageManifest(story, generatedAt, packageFiles, assets)
			);

			return [manifest, ...packageFiles];
		}

		default:
			return htmlFile ? [htmlFile] : [];
	}
}

export function buildAssetCopyPlan(
	assetInventory: CoreAssetInventoryEntry[] = []
): StoryBuildAsset[] {
	return assetInventory
		.filter(
			asset => asset.publish.copy && asset.exists !== false && !asset.missing
		)
		.map(asset => {
			const sourceUrl = asset.previewUrl ?? asset.thumbnailUrl ?? null;

			return {
				kind: asset.kind,
				outputPath: safeBuildAssetOutputPath(
					asset.publish.outputPath || asset.path
				),
				path: asset.path,
				sizeBytes: asset.sizeBytes,
				sourcePath: filePathFromFileUrl(sourceUrl),
				sourceUrl
			};
		});
}

function assertPublishSafety(
	target: StoryBuildTarget,
	issues: StoryFormatPublishSafetyIssue[]
) {
	const publishBoundTargets: StoryBuildTarget[] = [
		'publish',
		'export-html',
		'package'
	];

	if (!publishBoundTargets.includes(target)) {
		return;
	}

	const errors = issues.filter(issue => issue.severity === 'error');

	if (errors.length > 0) {
		throw new Error(
			`Cannot publish because the story format bundle is not publish-safe: ${errors
				.map(issue => issue.message)
				.join(' ')}`
		);
	}
}

export function createStoryBuildPackage(
	story: Story,
	appInfo: AppInfo,
	options: StoryBuildPackageOptions
): StoryBuildPackage {
	const {formatProperties, target, ...publishOptions} = options;
	const safety = inspectStoryFormatPublishSafety(formatProperties);
	const generatedAt = new Date().toISOString();

	assertPublishSafety(target, safety.issues);

	const assets = buildAssetCopyPlan(publishOptions.assetInventory);
	const html = shouldRenderHtml(target)
		? publishStoryWithFormat(
				story,
				formatProperties.source,
				appInfo,
				publishOptionsForTarget(target, publishOptions)
			)
		: '';
	const files = buildOutputFiles(story, target, html, generatedAt, assets);
	const capabilities = storyFormatCapabilities(formatProperties);
	const missingAssets = (publishOptions.assetInventory ?? [])
		.filter(asset => asset.missing)
		.map(asset => asset.path);

	return {
		assets,
		files,
		html,
		report: {
			assetCount: publishOptions.assetInventory?.length ?? 0,
			capabilities,
			copiedAssetCount: assets.filter(asset => !!asset.sourcePath).length,
			fidelity: targetFidelity(target),
			generatedAt,
			missingAssets,
			outputCount: files.length,
			outputs: reportOutputs(files),
			publishSafe: safety.publishSafe,
			safetyIssues: safety.issues,
			target
		}
	};
}
