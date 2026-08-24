import {randomUUID} from 'crypto';
import {extname} from 'path';
import {protocol} from 'electron';
import type {StagedScratchPreviewPackage} from './scratch-file';
import {releaseScratchPreviewPackage} from './scratch-file';

export const storyPreviewScheme = 'twine-preview';
export const maxStoryPreviewPackages = 64;
const storyPreviewTokenPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encodedSeparatorPattern = /%(?:00|2f|5c)/i;
const stateCleanupPath = '__twine-preview-clear-state';
const stateCleanupAcknowledgement = 'twine-preview-state-cleared';

interface StoryPreviewPackageFile {
	bytes: Uint8Array;
	mediaType?: string;
	sizeBytes: number;
}

interface StoryPreviewPackageEntry {
	cleanupTickets: Set<string>;
	files: Map<string, StoryPreviewPackageFile>;
	onRelease?: () => Promise<void> | void;
}

interface StoryPreviewStateCleanupTicket {
	operationId: string;
	packageToken: string;
}

export interface StoryPreviewStateCleanup {
	operationId: string;
	url: string;
}

interface StoryPreviewRequest {
	method?: string;
	url: string;
	headers?: {get(name: string): string | null};
}

const previewPackages = new Map<string, StoryPreviewPackageEntry>();
const stateCleanupTickets = new Map<string, StoryPreviewStateCleanupTicket>();
let initialized = false;

/** Must run before Electron becomes ready so the origin receives normal web storage. */
export function registerStoryPreviewScheme() {
	protocol.registerSchemesAsPrivileged([
		{
			privileges: {
				allowServiceWorkers: false,
				corsEnabled: true,
				secure: true,
				standard: true,
				stream: true,
				supportFetchAPI: true
			},
			scheme: storyPreviewScheme
		}
	]);
}

function responseHeaders(
	contentType: string,
	contentLength: number,
	extra?: Record<string, string>
) {
	return {
		'accept-ranges': 'bytes',
		'cache-control': 'no-store',
		'content-length': String(contentLength),
		'content-type': contentType,
		'x-content-type-options': 'nosniff',
		...extra
	};
}

function errorResponse(status: number, message: string, method = 'GET') {
	const bytes = Buffer.from(message, 'utf8');

	return new Response(method === 'HEAD' ? null : responseBody(bytes), {
		headers: responseHeaders('text/plain; charset=utf-8', bytes.byteLength),
		status
	});
}

function stateCleanupResponse(operationId: string, method: string) {
	const nonce = randomUUID().replaceAll('-', '');
	const bytes = Buffer.from(stateCleanupHtml(operationId, nonce), 'utf8');

	return new Response(method === 'HEAD' ? null : responseBody(bytes), {
		headers: responseHeaders('text/html; charset=utf-8', bytes.byteLength, {
			'content-security-policy': `base-uri 'none'; default-src 'none'; form-action 'none'; script-src 'nonce-${nonce}'`
		}),
		status: 200
	});
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength
	) as ArrayBuffer;
}

function normalizeRequestPath(pathname: string) {
	if (!pathname.startsWith('/') || encodedSeparatorPattern.test(pathname)) {
		return undefined;
	}

	let decoded: string;

	try {
		decoded = decodeURIComponent(pathname.slice(1));
	} catch {
		return undefined;
	}

	if (decoded === '') {
		return 'index.html';
	}

	const segments = decoded.split('/');

	if (
		decoded.includes('\\') ||
		decoded.includes('\0') ||
		decoded.startsWith('/') ||
		/^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded) ||
		segments.some(
			segment => segment === '' || segment === '.' || segment === '..'
		)
	) {
		return undefined;
	}

	return segments.join('/');
}

