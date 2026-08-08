/** Browser-safe primitives for the version 2 portable story-build package. */

export type PackageExportBytes = ArrayBuffer | ArrayBufferView | Uint8Array;

export interface PackageExportEntry {
	bytes: PackageExportBytes;
	mediaType?: string;
	path: string;
}

export interface PackageExportIncludedAsset {
	archivePath: string;
	bytes: PackageExportBytes;
	logicalPath: string;
	mediaType?: string;
	requiredByStaticReference: boolean;
	sha256: string;
	sizeBytes: number;
	status: 'included';
}

export interface PackageExportFailedAsset {
	logicalPath: string;
	reasonCode: PackageExportAssetFailureReason;
	reasonMessage: string;
	requiredByStaticReference: boolean;
	status: 'failed';
}

export type PackageExportAssetFailureReason =
	| 'changed'
	| 'excluded'
	| 'file-count-exceeded'
	| 'file-too-large'
	| 'invalid-path'
	| 'missing'
	| 'nonportable'
	| 'not-file'
	| 'security'
	| 'session-stale'
	| 'symlink-escape'
	| 'total-limit-exceeded'
	| 'unreadable';

export type PackageExportAsset =
	PackageExportIncludedAsset | PackageExportFailedAsset;

export interface PackageExportDependencyAssessment {
	disposition: 'packaged' | 'external' | 'blocked' | 'not-evaluated';
	kind:
		| 'managed-local'
		| 'remote-resource'
		| 'navigation'
		| 'unsafe-local'
		| 'dynamic-unknown';
	original: string;
	sourceLocation?: string;
}

export interface PackageExportInventoryIssue {
	path: string;
	reasonCode: string;
	reasonMessage: string;
}

export interface PackageExportCompleteness {
	copiedAssetContents: 'not-evaluated' | 'partially-evaluated';
	dynamicDependencies: 'not-evaluated';
	projectAssetBytes: 'complete' | 'incomplete';
	staticRuntimeDependencies: 'complete' | 'incomplete' | 'unknown';
}

export interface PackageExportLimits {
	maxAssetFileBytes?: number;
	maxAssetFileCount?: number;
	maxAssetTotalBytes?: number;
	maxComponentBytes?: number;
	maxEntryCount?: number;
	maxGeneratedBytes?: number;
	maxPathBytes?: number;
	maxZipBytes?: number;
}

export interface PackageExportSnapshot {
	contentFingerprint?: string;
	generation?: number;
	id?: string;
	inventoryFingerprint?: string;
	revision?: string | number;
	sessionInstanceId?: string;
	source?: string;
}

export interface StoryBuildPackageArchiveInput {
	assets: PackageExportAsset[];
	clock?: () => Date;
	completeness?: PackageExportCompleteness;
	dependencies?: PackageExportDependencyAssessment[];
	generatedAt?: Date | string;
	inventoryIssues?: PackageExportInventoryIssue[];
	limits?: PackageExportLimits;
	canonicalSource: PackageExportEntry[];
	derivedOutputs: PackageExportEntry[];
	snapshot?: PackageExportSnapshot;
	story: Record<string, unknown>;
}

export interface StoryBuildPackageManifestIncludedAsset {
	archivePath: string;
	logicalPath: string;
	requiredByStaticReference: boolean;
	sha256: string;
	sizeBytes: number;
	status: 'included';
}

export interface StoryBuildPackageManifestFailedAsset {
	logicalPath: string;
	reasonCode: PackageExportAssetFailureReason;
	reasonMessage: string;
	requiredByStaticReference: boolean;
	status: 'failed';
}

export type StoryBuildPackageManifestAsset =
	StoryBuildPackageManifestIncludedAsset | StoryBuildPackageManifestFailedAsset;

