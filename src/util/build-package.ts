import type {CoreAssetInventoryEntry} from '../core/bindings/CoreAssetInventoryEntry';
import type {StoryFormatProperties} from '../store/story-formats';
import type {StoryWithDocuments as Story} from '../store/stories';
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
	| 'archive'
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
	htmlCompatibility?: boolean;
	jsonPretty?: boolean;
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
	htmlCompatibility = false
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

function blobPartToBytes(contents: BlobPart) {
	if (typeof contents === 'string') {
		return utf8Bytes(contents);
	}

	if (contents instanceof Uint8Array) {
		return contents;
	}

	if (contents instanceof ArrayBuffer) {
		return new Uint8Array(contents);
	}

	if (ArrayBuffer.isView(contents)) {
		return new Uint8Array(
			contents.buffer,
			contents.byteOffset,
			contents.byteLength
		);
	}

	throw new Error('Unsupported binary archive entry.');
}

const crc32Table = Array.from({length: 256}, (_, index) => {
	let value = index;

	for (let bit = 0; bit < 8; bit++) {
		value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	}

	return value >>> 0;
});

function crc32(bytes: Uint8Array) {
	let value = 0xffffffff;

	for (const byte of bytes) {
		value = crc32Table[(value ^ byte) & 0xff] ^ (value >>> 8);
	}

	return (value ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
	const year = Math.max(1980, date.getFullYear());

	return {
		date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
		time:
			(date.getHours() << 11) |
			(date.getMinutes() << 5) |
			Math.floor(date.getSeconds() / 2)
	};
}

function concatBytes(parts: Uint8Array[]) {
	const totalLength = parts.reduce((total, part) => total + part.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;

	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}

	return result;
}

function bytesWriter(length: number) {
	const bytes = new Uint8Array(length);
	const view = new DataView(bytes.buffer);
	let offset = 0;

	return {
		bytes,
		u16(value: number) {
			view.setUint16(offset, value, true);
			offset += 2;
		},
		u32(value: number) {
			view.setUint32(offset, value, true);
			offset += 4;
		}
	};
}

function storedZip(
	entries: Array<{contents: BlobPart; path: string}>,
	modifiedAt: Date
) {
	const {date, time} = dosDateTime(modifiedAt);
	const localParts: Uint8Array[] = [];
	const centralParts: Uint8Array[] = [];
	let localOffset = 0;

	for (const entry of entries) {
		const nameBytes = utf8Bytes(entry.path);
		const contents = blobPartToBytes(entry.contents);
		const checksum = crc32(contents);
		const local = bytesWriter(30);

		local.u32(0x04034b50);
		local.u16(20);
		local.u16(0x0800);
		local.u16(0);
		local.u16(time);
		local.u16(date);
		local.u32(checksum);
		local.u32(contents.length);
		local.u32(contents.length);
		local.u16(nameBytes.length);
		local.u16(0);
		localParts.push(local.bytes, nameBytes, contents);

		const central = bytesWriter(46);

		central.u32(0x02014b50);
		central.u16(20);
		central.u16(20);
		central.u16(0x0800);
		central.u16(0);
		central.u16(time);
		central.u16(date);
		central.u32(checksum);
		central.u32(contents.length);
		central.u32(contents.length);
		central.u16(nameBytes.length);
		central.u16(0);
		central.u16(0);
		central.u16(0);
		central.u16(0);
		central.u32(0);
		central.u32(localOffset);
		centralParts.push(central.bytes, nameBytes);

		localOffset += 30 + nameBytes.length + contents.length;
	}

	const centralDirectory = concatBytes(centralParts);
	const end = bytesWriter(22);

	end.u32(0x06054b50);
	end.u16(0);
	end.u16(0);
	end.u16(entries.length);
	end.u16(entries.length);
	end.u32(centralDirectory.length);
	end.u32(localOffset);
	end.u16(0);

	return concatBytes([...localParts, centralDirectory, end.bytes]);
}

function packageArchive(
	generatedAt: string,
	files: StoryBuildFile[],
	assets: StoryBuildAsset[]
) {
	const archiveFiles = [
		...files.map(file => ({
			contents: file.contents,
			path: file.filename
		})),
		{
			contents: JSON.stringify(
				{
					type: 'twine.rs/archive-asset-copy-plan',
					version: 1,
					generatedAt,
					assets
				},
				null,
				2
			),
			path: 'asset-copy-plan.json'
		}
	];

	return storedZip(archiveFiles, new Date(generatedAt));
}

function buildOutputFiles(
	story: Story,
	target: StoryBuildTarget,
	html: string,
	generatedAt: string,
	assets: StoryBuildAsset[],
	options: {htmlCompatibility?: boolean; jsonPretty?: boolean} = {}
) {
	const projectFidelity =
		target === 'package' ||
		((target === 'export-html' || target === 'publish') &&
			!options.htmlCompatibility);
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
				storyFilename(story, '.zip'),
				'application/zip',
				packageArchive(generatedAt, [manifest, ...packageFiles], assets)
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
	const {
		formatProperties,
		htmlCompatibility = false,
		jsonPretty = true,
		target,
		...publishOptions
	} = options;
	const safety = inspectStoryFormatPublishSafety(formatProperties);
	const generatedAt = new Date().toISOString();

	assertPublishSafety(target, safety.issues);

	const assets = buildAssetCopyPlan(publishOptions.assetInventory);
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
	const files = buildOutputFiles(story, target, html, generatedAt, assets, {
		htmlCompatibility,
		jsonPretty
	});
	const capabilities = storyFormatCapabilities(formatProperties);
	const missingAssets = (publishOptions.assetInventory ?? [])
		.filter(asset => asset.missing)
		.map(asset => asset.path);
	const fidelity = targetFidelity(target, htmlCompatibility);
	const buildReportDiagnostics = buildDiagnostics(
		target,
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