function requestTarget(url: string) {
	const rawPathStart = url.indexOf('/', `${storyPreviewScheme}://`.length);
	const rawPath =
		rawPathStart === -1 ? '' : url.slice(rawPathStart).split(/[?#]/, 1)[0];

	if (/(?:^|\/)(?:\.|%2e){1,2}(?:\/|%2f|%5c|$)/i.test(rawPath)) {
		return undefined;
	}

	let parsed: URL;

	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}

	if (
		parsed.protocol !== `${storyPreviewScheme}:` ||
		!storyPreviewTokenPattern.test(parsed.hostname) ||
		parsed.username !== '' ||
		parsed.password !== '' ||
		parsed.port !== ''
	) {
		return undefined;
	}

	const outputPath = normalizeRequestPath(parsed.pathname);

	return outputPath
		? {outputPath, token: parsed.hostname.toLowerCase()}
		: undefined;
}

function exactPackageUrl(url: string) {
	const target = requestTarget(url);

	if (!target || target.outputPath !== 'index.html') {
		return undefined;
	}

	const expectedUrl = `${storyPreviewScheme}://${target.token}/index.html`;

	return url === expectedUrl ? target : undefined;
}

function stateCleanupTicket(url: string) {
	const target = requestTarget(url);

	if (
		!target ||
		!target.outputPath.startsWith(`${stateCleanupPath}/`) ||
		target.outputPath.split('/').length !== 2
	) {
		return undefined;
	}

	const ticket = target.outputPath.slice(stateCleanupPath.length + 1);
	const record = stateCleanupTickets.get(ticket);

	if (
		!record ||
		record.packageToken !== target.token ||
		url !==
			`${storyPreviewScheme}://${target.token}/${stateCleanupPath}/${ticket}`
	) {
		return undefined;
	}

	return {record, ticket};
}

function stateCleanupHtml(operationId: string, nonce: string) {
	const serializedOperationId = JSON.stringify(operationId).replace(
		/[<>&\u2028\u2029]/g,
		character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
	);
	const serializedAcknowledgement = JSON.stringify(stateCleanupAcknowledgement);

	return `<!doctype html><meta charset="utf-8"><script nonce="${nonce}">void async function(){localStorage.clear();sessionStorage.clear();const cacheNames=await caches.keys();await Promise.all(cacheNames.map(name=>caches.delete(name)));const databases=await indexedDB.databases();await Promise.all(databases.map(database=>database.name?new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(database.name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('IndexedDB cleanup blocked'));}):Promise.resolve()));if(localStorage.length!==0||sessionStorage.length!==0||(await caches.keys()).length!==0||(await indexedDB.databases()).some(database=>database.name))throw new Error('Preview state cleanup incomplete');window.parent.postMessage({type:${serializedAcknowledgement},operationId:${serializedOperationId}},'*');}();</script>`;
}

function mediaType(outputPath: string) {
	switch (extname(outputPath).toLowerCase()) {
		case '.aac':
			return 'audio/aac';
		case '.avif':
			return 'image/avif';
		case '.css':
			return 'text/css; charset=utf-8';
		case '.gif':
			return 'image/gif';
		case '.html':
		case '.htm':
			return 'text/html; charset=utf-8';
		case '.ico':
			return 'image/x-icon';
		case '.jpeg':
		case '.jpg':
			return 'image/jpeg';
		case '.js':
		case '.mjs':
			return 'text/javascript; charset=utf-8';
		case '.json':
			return 'application/json; charset=utf-8';
		case '.mp3':
			return 'audio/mpeg';
		case '.mp4':
			return 'video/mp4';
		case '.oga':
		case '.ogg':
			return 'audio/ogg';
		case '.ogv':
			return 'video/ogg';
		case '.otf':
			return 'font/otf';
		case '.pdf':
			return 'application/pdf';
		case '.png':
			return 'image/png';
		case '.svg':
			return 'image/svg+xml';
		case '.ttf':
			return 'font/ttf';
		case '.txt':
			return 'text/plain; charset=utf-8';
		case '.wasm':
			return 'application/wasm';
		case '.wav':
			return 'audio/wav';
		case '.webm':
			return 'video/webm';
		case '.webp':
			return 'image/webp';
		case '.woff':
			return 'font/woff';
		case '.woff2':
			return 'font/woff2';
		default:
			return 'application/octet-stream';
	}
}

interface ByteRange {
	end: number;
	start: number;
}

function requestedRange(value: string | null, size: number): ByteRange | null {
	if (!value) {
		return null;
	}
	if (value.includes(',')) {
		throw new Error('Multiple byte ranges are not supported.');
	}

	const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());

	if (!match || (match[1] === '' && match[2] === '') || size === 0) {
		throw new Error('Invalid byte range.');
	}

	let start: number;
	let end: number;

	if (match[1] === '') {
		const suffixLength = Number(match[2]);

		if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
			throw new Error('Invalid byte range.');
		}
		start = Math.max(0, size - suffixLength);
		end = size - 1;
	} else {
		start = Number(match[1]);
		end = match[2] === '' ? size - 1 : Number(match[2]);

		if (
			!Number.isSafeInteger(start) ||
			!Number.isSafeInteger(end) ||
			start < 0 ||
			start >= size ||
			end < start
		) {
			throw new Error('Invalid byte range.');
		}
		end = Math.min(end, size - 1);
	}

	return {end, start};
}