export interface StoryBuildPackageManifestV2 {
	assets: StoryBuildPackageManifestAsset[];
	canonicalSource: Array<{path: string; sha256: string; sizeBytes: number}>;
	completeness: PackageExportCompleteness;
	dependencies: PackageExportDependencyAssessment[];
	derivedOutputs: Array<{
		mediaType?: string;
		path: string;
		sha256: string;
		sizeBytes: number;
	}>;
	generatedAt: string;
	inventoryIssues: PackageExportInventoryIssue[];
	limits: Required<PackageExportLimits>;
	snapshot: PackageExportSnapshot | null;
	story: Record<string, unknown>;
	type: 'twine.rs/story-build-package';
	version: 2;
}

export interface StoryBuildPackageArchive {
	archive: Blob;
	archiveEntryPaths: string[];
	checksumSource: string;
	manifest: StoryBuildPackageManifestV2;
	manifestHash: string;
	manifestSource: string;
}

const encoder = new TextEncoder();
export const packageManifestPath = '_twine-package/manifest.json';
const checksumsPath = 'SHA256SUMS';
const defaults: Required<PackageExportLimits> = {
	maxAssetFileBytes: 0xffffffff,
	maxAssetFileCount: 65535,
	maxAssetTotalBytes: 0xffffffff,
	maxComponentBytes: 255,
	maxEntryCount: 65535,
	maxPathBytes: 240,
	maxZipBytes: 0xffffffff,
	maxGeneratedBytes: 0xffffffff
};

function resolvedPackageLimits(limits: PackageExportLimits = {}) {
	const resolved = {...defaults, ...limits};

	for (const [name, value] of Object.entries(resolved)) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new Error(
				`Package limit "${name}" must be a nonnegative safe integer.`
			);
		}
	}

	return resolved;
}

function bytes(value: PackageExportBytes) {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function bytewiseCompare(left: string, right: string) {
	const a = encoder.encode(left);
	const b = encoder.encode(right);
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		if (a[i] !== b[i]) return a[i] - b[i];
	}
	return a.length - b.length;
}

function portableCaseFold(value: string) {
	// Uppercase first so Unicode expansion mappings such as ß -> SS and ﬃ ->
	// FFI participate in the collision key. The second fold also unifies final
	// sigma and ordinary sigma. Blocking an extra ambiguous name is safer than
	// emitting an archive that cannot be extracted on a target filesystem.
	return value.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
}

function normalizedPath(path: string) {
	return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

function portabilityError(path: string, message: string): never {
	throw new Error(`Package path "${path}" is not portable: ${message}.`);
}

function isUnicodeScalarString(value: string) {
	for (let index = 0; index < value.length; index++) {
		const codeUnit = value.charCodeAt(index);

		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);

			if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff)
				return false;
			index++;
		} else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			return false;
		}
	}

	return true;
}

