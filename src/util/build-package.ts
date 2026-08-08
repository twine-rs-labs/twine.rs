import type {CoreAssetInventoryEntry} from '../core/bindings/CoreAssetInventoryEntry';
import type {StoryFormatProperties} from '../store/story-formats';
import type {StoryWithDocuments as Story} from '../store/stories';
import type {AppInfo} from './app-info';
import {
	externalAssetEmbeddingReport,
	type AssetEmbeddingReport,
	type AssetMode
} from './inline-assets';
import type {PublishOptions} from './publish';
import {publishStoryWithFormat} from './publish';
import {
	createStoryBuildPackageArchive,
	packageManifestPath,
	type PackageExportAsset,
	type PackageExportCompleteness,
	type PackageExportDependencyAssessment,
	type PackageExportInventoryIssue,
	type PackageExportLimits,
	type PackageExportSnapshot,
	type StoryBuildPackageArchive,
	type StoryBuildPackageManifestV2
} from './package-export';
import {
	assessPackageDependencies,
	rewriteStoryAssetReferencesForPackage
} from './package-dependencies';
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
	'play' | 'test' | 'proof' | 'publish' | 'export-html';

export type StoryBuildOutputKind =
	'archive' | 'checksums' | 'html' | 'json' | 'package-manifest' | 'twee';

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
	contents: BlobPart;
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
	assetInliningComplete: boolean;
	assetMode: AssetMode;
	capabilities: StoryFormatCapabilityManifest;
	diagnostics: StoryBuildDiagnostic[];
	externalAssetCount: number;
	fidelity: StoryBuildFidelityReport;
	generatedAt: string;
	inlinedAssetCount: number;
	inlinedEncodedBytes: number;
	inlinedReferenceCount: number;
	inlinedSourceBytes: number;
	missingAssets: string[];
	outputCount: number;
	outputs: StoryBuildOutput[];
	packageManifest?: StoryBuildPackageManifestV2;
	publishSafe: boolean;
	safetyIssues: StoryFormatPublishSafetyIssue[];
	target: StoryBuildTarget;
	unresolvedAssets: AssetEmbeddingReport['unresolvedAssets'];
	unsupportedAssets: AssetEmbeddingReport['unsupportedAssets'];
	availableAssetSourceCount: number;
}

export interface StoryBuildPackage {
	assets: StoryBuildAsset[];
	files: StoryBuildFile[];
	html: string;
	packageArchive?: StoryBuildPackageArchive;
	report: StoryBuildReport;
}

export interface StoryBuildPackageOptions extends PublishOptions {
	assetEmbeddingReport?: AssetEmbeddingReport;
	formatProperties: StoryFormatProperties;
	htmlCompatibility?: boolean;
	jsonPretty?: boolean;
	target: Exclude<StoryBuildTarget, 'package'>;
}

export interface AssetCompleteStoryBuildPackageOptions extends Omit<
	StoryBuildPackageOptions,
	'target'
> {
	generatedAt?: Date | string;
	packageAssets: PackageExportAsset[];
	packageCompleteness?: PackageExportCompleteness;
	packageDependencies?: PackageExportDependencyAssessment[];
	packageInventoryIssues?: PackageExportInventoryIssue[];
	packageLimits?: PackageExportLimits;
	packageSnapshot?: PackageExportSnapshot;
	target: 'package';
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

function stableFilenameHash(value: string) {
	let hash = 0x811c9dc5;

	for (const byte of utf8Bytes(value)) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193);
	}

	return (hash >>> 0).toString(16).padStart(8, '0');
}

function truncateUtf8(value: string, maxBytes: number) {
	let result = '';
	let size = 0;

	for (const character of value) {
		const characterBytes = utf8Bytes(character).length;

		if (size + characterBytes > maxBytes) break;
		result += character;
		size += characterBytes;
	}

	return result;
}

const reservedWindowsDeviceName =
	/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i;

function storyFilename(story: Story, extension: string) {
	const normalizedName = story.name.normalize('NFC');
	let baseName = [...normalizedName]
		.map(character => {
			const codePoint = character.codePointAt(0)!;

			return codePoint <= 0x1f ||
				(codePoint >= 0xd800 && codePoint <= 0xdfff) ||
				'<>:"/\\|?*'.includes(character)
				? '_'
				: character;
		})
		.join('')
		.trim()
		.replace(/[. ]+$/g, '');

	if (!baseName) baseName = 'Story';
	const reservedMatch = baseName.match(reservedWindowsDeviceName);
	if (reservedMatch) {
		baseName = `${reservedMatch[1]}-story${reservedMatch[2] ?? ''}`;
	}
	if (utf8Bytes(baseName).length > 200) {
		const suffix = `-${stableFilenameHash(normalizedName)}`;

		baseName = `${truncateUtf8(baseName, 200 - suffix.length)}${suffix}`;
	}

	return `${baseName}${extension}`;
}