export async function handleStoryPreviewRequest(request: StoryPreviewRequest) {
	const method = (request.method ?? 'GET').toUpperCase();

	if (method !== 'GET' && method !== 'HEAD') {
		return errorResponse(405, 'Method not allowed.', method);
	}

	const target = requestTarget(request.url);
	const isStateCleanupRequest = target?.outputPath.startsWith(
		`${stateCleanupPath}/`
	);
	const cleanup = stateCleanupTicket(request.url);

	if (cleanup) {
		if (method === 'GET') {
			stateCleanupTickets.delete(cleanup.ticket);
			previewPackages
				.get(cleanup.record.packageToken)
				?.cleanupTickets.delete(cleanup.ticket);
		}

		return stateCleanupResponse(cleanup.record.operationId, method);
	}

	if (isStateCleanupRequest) {
		return errorResponse(404, 'Preview not found.', method);
	}

	const entry = target ? previewPackages.get(target.token) : undefined;
	const file = target ? entry?.files.get(target.outputPath) : undefined;

	if (!target || !entry || !file) {
		return errorResponse(404, 'Preview not found.', method);
	}

	let range: ByteRange | null;

	try {
		range = requestedRange(
			request.headers?.get('range') ?? null,
			file.sizeBytes
		);
	} catch {
		return new Response(null, {
			headers: responseHeaders('text/plain; charset=utf-8', 0, {
				'content-range': `bytes */${file.sizeBytes}`
			}),
			status: 416
		});
	}

	// The constrained native preview reader deliberately labels non-media
	// support files as generic bytes. Use the allowlisted output extension for
	// browser subresources such as CSS and JavaScript; `nosniff` correctly
	// rejects an octet-stream stylesheet.
	const contentType =
		file.mediaType && file.mediaType !== 'application/octet-stream'
			? file.mediaType
			: mediaType(target.outputPath);

	if (method === 'HEAD') {
		if (range) {
			const contentLength = range.end - range.start + 1;

			return new Response(null, {
				headers: responseHeaders(contentType, contentLength, {
					'content-range': `bytes ${range.start}-${range.end}/${file.sizeBytes}`
				}),
				status: 206
			});
		}

		return new Response(null, {
			headers: responseHeaders(contentType, file.sizeBytes),
			status: 200
		});
	}

	const bytes = file.bytes;

	if (bytes.byteLength !== file.sizeBytes) {
		return errorResponse(404, 'Preview file is unavailable.');
	}

	if (range) {
		const body = bytes.slice(range.start, range.end + 1);

		return new Response(responseBody(body), {
			headers: responseHeaders(contentType, body.byteLength, {
				'content-range': `bytes ${range.start}-${range.end}/${bytes.byteLength}`
			}),
			status: 206
		});
	}

	return new Response(responseBody(bytes), {
		headers: responseHeaders(contentType, bytes.byteLength),
		status: 200
	});
}

export function initStoryPreviewProtocol() {
	if (initialized) {
		return;
	}

	initialized = true;
	protocol.handle(storyPreviewScheme, handleStoryPreviewRequest);
}

function registerPackage(entry: StoryPreviewPackageEntry) {
	if (previewPackages.size >= maxStoryPreviewPackages) {
		throw new Error(
			`No more than ${maxStoryPreviewPackages} live story preview packages may be open.`
		);
	}

	const token = randomUUID();

	previewPackages.set(token, entry);
	return `${storyPreviewScheme}://${token}/index.html`;
}

/**
 * Registers an exact staged scratch package. The caller owns the returned URL
 * and must release it, including on failed window creation or replacement.
 */
export function registerStoryPreviewPackage(
	stagedPackage: StagedScratchPreviewPackage
) {
	const files = new Map<string, StoryPreviewPackageFile>();

	for (const file of stagedPackage.files) {
		files.set(file.outputPath, {
			bytes: file.bytes,
			mediaType: file.mediaType,
			sizeBytes: file.sizeBytes
		});
	}

	return registerPackage({
		cleanupTickets: new Set(),
		files,
		onRelease: () => releaseScratchPreviewPackage(stagedPackage)
	});
}

/**
 * Registers a one-use, package-origin cleanup page. The returned URL is only
 * valid while its package remains live and must be released if it is abandoned.
 */
export function registerStoryPreviewStateCleanup(
	packageUrl: string,
	operationId: string = randomUUID()
): StoryPreviewStateCleanup {
	const target = exactPackageUrl(packageUrl);
	const entry = target ? previewPackages.get(target.token) : undefined;

	if (!target || !entry) {
		throw new Error(
			'State cleanup requires an exact live story preview package URL.'
		);
	}

	if (
		typeof operationId !== 'string' ||
		operationId.length === 0 ||
		operationId.length > 128
	) {
		throw new Error('State cleanup requires a bounded operation ID.');
	}

	const ticket = randomUUID();

	entry.cleanupTickets.add(ticket);
	stateCleanupTickets.set(ticket, {operationId, packageToken: target.token});

	return {
		operationId,
		url: `${storyPreviewScheme}://${target.token}/${stateCleanupPath}/${ticket}`
	};
}

/** Cancels an unused cleanup page. Cancellation is idempotent. */
export function releaseStoryPreviewStateCleanup(url: string) {
	const cleanup = stateCleanupTicket(url);

	if (!cleanup) {
		return;
	}

	stateCleanupTickets.delete(cleanup.ticket);
	previewPackages
		.get(cleanup.record.packageToken)
		?.cleanupTickets.delete(cleanup.ticket);
}

export async function releaseStoryPreviewPackage(url: string) {
	const target = requestTarget(url);
	const entry = target ? previewPackages.get(target.token) : undefined;

	if (!target || !entry) {
		return;
	}

	previewPackages.delete(target.token);

	for (const ticket of entry.cleanupTickets) {
		stateCleanupTickets.delete(ticket);
	}
	await entry.onRelease?.();
}

export function registeredStoryPreviewPackageCount() {
	return previewPackages.size;
}

/** Test-only reset; production cleanup releases packages through their owners. */
export async function resetStoryPreviewPackagesForTests() {
	const entries = [...previewPackages.values()];

	previewPackages.clear();
	stateCleanupTickets.clear();
	await Promise.all(entries.map(entry => entry.onRelease?.()));
	initialized = false;
}