/** Validates a logical archive pathname without changing its identity. */
export function validatePackagePath(
	path: string,
	limits: PackageExportLimits = {}
) {
	const resolved = resolvedPackageLimits(limits);
	const normalized = normalizedPath(path);
	if (!isUnicodeScalarString(path))
		portabilityError(path, 'it contains an unpaired UTF-16 surrogate');
	if (
		!path ||
		normalized !== path ||
		path.startsWith('/') ||
		path.includes('//')
	) {
		portabilityError(path, 'it must be a normalized relative path');
	}
	if (
		/[<>:"|?*]/.test(path) ||
		[...path].some(character => character.codePointAt(0)! <= 0x1f)
	)
		portabilityError(
			path,
			'it contains a character forbidden by portable filesystems'
		);
	if (encoder.encode(path).length > resolved.maxPathBytes)
		portabilityError(path, 'it exceeds the path byte limit');
	const reserved = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i;
	for (const component of path.split('/')) {
		if (!component || component === '.' || component === '..')
			portabilityError(path, 'it has an empty or traversal component');
		if (/[. ]$/.test(component))
			portabilityError(path, 'a component ends in a dot or space');
		if (reserved.test(component))
			portabilityError(path, `component "${component}" is reserved on Windows`);
		if (encoder.encode(component).length > resolved.maxComponentBytes)
			portabilityError(path, 'a component exceeds the byte limit');
	}
	return path;
}

/** Plans assets by logical path only; it deliberately never deduplicates bytes. */
export function planPackageAssetPaths(
	paths: string[],
	limits?: PackageExportLimits
) {
	const planned = new Set<string>();
	for (const path of paths) {
		validatePackagePath(path, limits);
		if (!path.startsWith('assets/'))
			portabilityError(path, 'asset paths must remain under assets/');
		planned.add(path);
	}
	validatePackagePathCollisions([...planned], limits);
	return [...planned].sort(bytewiseCompare);
}

export function validatePackagePathCollisions(
	paths: string[],
	limits?: PackageExportLimits
) {
	const seen = new Map<string, string>();
	const all = new Set<string>();
	for (const path of paths) {
		if (all.has(path))
			portabilityError(path, 'it duplicates another archive entry');
		all.add(path);
		validatePackagePath(path, limits);
		const key = portableCaseFold(path);
		const prior = seen.get(key);
		if (prior && prior !== path)
			portabilityError(
				path,
				`it collides with "${prior}" after NFC case-folding`
			);
		seen.set(key, path);
	}
	for (const path of all) {
		for (
			let index = path.indexOf('/');
			index !== -1;
			index = path.indexOf('/', index + 1)
		) {
			const prefix = path.slice(0, index);
			const collidingFile = seen.get(portableCaseFold(prefix));
			if (collidingFile)
				portabilityError(
					path,
					`"${collidingFile}" is both a file and directory`
				);
		}
	}
}

export async function sha256Hex(value: PackageExportBytes | string) {
	const input =
		typeof value === 'string' ? encoder.encode(value) : bytes(value);
	const digest = await crypto.subtle.digest(
		'SHA-256',
		input as unknown as BufferSource
	);
	return [...new Uint8Array(digest)]
		.map(value => value.toString(16).padStart(2, '0'))
		.join('');
}

const crc32Table = new Uint32Array(256);
const asyncCrcChunkBytes = 1024 * 1024;

for (let index = 0; index < crc32Table.length; index++) {
	let value = index;
	for (let bit = 0; bit < 8; bit++)
		value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
	crc32Table[index] = value >>> 0;
}

function updateCrc32(
	crc: number,
	input: Uint8Array,
	start = 0,
	end = input.length
) {
	for (let index = start; index < end; index++)
		crc = crc32Table[(crc ^ input[index]) & 0xff] ^ (crc >>> 8);
	return crc >>> 0;
}

function crc32(input: Uint8Array) {
	return (updateCrc32(0xffffffff, input) ^ 0xffffffff) >>> 0;
}

function yieldToEventLoop() {
	return new Promise<void>(resolve => setTimeout(resolve, 0));
}

function write16(target: Uint8Array, offset: number, value: number) {
	target[offset] = value & 0xff;
	target[offset + 1] = (value >>> 8) & 0xff;
}
function write32(target: Uint8Array, offset: number, value: number) {
	write16(target, offset, value);
	write16(target, offset + 2, Math.floor(value / 0x10000));
}
function dosTime(date: Date) {
	const year = date.getUTCFullYear();
	if (year < 1980 || year > 2107)
		throw new Error('ZIP timestamps must be between 1980 and 2107 UTC.');
	return {
		date:
			((year - 1980) << 9) |
			((date.getUTCMonth() + 1) << 5) |
			date.getUTCDate(),
		time:
			(date.getUTCHours() << 11) |
			(date.getUTCMinutes() << 5) |
			Math.floor(date.getUTCSeconds() / 2)
	};
}

interface StoredZipRecord {
	crc: number;
	data: Uint8Array;
	name: Uint8Array;
}

interface StoredZipBlobRecord extends StoredZipRecord {
	dataParts: Blob[];
}

interface StoredZipLayout {
	centralSize: number;
	records: Array<Omit<StoredZipRecord, 'crc'>>;
	total: number;
}

function storedZipLayout(
	entries: PackageExportEntry[],
	limits?: PackageExportLimits
): StoredZipLayout {
	const resolved = resolvedPackageLimits(limits);
	if (entries.length > resolved.maxEntryCount || entries.length > 0xffff)
		throw new Error('ZIP entry count exceeds the classic ZIP limit.');
	validatePackagePathCollisions(
		entries.map(entry => entry.path),
		resolved
	);
	const records = entries.map(entry => {
		const name = encoder.encode(entry.path);
		const data = bytes(entry.bytes);
		if (name.length > 0xffff || data.length > 0xffffffff)
			throw new Error(`ZIP entry "${entry.path}" exceeds a classic ZIP limit.`);
		return {data, name};
	});
	let localSize = 0;
	let centralSize = 0;
	for (const record of records) {
		localSize += 30 + record.name.length + record.data.length;
		centralSize += 46 + record.name.length;
	}
	const total = localSize + centralSize + 22;
	if (
		localSize > 0xffffffff ||
		centralSize > 0xffffffff ||
		total > resolved.maxZipBytes ||
		total > 0xffffffff
	)
		throw new Error('ZIP size exceeds the classic 32-bit limit.');
	return {centralSize, records, total};
}

function localFileHeader(
	record: StoredZipRecord,
	stamp: ReturnType<typeof dosTime>
) {
	const header = new Uint8Array(30);
	write32(header, 0, 0x04034b50);
	write16(header, 4, 20);
	write16(header, 6, 0x0800);
	write16(header, 8, 0);
	write16(header, 10, stamp.time);
	write16(header, 12, stamp.date);
	write32(header, 14, record.crc);
	write32(header, 18, record.data.length);
	write32(header, 22, record.data.length);
	write16(header, 26, record.name.length);
	write16(header, 28, 0);
	return header;
}

function centralDirectoryHeader(
	record: StoredZipRecord,
	stamp: ReturnType<typeof dosTime>,
	localOffset: number
) {
	const header = new Uint8Array(46);
	write32(header, 0, 0x02014b50);
	write16(header, 4, 20);
	write16(header, 6, 20);
	write16(header, 8, 0x0800);
	write16(header, 10, 0);
	write16(header, 12, stamp.time);
	write16(header, 14, stamp.date);
	write32(header, 16, record.crc);
	write32(header, 20, record.data.length);
	write32(header, 24, record.data.length);
	write16(header, 28, record.name.length);
	write16(header, 30, 0);
	write16(header, 32, 0);
	write16(header, 34, 0);
	write16(header, 36, 0);
	write32(header, 38, 0);
	write32(header, 42, localOffset);
	return header;
}

function endOfCentralDirectory(
	entryCount: number,
	centralSize: number,
	centralOffset: number
) {
	const record = new Uint8Array(22);
	write32(record, 0, 0x06054b50);
	write16(record, 4, 0);
	write16(record, 6, 0);
	write16(record, 8, entryCount);
	write16(record, 10, entryCount);
	write32(record, 12, centralSize);
	write32(record, 16, centralOffset);
	write16(record, 20, 0);
	return record;
}

async function storedZipRecordsForBlob(
	records: StoredZipLayout['records']
): Promise<StoredZipBlobRecord[]> {
	const result: StoredZipBlobRecord[] = [];
	let bytesBeforeYield = asyncCrcChunkBytes;

	for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
		const record = records[recordIndex];
		let crc = 0xffffffff;
		let offset = 0;
		const dataParts: Blob[] = [];

		while (offset < record.data.length) {
			const end = Math.min(record.data.length, offset + bytesBeforeYield);
			crc = updateCrc32(crc, record.data, offset, end);
			dataParts.push(
				new Blob([record.data.subarray(offset, end) as unknown as BlobPart])
			);
			bytesBeforeYield -= end - offset;
			offset = end;

			if (
				bytesBeforeYield === 0 &&
				(offset < record.data.length || recordIndex < records.length - 1)
			) {
				await yieldToEventLoop();
				bytesBeforeYield = asyncCrcChunkBytes;
			}
		}

		result.push({...record, crc: (crc ^ 0xffffffff) >>> 0, dataParts});
	}

	return result;
}