function byteLength(source: BlobPart) {
	return new Blob([source]).size;
}

function utf8Bytes(value: string) {
	if (typeof TextEncoder !== 'undefined') {
		return new TextEncoder().encode(value);
	}

	const bytes: number[] = [];

	for (let index = 0; index < value.length; index++) {
		let codePoint = value.charCodeAt(index);

		if (
			codePoint >= 0xd800 &&
			codePoint <= 0xdbff &&
			index + 1 < value.length
		) {
			const low = value.charCodeAt(index + 1);

			if (low >= 0xdc00 && low <= 0xdfff) {
				codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
				index++;
			}
		}

		if (codePoint <= 0x7f) {
			bytes.push(codePoint);
		} else if (codePoint <= 0x7ff) {
			bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
		} else if (codePoint <= 0xffff) {
			bytes.push(
				0xe0 | (codePoint >> 12),
				0x80 | ((codePoint >> 6) & 0x3f),
				0x80 | (codePoint & 0x3f)
			);
		} else {
			bytes.push(
				0xf0 | (codePoint >> 18),
				0x80 | ((codePoint >> 12) & 0x3f),
				0x80 | ((codePoint >> 6) & 0x3f),
				0x80 | (codePoint & 0x3f)
			);
		}
	}

	return new Uint8Array(bytes);
}

