import type {CoreAssetInventoryEntry} from '../core/bindings/CoreAssetInventoryEntry';
import type {StoryFormatProperties} from '../store/story-formats';
import type {Story} from '../store/stories';
import type {AppInfo} from './app-info';
import type {PublishOptions} from './publish';
import {publishStoryWithFormat} from './publish';
import {TWINE_RS_STORY_GRAPH_HTML_ATTRIBUTE} from './story-graph-metadata';
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
	| 'compatibility-export'
	| 'inspect-html'
	| 'inspect-source'
	| 'package';

export type StoryHtmlBuildTarget =
	| 'play'
	| 'test'
	| 'proof'
	| 'publish'
	| 'export-html';

export type StoryBuildOutputKind =
	| 'archive'
	| 'html'
	| 'inspection'
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

export interface StoryBuildDiagnostic {
	code: string;
	message: string;
	outputPath: string | null;
	severity: 'error' | 'info' | 'warning';
	target: StoryBuildTarget;
}

export interface StoryBuildReport {
	assetCount: number;
	capabilities: StoryFormatCapabilityManifest;
	copiedAssetCount: number;
	diagnostics: StoryBuildDiagnostic[];
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
	return !['export-json', 'export-twee', 'inspect-source'].includes(target);
}

function publishOptionsForTarget(
	target: StoryBuildTarget,
	publishOptions: PublishOptions
) {
	if (target === 'package') {
		return {...publishOptions, includeStoryGraph: true, startOptional: true};
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

		case 'compatibility-export':
			return {
				omits: [
					'twine.rs StoryData graph metadata carrier',
					'future graph groups, collapsed state, annotations, saved views, hierarchy, and derived rules',
					'editor selection/highlight state'
				],
				preserves: [
					'normal Twine HTML and Twee compatibility outputs',
					'passage text, tags, and standard position/size metadata',
					'story IFID, format, start passage, tag colors, JavaScript, and CSS'
				]
			};

		case 'inspect-html':
			return {
				omits: ['no runnable package is produced by the inspection report'],
				preserves: [
					'HTML output structure summary',
					'story data, format, start passage, asset, and publish-safety markers'
				]
			};

		case 'inspect-source':
			return {
				omits: [
					'story format runtime bundle',
					'asset binaries',
					'HTML runtime wrapper'
				],
				preserves: [
					'Twee source structure summary',
					'StoryData, StoryTitle, passage count, script, stylesheet, and asset reference counts'
				]
			};

		case 'package':
			return {
				omits: [
					'asset file bytes when no file-backed source path is available'
				],
				preserves: [
					'HTML, JSON, Twee, and archive descriptor outputs',
					'twine.rs StoryData graph metadata carrier in project-fidelity Twee/HTML',
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

function buildDiagnostics(
	target: StoryBuildTarget,
	fidelity: StoryBuildFidelityReport,
	safetyIssues: StoryFormatPublishSafetyIssue[],
	missingAssets: string[],
	assets: StoryBuildAsset[]
): StoryBuildDiagnostic[] {
	const diagnostics: StoryBuildDiagnostic[] = [];

	for (const issue of safetyIssues) {
		diagnostics.push({
			code: `format-${issue.code}`,
			message: issue.message,
			outputPath: null,
			severity: issue.severity,
			target
		});
	}

	for (const path of missingAssets) {
		diagnostics.push({
			code: 'missing-asset',
			message: `Referenced asset "${path}" cannot be copied into this build.`,
			outputPath: path,
			severity: 'error',
			target
		});
	}

	if (target === 'package') {
		for (const asset of assets) {
			if (!asset.sourcePath) {
				diagnostics.push({
					code: 'asset-copy-source-missing',
					message: `Asset "${asset.path}" is in the package plan but has no file-backed source path.`,
					outputPath: asset.outputPath,
					severity: 'warning',
					target
				});
			}
		}
	}

	if (target === 'compatibility-export' || target === 'export-twee') {
		for (const omission of fidelity.omits) {
			diagnostics.push({
				code: 'fidelity-omission',
				message: omission,
				outputPath: null,
				severity: 'warning',
				target
			});
		}
	}

	return diagnostics;
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

function packageArchive(
	story: Story,
	generatedAt: string,
	files: StoryBuildFile[],
	assets: StoryBuildAsset[]
) {
	return JSON.stringify(
		{
			type: 'twine.rs/project-archive',
			version: 1,
			generatedAt,
			story: {
				format: story.storyFormat,
				formatVersion: story.storyFormatVersion,
				id: story.id,
				ifid: story.ifid,
				name: story.name
			},
			files: files.map(file => ({
				contents: file.contents,
				filename: file.filename,
				kind: file.kind,
				mediaType: file.mediaType,
				role: file.role,
				sizeBytes: file.sizeBytes
			})),
			assets
		},
		null,
		2
	);
}

function htmlInspection(story: Story, html: string, assets: StoryBuildAsset[]) {
	const storyDataCount = (html.match(/<tw-storydata\b/g) ?? []).length;
	const passageCount = (html.match(/<tw-passagedata\b/g) ?? []).length;
	const hasStoryDataGraph = html.includes(`${TWINE_RS_STORY_GRAPH_HTML_ATTRIBUTE}=`);

	return [
		`HTML inspection for ${story.name}`,
		'',
		`Story format: ${story.storyFormat} ${story.storyFormatVersion}`,
		`IFID: ${story.ifid}`,
		`Story data blocks: ${storyDataCount}`,
		`Passage data blocks: ${passageCount}`,
		`twine.rs StoryData graph metadata: ${
			hasStoryDataGraph ? 'present' : 'omitted'
		}`,
		`Asset copy plan items: ${assets.length}`,
		`Output size: ${byteLength(html)} bytes`
	].join('\n');
}

function sourceInspection(story: Story, twee: string, assets: StoryBuildAsset[]) {
	return [
		`Source inspection for ${story.name}`,
		'',
		`Passages: ${story.passages.length}`,
		`Tags: ${story.tags.length}`,
		`Story format: ${story.storyFormat} ${story.storyFormatVersion}`,
		`Start passage: ${
			story.passages.find(passage => passage.id === story.startPassage)?.name ??
			'not set'
		}`,
		`Script bytes: ${byteLength(story.script)}`,
		`Stylesheet bytes: ${byteLength(story.stylesheet)}`,
		`Asset copy plan items: ${assets.length}`,
		`Twee bytes: ${byteLength(twee)}`,
		'',
		'Passages:',
		...story.passages
			.slice()
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(
				passage =>
					`- ${passage.name} (${byteLength(passage.text)} bytes, ${passage.tags.length} tags, ${passage.left},${passage.top} ${passage.width}x${passage.height})`
			)
	].join('\n');
}

function buildOutputFiles(
	story: Story,
	target: StoryBuildTarget,
	html: string,
	generatedAt: string,
	assets: StoryBuildAsset[]
) {
	const projectFidelity = target === 'package';
	const htmlFile =
		html.trim() !== ''
			? outputDescriptor(
					target,
					'html',
					target === 'package' || target === 'inspect-html'
						? 'supporting'
						: 'primary',
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
		storyToTwee(story, {includeStoryGraph: projectFidelity})
	);

	switch (target) {
		case 'export-json':
			return [jsonFile];

		case 'export-twee':
			return [tweeFile];

		case 'compatibility-export':
			return [htmlFile, tweeFile].filter(
				(file): file is StoryBuildFile => !!file
			);

		case 'inspect-html':
			return [
				outputDescriptor(
					target,
					'inspection',
					'primary',
					storyFilename(story, '.html-inspection.txt'),
					'text/plain;charset=utf-8',
					htmlInspection(story, html, assets)
				),
				...(htmlFile ? [htmlFile] : [])
			];

		case 'inspect-source':
			return [
				outputDescriptor(
					target,
					'inspection',
					'primary',
					storyFilename(story, '.source-inspection.txt'),
					'text/plain;charset=utf-8',
					sourceInspection(story, tweeFile.contents, assets)
				),
				tweeFile
			];

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
			const archive = outputDescriptor(
				target,
				'archive',
				'primary',
				storyFilename(story, '.twine-project-archive.json'),
				'application/json;charset=utf-8',
				packageArchive(story, generatedAt, packageFiles, assets)
			);

			return [manifest, archive, ...packageFiles];
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
		'compatibility-export',
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
	const fidelity = targetFidelity(target);
	const buildReportDiagnostics = buildDiagnostics(
		target,
		fidelity,
		safety.issues,
		missingAssets,
		assets
	);

	return {
		assets,
		files,
		html,
		report: {
			assetCount: publishOptions.assetInventory?.length ?? 0,
			capabilities,
			copiedAssetCount: assets.filter(asset => !!asset.sourcePath).length,
			diagnostics: buildReportDiagnostics,
			fidelity,
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