/** Creates a classic uncompressed ZIP with one UTC timestamp for every entry. */
export function createStoredZip(
	entries: PackageExportEntry[],
	timestamp: Date,
	limits?: PackageExportLimits
): Uint8Array {
	const layout = storedZipLayout(entries, limits);
	const stamp = dosTime(timestamp);
	const records = layout.records.map(record => ({
		...record,
		crc: crc32(record.data)
	}));
	const archive = new Uint8Array(layout.total);
	let offset = 0;
	const offsets: number[] = [];
	for (const record of records) {
		offsets.push(offset);
		archive.set(localFileHeader(record, stamp), offset);
		archive.set(record.name, offset + 30);
		archive.set(record.data, offset + 30 + record.name.length);
		offset += 30 + record.name.length + record.data.length;
	}
	const centralOffset = offset;
	records.forEach((record, index) => {
		archive.set(centralDirectoryHeader(record, stamp, offsets[index]), offset);
		archive.set(record.name, offset + 46);
		offset += 46 + record.name.length;
	});
	archive.set(
		endOfCentralDirectory(records.length, layout.centralSize, centralOffset),
		offset
	);
	return archive;
}

/**
 * Creates a classic uncompressed ZIP without copying entry payloads into one
 * contiguous archive buffer. CRC work yields between bounded byte chunks.
 */