function outputDescriptor(
	target: StoryBuildTarget,
	kind: StoryBuildOutputKind,
	role: StoryBuildOutputRole,
	filename: string,
	mediaType: string,
	contents: BlobPart
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

function storyToJson(story: Story, pretty = true) {
	return JSON.stringify(story, null, pretty ? 2 : 0);
}

function shouldRenderHtml(target: StoryBuildTarget) {
	return !['export-json', 'export-twee'].includes(target);
}

function publishOptionsForTarget(
	target: StoryBuildTarget,
	publishOptions: PublishOptions,
	htmlCompatibility = false
) {
	if (target === 'package') {
		return {...publishOptions, includeStoryGraph: true, startOptional: true};
	}

	if (target === 'export-html' || target === 'publish') {
		return {
			...publishOptions,
			includeStoryGraph: publishOptions.includeStoryGraph ?? !htmlCompatibility
		};
	}

	return publishOptions;
}

function targetFidelity(
	target: StoryBuildTarget,
	htmlCompatibility = false,
	assetMode: AssetMode = 'external',
	assetEmbeddingReport?: AssetEmbeddingReport,
	packageIncludesAssetBytes = false
): StoryBuildFidelityReport {
	const includesProjectGraph =
		target === 'package' ||
		((target === 'export-html' || target === 'publish') && !htmlCompatibility);

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
			if (!packageIncludesAssetBytes) {
				return {
					omits: [
						'project asset file bytes; this legacy archive contains an asset copy plan only'
					],
					preserves: [
						'HTML, JSON, Twee, and archive descriptor outputs',
						'twine.rs StoryData graph metadata carrier in project-fidelity Twee/HTML',
						'asset copy plan',
						'capability manifest and publish-safety report'
					]
				};
			}

			return {
				omits: [
					'dynamic JavaScript-created dependencies are not evaluated',
					'unsupported copied-file dependency forms identified by the package report'
				],
				preserves: [
					'playable HTML, immutable JSON and Twee source, and package metadata',
					'twine.rs StoryData graph metadata carrier in project-fidelity Twee/HTML',
					'bounded project asset bytes with SHA-256 checksums',
					'scoped dependency completeness and publish-safety reporting'
				]
			};

		default:
			return {
				omits: [
					...(assetMode === 'inline-referenced'
						? assetEmbeddingReport?.assetInliningComplete
							? []
							: ['media bytes for unresolved or unsupported references']
						: ['referenced project media bytes remain external']),
					...(includesProjectGraph
						? []
						: ['twine.rs StoryData graph metadata carrier']),
					'editor selection/highlight state',
					'future graph groups, collapsed state, hierarchy, and workspace views'
				],
				preserves: [
					'standard Twine story data',
					'passage text, tags, and positions',
					'story IFID, format, start passage, tag colors, JavaScript, and CSS',
					...(assetMode === 'inline-referenced'
						? ['supported statically referenced project media as data URLs']
						: []),
					...(includesProjectGraph
						? ['twine.rs StoryData graph metadata carrier']
						: [])
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
	safetyIssues: StoryFormatPublishSafetyIssue[],
	missingAssets: string[],
	assets: StoryBuildAsset[],
	assetEmbeddingReport: AssetEmbeddingReport
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
			severity: 'warning',
			target
		});
	}

	for (const issue of assetEmbeddingReport.unresolvedAssets) {
		diagnostics.push({
			code: 'asset-embedding-unresolved',
			message: `Referenced asset "${issue.path}" was not embedded: ${issue.reason}`,
			outputPath: issue.path,
			severity: 'warning',
			target
		});
	}

	for (const issue of assetEmbeddingReport.unsupportedAssets) {
		diagnostics.push({
			code: 'asset-embedding-unsupported',
			message: `Referenced asset "${issue.path}" is not supported for embedding: ${issue.reason}`,
			outputPath: issue.path,
			severity: 'warning',
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

	return diagnostics;
}

function buildOutputFiles(
	story: Story,
	target: StoryBuildTarget,
	html: string,
	options: {htmlCompatibility?: boolean; jsonPretty?: boolean} = {}
) {
	const projectFidelity =
		(target === 'export-html' || target === 'publish') &&
		!options.htmlCompatibility;
	const htmlFile =
		html.trim() !== ''
			? outputDescriptor(
					target,
					'html',
					'primary',
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
		storyToJson(story, options.jsonPretty)
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
	if ((options as {target: StoryBuildTarget}).target === 'package') {
		throw new Error(
			'Package builds require createAssetCompleteStoryBuildPackage().'
		);
	}
	const {
		assetEmbeddingReport: providedAssetEmbeddingReport,
		assetMode = 'external',
		formatProperties,
		htmlCompatibility = false,
		jsonPretty = true,
		target,
		...publishOptions
	} = options;
	const safety = inspectStoryFormatPublishSafety(formatProperties);
	const generatedAt = new Date().toISOString();

	if (
		assetMode === 'inline-referenced' &&
		target !== 'export-html' &&
		target !== 'publish'
	) {
		throw new Error(
			'Referenced media embedding is supported only for Playable HTML export.'
		);
	}

	assertPublishSafety(target, safety.issues);

	const assets = buildAssetCopyPlan(publishOptions.assetInventory);
	const assetEmbeddingReport =
		providedAssetEmbeddingReport ??
		externalAssetEmbeddingReport(publishOptions.assetInventory);
	const renderPublishOptions = {
		...publishOptions,
		assetInventory: publishOptions.assetInventory?.filter(
			asset => !asset.missing
		)
	};
	const html = shouldRenderHtml(target)
		? publishStoryWithFormat(
				story,
				formatProperties.source,
				appInfo,
				publishOptionsForTarget(target, renderPublishOptions, htmlCompatibility)
			)
		: '';
	const files = buildOutputFiles(story, target, html, {
		htmlCompatibility,
		jsonPretty
	});
	const capabilities = storyFormatCapabilities(formatProperties);
	const missingAssets = (publishOptions.assetInventory ?? [])
		.filter(asset => asset.missing)
		.map(asset => asset.path);
	const fidelity = targetFidelity(
		target,
		htmlCompatibility,
		assetMode,
		assetEmbeddingReport
	);
	const buildReportDiagnostics = buildDiagnostics(
		target,
		safety.issues,
		missingAssets,
		assets,
		assetEmbeddingReport
	);

	return {
		assets,
		files,
		html,
		report: {
			assetCount: publishOptions.assetInventory?.length ?? 0,
			assetInliningComplete: assetEmbeddingReport.assetInliningComplete,
			assetMode,
			availableAssetSourceCount: assets.filter(asset => !!asset.sourcePath)
				.length,
			capabilities,
			diagnostics: buildReportDiagnostics,
			externalAssetCount: assetEmbeddingReport.externalAssetCount,
			fidelity,
			generatedAt,
			inlinedAssetCount: assetEmbeddingReport.inlinedAssetCount,
			inlinedEncodedBytes: assetEmbeddingReport.inlinedEncodedBytes,
			inlinedReferenceCount: assetEmbeddingReport.inlinedReferenceCount,
			inlinedSourceBytes: assetEmbeddingReport.inlinedSourceBytes,
			missingAssets,
			outputCount: files.length,
			outputs: reportOutputs(files),
			publishSafe: safety.publishSafe,
			safetyIssues: safety.issues,
			target,
			unresolvedAssets: assetEmbeddingReport.unresolvedAssets,
			unsupportedAssets: assetEmbeddingReport.unsupportedAssets
		}
	};
}

function assetCompletePackageDiagnostics(
	assets: PackageExportAsset[],
	dependencies: PackageExportDependencyAssessment[],
	inventoryIssues: PackageExportInventoryIssue[]
): StoryBuildDiagnostic[] {
	const diagnostics: StoryBuildDiagnostic[] = [];

	for (const asset of assets) {
		if (asset.status !== 'failed') {
			continue;
		}

		diagnostics.push({
			code: `package-asset-${asset.reasonCode}`,
			message: `Asset "${asset.logicalPath}" was not included: ${asset.reasonMessage}`,
			outputPath: asset.logicalPath,
			severity:
				asset.reasonCode === 'excluded' && !asset.requiredByStaticReference
					? 'info'
					: [
								'invalid-path',
								'nonportable',
								'security',
								'symlink-escape'
						  ].includes(asset.reasonCode)
						? 'error'
						: 'warning',
			target: 'package'
		});
	}

	for (const issue of inventoryIssues) {
		const blocking = /invalid|non-utf|security|symlink|traversal|escape/i.test(
			issue.reasonCode
		);

		diagnostics.push({
			code: `package-inventory-${issue.reasonCode}`,
			message: `Project asset inventory issue at "${issue.path}": ${issue.reasonMessage}`,
			outputPath: issue.path,
			severity: blocking ? 'error' : 'warning',
			target: 'package'
		});
	}

	for (const dependency of dependencies) {
		if (dependency.disposition === 'packaged') {
			continue;
		}

		const severity =
			dependency.disposition === 'blocked' && dependency.kind === 'unsafe-local'
				? 'error'
				: dependency.kind === 'navigation' ||
					  (dependency.kind === 'dynamic-unknown' &&
							dependency.original === 'Runtime JavaScript dependency discovery')
					? 'info'
					: 'warning';

		diagnostics.push({
			code: `package-dependency-${dependency.kind}`,
			message: `Dependency "${dependency.original}" is ${dependency.disposition}.`,
			outputPath: dependency.sourceLocation ?? null,
			severity,
			target: 'package'
		});
	}

	return diagnostics;
}

/**
 * Builds a version 2 package from asset bytes that were already collected by a
 * capability-bound reader. JSON and Twee are canonical source snapshots; HTML
 * is a derived playable output.
 */
export async function createAssetCompleteStoryBuildPackage(
	story: Story,
	appInfo: AppInfo,
	options: AssetCompleteStoryBuildPackageOptions
): Promise<StoryBuildPackage> {
	const {
		assetEmbeddingReport: providedAssetEmbeddingReport,
		assetMode = 'external',
		formatProperties,
		generatedAt,
		htmlCompatibility = false,
		jsonPretty = true,
		packageAssets,
		packageCompleteness,
		packageDependencies = [],
		packageInventoryIssues = [],
		packageLimits,
		packageSnapshot,
		target,
		...publishOptions
	} = options;

	if (target !== 'package') {
		throw new Error('Asset-complete builds require the Package target.');
	}

	if (assetMode !== 'external') {
		throw new Error(
			'Package assets must be stored as separate archive entries.'
		);
	}

	const safety = inspectStoryFormatPublishSafety(formatProperties);

	assertPublishSafety('package', safety.issues);

	const inventory = publishOptions.assetInventory ?? [];
	const assets = buildAssetCopyPlan(inventory);
	const assetEmbeddingReport =
		providedAssetEmbeddingReport ?? externalAssetEmbeddingReport(inventory);
	const runtimeStory = rewriteStoryAssetReferencesForPackage(
		story,
		inventory
	).story;
	const htmlFilename = storyFilename(story, '.html');
	const html = publishStoryWithFormat(
		runtimeStory,
		formatProperties.source,
		appInfo,
		publishOptionsForTarget(
			'package',
			{
				...publishOptions,
				assetInventory: inventory.filter(asset => !asset.missing)
			},
			htmlCompatibility
		)
	);
	const htmlFile = outputDescriptor(
		'package',
		'html',
		'supporting',
		htmlFilename,
		'text/html;charset=utf-8',
		html
	);
	const jsonFile = outputDescriptor(
		'package',
		'json',
		'supporting',
		storyFilename(story, '.json'),
		'application/json;charset=utf-8',
		storyToJson(story, jsonPretty)
	);
	const tweeFile = outputDescriptor(
		'package',
		'twee',
		'supporting',
		storyFilename(story, '.twee'),
		'text/plain;charset=utf-8',
		storyToTwee(story, {includeStoryGraph: true})
	);
	const includedPackageAssets = packageAssets.filter(
		(asset): asset is Extract<PackageExportAsset, {status: 'included'}> =>
			asset.status === 'included'
	);
	const dependencyAssessment = assessPackageDependencies({
		assets: includedPackageAssets.map(asset => ({
			bytes: asset.bytes,
			logicalPath: asset.logicalPath,
			mediaType: asset.mediaType,
			requiredByStaticReference: asset.requiredByStaticReference
		})),
		html,
		htmlPath: htmlFilename,
		packagedPaths: [jsonFile.filename, tweeFile.filename]
	});
	const dependencies = [
		...dependencyAssessment.dependencies,
		...packageDependencies
	];
	const hasExplicitIncompleteStaticDependency = packageDependencies.some(
		dependency =>
			dependency.kind !== 'navigation' &&
			dependency.kind !== 'dynamic-unknown' &&
			dependency.disposition !== 'packaged'
	);
	const completeness: PackageExportCompleteness = {
		copiedAssetContents: dependencyAssessment.copiedAssetContents,
		dynamicDependencies: 'not-evaluated',
		projectAssetBytes:
			packageCompleteness?.projectAssetBytes ??
			(packageAssets.some(
				asset =>
					asset.status === 'failed' &&
					(asset.reasonCode !== 'excluded' || asset.requiredByStaticReference)
			) || packageInventoryIssues.length > 0
				? 'incomplete'
				: 'complete'),
		staticRuntimeDependencies: hasExplicitIncompleteStaticDependency
			? 'incomplete'
			: dependencyAssessment.staticRuntimeDependencies
	};
	const packageArchive = await createStoryBuildPackageArchive({
		assets: packageAssets,
		canonicalSource: [jsonFile, tweeFile].map(file => ({
			bytes: utf8Bytes(file.contents as string),
			mediaType: file.mediaType,
			path: file.filename
		})),
		completeness,
		dependencies,
		derivedOutputs: [
			{
				bytes: utf8Bytes(html),
				mediaType: htmlFile.mediaType,
				path: htmlFile.filename
			}
		],
		generatedAt,
		inventoryIssues: packageInventoryIssues,
		limits: packageLimits,
		snapshot: packageSnapshot,
		story: {
			format: story.storyFormat,
			formatVersion: story.storyFormatVersion,
			id: story.id,
			ifid: story.ifid,
			name: story.name
		}
	});
	const manifestFile = outputDescriptor(
		'package',
		'package-manifest',
		'manifest',
		packageManifestPath,
		'application/json;charset=utf-8',
		packageArchive.manifestSource
	);
	const checksumFile = outputDescriptor(
		'package',
		'checksums',
		'supporting',
		'SHA256SUMS',
		'text/plain;charset=utf-8',
		packageArchive.checksumSource
	);
	const archiveFile = outputDescriptor(
		'package',
		'archive',
		'primary',
		storyFilename(story, '.zip'),
		'application/zip',
		packageArchive.archive
	);
	const files = [
		manifestFile,
		archiveFile,
		checksumFile,
		htmlFile,
		jsonFile,
		tweeFile
	];
	const missingAssets = inventory
		.filter(asset => asset.missing)
		.map(asset => asset.path);
	const diagnostics = [
		...buildDiagnostics(
			'package',
			safety.issues,
			missingAssets,
			[],
			assetEmbeddingReport
		),
		...assetCompletePackageDiagnostics(
			packageAssets,
			dependencies,
			packageInventoryIssues
		)
	];
	const includedAssetCount = packageAssets.filter(
		asset => asset.status === 'included'
	).length;

	return {
		assets,
		files,
		html,
		packageArchive,
		report: {
			assetCount: inventory.length,
			assetInliningComplete:
				packageArchive.manifest.completeness.projectAssetBytes === 'complete',
			assetMode,
			availableAssetSourceCount: includedAssetCount,
			capabilities: storyFormatCapabilities(formatProperties),
			diagnostics,
			externalAssetCount: dependencies.filter(
				dependency => dependency.disposition === 'external'
			).length,
			fidelity: targetFidelity(
				'package',
				htmlCompatibility,
				assetMode,
				assetEmbeddingReport,
				true
			),
			generatedAt: packageArchive.manifest.generatedAt,
			inlinedAssetCount: 0,
			inlinedEncodedBytes: 0,
			inlinedReferenceCount: 0,
			inlinedSourceBytes: 0,
			missingAssets,
			outputCount: files.length,
			outputs: reportOutputs(files),
			packageManifest: packageArchive.manifest,
			publishSafe: safety.publishSafe,
			safetyIssues: safety.issues,
			target: 'package',
			unresolvedAssets: assetEmbeddingReport.unresolvedAssets,
			unsupportedAssets: assetEmbeddingReport.unsupportedAssets
		}
	};
}