export async function createStoredZipBlob(
	entries: PackageExportEntry[],
	timestamp: Date,
	limits?: PackageExportLimits
): Promise<Blob> {
	if (typeof Blob === 'undefined')
		throw new Error('Blob is unavailable in this environment.');
	const layout = storedZipLayout(entries, limits);
	const stamp = dosTime(timestamp);
	const records = await storedZipRecordsForBlob(layout.records);
	const parts: BlobPart[] = [];
	const offsets: number[] = [];
	let offset = 0;

	for (const record of records) {
		offsets.push(offset);
		parts.push(
			localFileHeader(record, stamp) as unknown as BlobPart,
			record.name as unknown as BlobPart,
			...record.dataParts
		);
		offset += 30 + record.name.length + record.data.length;
	}

	const centralOffset = offset;
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		parts.push(
			centralDirectoryHeader(
				record,
				stamp,
				offsets[index]
			) as unknown as BlobPart,
			record.name as unknown as BlobPart
		);
		offset += 46 + record.name.length;
	}
	parts.push(
		endOfCentralDirectory(
			records.length,
			layout.centralSize,
			centralOffset
		) as unknown as BlobPart
	);

	await yieldToEventLoop();
	const archive = new Blob(parts, {type: 'application/zip'});

	// Ensure a timer scheduled before final Blob assembly observes that tail
	// before the archive promise resolves to its renderer caller.
	await yieldToEventLoop();
	return archive;
}

function stableJson(value: unknown): string {
	if (Array.isArray(value))
		return `[${value
			.map(item => (item === undefined ? 'null' : stableJson(item)))
			.join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => bytewiseCompare(a, b))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(',')}}`;
	}
	return value === undefined ? 'null' : JSON.stringify(value);
}

function deduplicatePackageAssets(assets: PackageExportAsset[]) {
	const byLogicalPath = new Map<string, PackageExportAsset>();

	for (const asset of assets) {
		validatePackagePath(asset.logicalPath);
		if (!asset.logicalPath.startsWith('assets/'))
			portabilityError(
				asset.logicalPath,
				'asset paths must remain under assets/'
			);
		if (
			asset.status === 'included' &&
			asset.archivePath !== asset.logicalPath
		) {
			portabilityError(
				asset.archivePath,
				'archive paths must preserve the exact logical asset path'
			);
		}

		const previous = byLogicalPath.get(asset.logicalPath);

		if (!previous) {
			byLogicalPath.set(asset.logicalPath, asset);
			continue;
		}

		const equivalent =
			previous.status === asset.status &&
			previous.requiredByStaticReference === asset.requiredByStaticReference &&
			(previous.status === 'included' && asset.status === 'included'
				? previous.archivePath === asset.archivePath &&
					previous.sha256 === asset.sha256 &&
					previous.sizeBytes === asset.sizeBytes
				: previous.status === 'failed' &&
					asset.status === 'failed' &&
					previous.reasonCode === asset.reasonCode &&
					previous.reasonMessage === asset.reasonMessage);

		if (!equivalent) {
			throw new Error(
				`Package asset "${asset.logicalPath}" has conflicting results.`
			);
		}
	}

	return [...byLogicalPath.values()].sort((left, right) =>
		bytewiseCompare(left.logicalPath, right.logicalPath)
	);
}

function manifestSafeString(
	value: string,
	options: {
		redactAbsolutePosix?: boolean;
		redactProtocolRelative?: boolean;
		redactTraversal?: boolean;
	} = {}
) {
	if (
		/file:(?:\/\/)?/i.test(value) ||
		/(?:^|[\s"'(])[A-Za-z]:[\\/]/.test(value) ||
		/(?:^|[\s"'(])\\\\[^\s\\]+\\[^\s]+/.test(value) ||
		(options.redactProtocolRelative !== false &&
			/(?:^|[\s"'(])\/\/[^\s/]+\/[^\s]+/.test(value)) ||
		(options.redactTraversal !== false &&
			/(?:^|[\s"'(])\.\.[\\/]/.test(value)) ||
		(options.redactAbsolutePosix !== false &&
			/(?:^|[\s"'(])\/(?!\/)[^\s"'<>]+/.test(value))
	) {
		return '[redacted-local-path]';
	}

	return value;
}

function manifestSafeValue(value: unknown): unknown {
	if (typeof value === 'string') return manifestSafeString(value);
	if (Array.isArray(value)) return value.map(manifestSafeValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([, item]) => item !== undefined)
				.map(([key, item]) => [key, manifestSafeValue(item)])
		);
	}
	return value;
}

function dependencyCompare(
	left: PackageExportDependencyAssessment,
	right: PackageExportDependencyAssessment
) {
	for (const [a, b] of [
		[left.original, right.original],
		[left.kind, right.kind],
		[left.disposition, right.disposition],
		[left.sourceLocation ?? '', right.sourceLocation ?? '']
	] as const) {
		const comparison = bytewiseCompare(a, b);

		if (comparison !== 0) return comparison;
	}

	return 0;
}

export async function createStoryBuildPackageArchive(
	input: StoryBuildPackageArchiveInput
): Promise<StoryBuildPackageArchive> {
	if (typeof Blob === 'undefined')
		throw new Error('Package archive creation requires Blob support.');
	const limits = resolvedPackageLimits(input.limits);
	const generatedAt = input.generatedAt
		? new Date(input.generatedAt)
		: input.clock
			? input.clock()
			: new Date();
	if (Number.isNaN(generatedAt.valueOf()))
		throw new Error('generatedAt must be a valid date.');
	const packageAssets = deduplicatePackageAssets(input.assets);
	const inventoryIssues = (input.inventoryIssues ?? [])
		.map(issue => ({
			path: manifestSafeString(issue.path),
			reasonCode: manifestSafeString(issue.reasonCode),
			reasonMessage: manifestSafeString(issue.reasonMessage)
		}))
		.sort((left, right) => {
			for (const [a, b] of [
				[left.path, right.path],
				[left.reasonCode, right.reasonCode],
				[left.reasonMessage, right.reasonMessage]
			] as const) {
				const comparison = bytewiseCompare(a, b);

				if (comparison !== 0) return comparison;
			}

			return 0;
		});
	for (const asset of packageAssets)
		validatePackagePath(asset.logicalPath, limits);
	const included = packageAssets.filter(
		(asset): asset is PackageExportIncludedAsset => asset.status === 'included'
	);
	validatePackagePathCollisions(
		included.map(asset => asset.archivePath),
		limits
	);
	const assetPaths = planPackageAssetPaths(
		included.map(asset => asset.archivePath),
		limits
	);
	const byPath = new Map(included.map(asset => [asset.archivePath, asset]));
	const assetEntries: PackageExportEntry[] = assetPaths.map(path => ({
		bytes: byPath.get(path)!.bytes,
		mediaType: byPath.get(path)!.mediaType,
		path
	}));
	const canonicalEntries = [...input.canonicalSource].sort((a, b) =>
		bytewiseCompare(a.path, b.path)
	);
	const derivedEntries = [...input.derivedOutputs].sort((a, b) =>
		bytewiseCompare(a.path, b.path)
	);
	const outputEntries = [...canonicalEntries, ...derivedEntries];
	validatePackagePathCollisions(
		[
			...outputEntries.map(entry => entry.path),
			...assetEntries.map(entry => entry.path),
			packageManifestPath,
			checksumsPath
		],
		limits
	);
	if (
		outputEntries.some(
			entry =>
				entry.path === packageManifestPath || entry.path === checksumsPath
		)
	)
		throw new Error(
			'Output entries may not use reserved package metadata paths.'
		);
	const signedEntries = [...outputEntries, ...assetEntries].sort((a, b) =>
		bytewiseCompare(a.path, b.path)
	);
	const assetBytes = assetEntries.reduce(
		(total, entry) => total + bytes(entry.bytes).length,
		0
	);
	const generatedBytes = outputEntries.reduce(
		(total, entry) => total + bytes(entry.bytes).length,
		0
	);
	if (assetEntries.length > limits.maxAssetFileCount)
		throw new Error('Asset file count exceeds the applied package limit.');
	for (const entry of assetEntries) {
		if (bytes(entry.bytes).length > limits.maxAssetFileBytes)
			throw new Error(
				`Asset "${entry.path}" exceeds the applied per-file package limit.`
			);
	}
	if (assetBytes > limits.maxAssetTotalBytes)
		throw new Error('Asset bytes exceed the applied package total limit.');
	if (generatedBytes > limits.maxGeneratedBytes)
		throw new Error('Generated output bytes exceed the applied package limit.');
	const describe = async (entry: PackageExportEntry) => ({
		...(entry.mediaType === undefined ? {} : {mediaType: entry.mediaType}),
		path: entry.path,
		sha256: await sha256Hex(entry.bytes),
		sizeBytes: bytes(entry.bytes).length
	});
	const canonicalManifest = await Promise.all(canonicalEntries.map(describe));
	const derivedManifest = await Promise.all(derivedEntries.map(describe));
	const assetManifest = await Promise.all(
		packageAssets.map(async asset => {
			if (asset.status === 'failed')
				return {
					logicalPath: asset.logicalPath,
					reasonCode: asset.reasonCode,
					reasonMessage: manifestSafeString(asset.reasonMessage),
					requiredByStaticReference: asset.requiredByStaticReference,
					status: asset.status
				} as const;
			if (!/^[0-9a-f]{64}$/.test(asset.sha256))
				throw new Error(
					`Asset checksum is invalid for "${asset.logicalPath}".`
				);
			if (bytes(asset.bytes).length !== asset.sizeBytes)
				throw new Error(`Asset size mismatch for "${asset.logicalPath}".`);
			const actualSha256 = await sha256Hex(asset.bytes);

			if (actualSha256 !== asset.sha256)
				throw new Error(`Asset checksum mismatch for "${asset.logicalPath}".`);
			return {
				archivePath: asset.archivePath,
				logicalPath: asset.logicalPath,
				requiredByStaticReference: asset.requiredByStaticReference,
				sha256: actualSha256,
				sizeBytes: asset.sizeBytes,
				status: asset.status
			} as const;
		})
	);
	assetManifest.sort((left, right) =>
		bytewiseCompare(left.logicalPath, right.logicalPath)
	);
	const failedProjectAssets = packageAssets.filter(
		asset =>
			asset.status === 'failed' &&
			(asset.reasonCode !== 'excluded' || asset.requiredByStaticReference)
	);
	const defaultCompleteness: PackageExportCompleteness = {
		copiedAssetContents: 'not-evaluated',
		dynamicDependencies: 'not-evaluated',
		projectAssetBytes:
			failedProjectAssets.length === 0 && inventoryIssues.length === 0
				? 'complete'
				: 'incomplete',
		staticRuntimeDependencies: 'unknown'
	};
	const completeness = input.completeness ?? defaultCompleteness;

	if (
		completeness.dynamicDependencies !== 'not-evaluated' ||
		!['not-evaluated', 'partially-evaluated'].includes(
			completeness.copiedAssetContents
		) ||
		!['complete', 'incomplete', 'unknown'].includes(
			completeness.staticRuntimeDependencies
		) ||
		!['complete', 'incomplete'].includes(completeness.projectAssetBytes)
	) {
		throw new Error('Package completeness contains an invalid scoped status.');
	}
	if (
		defaultCompleteness.projectAssetBytes === 'incomplete' &&
		completeness.projectAssetBytes === 'complete'
	) {
		throw new Error(
			'Package completeness cannot claim complete project asset bytes when asset or inventory failures exist.'
		);
	}
	if (
		completeness.staticRuntimeDependencies === 'complete' &&
		(input.dependencies ?? []).some(
			dependency =>
				dependency.kind !== 'navigation' &&
				dependency.kind !== 'dynamic-unknown' &&
				dependency.disposition !== 'packaged'
		)
	) {
		throw new Error(
			'Package completeness cannot claim complete static runtime dependencies while a runtime dependency is not packaged.'
		);
	}
	const dependencies = (input.dependencies ?? [])
		.map(dependency => ({
			disposition: dependency.disposition,
			kind: dependency.kind,
			original: manifestSafeString(dependency.original, {
				redactAbsolutePosix: dependency.kind === 'unsafe-local',
				redactProtocolRelative: dependency.kind === 'unsafe-local',
				redactTraversal: dependency.kind === 'unsafe-local'
			}),
			...(dependency.sourceLocation === undefined
				? {}
				: {
						sourceLocation: manifestSafeString(dependency.sourceLocation)
					})
		}))
		.sort(dependencyCompare);
	const manifest: StoryBuildPackageManifestV2 = {
		assets: assetManifest,
		canonicalSource: canonicalManifest.map(({path, sha256, sizeBytes}) => ({
			path,
			sha256,
			sizeBytes
		})),
		completeness,
		dependencies,
		derivedOutputs: derivedManifest,
		generatedAt: generatedAt.toISOString(),
		inventoryIssues,
		limits,
		snapshot: input.snapshot
			? (manifestSafeValue(input.snapshot) as PackageExportSnapshot)
			: null,
		story: manifestSafeValue(input.story) as Record<string, unknown>,
		type: 'twine.rs/story-build-package',
		version: 2
	};
	const manifestSource = `${stableJson(manifest)}\n`;
	const manifestHash = await sha256Hex(manifestSource);
	const entryHashes = new Map<string, string>([
		...canonicalManifest.map(
			entry => [entry.path, entry.sha256] as [string, string]
		),
		...derivedManifest.map(
			entry => [entry.path, entry.sha256] as [string, string]
		),
		...assetManifest
			.filter(
				(asset): asset is StoryBuildPackageManifestIncludedAsset =>
					asset.status === 'included'
			)
			.map(asset => [asset.archivePath, asset.sha256] as [string, string]),
		[packageManifestPath, manifestHash]
	]);
	const checksumLines = await Promise.all(
		[
			...signedEntries,
			{bytes: encoder.encode(manifestSource), path: packageManifestPath}
		]
			.sort((a, b) => bytewiseCompare(a.path, b.path))
			.map(entry => {
				const checksum = entryHashes.get(entry.path);

				if (!checksum)
					throw new Error(`Package entry "${entry.path}" was not hashed.`);
				return `${checksum}  ${entry.path}`;
			})
	);
	const checksumSource = `${checksumLines.join('\n')}\n`;
	const archiveEntries = [
		...signedEntries,
		{bytes: encoder.encode(manifestSource), path: packageManifestPath},
		{bytes: encoder.encode(checksumSource), path: checksumsPath}
	].sort((a, b) => bytewiseCompare(a.path, b.path));
	const archive = await createStoredZipBlob(
		archiveEntries,
		generatedAt,
		limits
	);
	return {
		archive,
		archiveEntryPaths: archiveEntries.map(entry => entry.path),
		checksumSource,
		manifest,
		manifestHash,
		manifestSource
	};
}
