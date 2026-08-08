import type {CoreAssetInventoryEntry} from '../core/bindings/CoreAssetInventoryEntry';
import type {CoreAssetReference} from '../core/bindings/CoreAssetReference';
import {
	canonicalLogicalAssetPath,
	classifyHtmlAssetAttribute,
	classifyHtmlLinkRelations,
	classifySvgHrefElement,
	declarativeRefreshUrlRange,
	srcsetCandidateRanges,
	urlPreprocessedValue
} from '../core/asset-paths';
import type {StoryWithDocuments} from '../store/stories';
import type {
	PackageExportBytes,
	PackageExportDependencyAssessment
} from './package-export';

const encoder = new TextEncoder();
const protocol = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const windowsAbsolutePath = /^[A-Za-z]:[\\/]/;
const svgCssPresentationAttributes = [
	'clip-path',
	'cursor',
	'fill',
	'filter',
	'marker',
	'marker-end',
	'marker-mid',
	'marker-start',
	'mask',
	'stroke'
] as const;

export class PackageAssetReferenceRewriteError extends Error {
	readonly code = 'PACKAGE_ASSET_REFERENCE_REWRITE_FAILED';

	constructor(message: string) {
		super(message);
		this.name = 'PackageAssetReferenceRewriteError';
	}
}

export interface PackageAssetReferenceRewriteResult {
	rewrittenAssetCount: number;
	rewrittenReferenceCount: number;
	story: StoryWithDocuments;
}

type MutableSourceDocument = {
	get(): string;
	label: string;
	set(value: string): void;
};

type ScheduledReplacement = {
	end: number;
	replacement: string;
	start: number;
};

function failRewrite(message: string): never {
	throw new PackageAssetReferenceRewriteError(message);
}

function cloneStory(story: StoryWithDocuments): StoryWithDocuments {
	return {
		...story,
		lastUpdate: new Date(story.lastUpdate),
		passages: story.passages.map(passage => ({
			...passage,
			tags: [...passage.tags]
		})),
		tagColors: {...story.tagColors},
		tags: [...story.tags]
	};
}

function sourceDocuments(story: StoryWithDocuments) {
	const documents = new Map<string, MutableSourceDocument>();

	for (const passage of story.passages) {
		const document: MutableSourceDocument = {
			get: () => passage.text,
			label: `passage "${passage.name}"`,
			set: value => {
				passage.text = value;
			}
		};

		documents.set(passage.id, document);
	}

	const script: MutableSourceDocument = {
		get: () => story.script,
		label: 'story script',
		set: value => {
			story.script = value;
		}
	};
	const stylesheet: MutableSourceDocument = {
		get: () => story.stylesheet,
		label: 'story stylesheet',
		set: value => {
			story.stylesheet = value;
		}
	};

	documents.set(`${story.id}:script`, script);
	documents.set(`${story.id}:stylesheet`, stylesheet);
	return {documents, script, stylesheet};
}

function documentForReference(
	reference: CoreAssetReference,
	story: StoryWithDocuments,
	sources: ReturnType<typeof sourceDocuments>
) {
	if (reference.passageId) {
		return reference.sourceId === reference.passageId
			? sources.documents.get(reference.passageId)
			: undefined;
	}

	const direct = sources.documents.get(reference.sourceId);

	if (direct) return direct;
	if (reference.sourceId === `${story.id}:stylesheet`) {
		return sources.stylesheet;
	}
	if (reference.sourceId === `${story.id}:script`) {
		return sources.script;
	}
}

function encodedArchiveUrl(logicalPath: string) {
	return logicalPath
		.split('/')
		.map(component =>
			encodeURIComponent(component).replace(
				/[!'()*]/g,
				character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
			)
		)
		.join('/');
}

/**
 * Clones a story and rewrites authoritative, indexed project-asset references
 * to portable URLs in the package's `assets/` directory. Indexed source ranges
 * are treated as a snapshot contract: stale, overlapping, or ambiguous ranges
 * fail the operation instead of producing a plausibly corrupt build.
 */
export function rewriteStoryAssetReferencesForPackage(
	story: StoryWithDocuments,
	assetInventory: CoreAssetInventoryEntry[]
): PackageAssetReferenceRewriteResult {
	const transformedStory = cloneStory(story);
	const sources = sourceDocuments(transformedStory);
	const replacements = new Map<MutableSourceDocument, ScheduledReplacement[]>();
	const rewrittenAssets = new Set<string>();
	let rewrittenReferenceCount = 0;

	for (const asset of assetInventory) {
		const logicalPath = canonicalLogicalAssetPath(asset.path);

		if (!logicalPath || !logicalPath.startsWith('assets/')) {
			failRewrite(
				`Managed asset path "${asset.path}" is not a canonical package asset path.`
			);
		}
		if (asset.referenceCount !== asset.references.length) {
			failRewrite(
				`Managed asset "${logicalPath}" has ${asset.referenceCount} references but only ${asset.references.length} indexed source ranges.`
			);
		}

		const archiveUrl = encodedArchiveUrl(logicalPath);

		for (const reference of asset.references) {
			const document = documentForReference(
				reference,
				transformedStory,
				sources
			);

			if (!document) {
				failRewrite(
					`Asset reference for "${logicalPath}" points to unknown source "${reference.sourceId}".`
				);
			}

			const source = document.get();
			if (
				!Number.isSafeInteger(reference.start) ||
				!Number.isSafeInteger(reference.end) ||
				reference.start < 0 ||
				reference.end <= reference.start ||
				reference.end > source.length
			) {
				failRewrite(
					`Asset reference for "${logicalPath}" has an invalid range in ${document.label}.`
				);
			}
			if (source.slice(reference.start, reference.end) !== reference.original) {
				failRewrite(
					`Asset reference for "${logicalPath}" is stale in ${document.label}.`
				);
			}
			if (canonicalLogicalAssetPath(reference.path) !== logicalPath) {
				failRewrite(
					`Asset reference "${reference.original}" does not resolve to managed asset "${logicalPath}".`
				);
			}

			const replacement =
				archiveUrl + (reference.query ?? '') + (reference.fragment ?? '');
			const scheduled = replacements.get(document) ?? [];
			const duplicate = scheduled.find(
				item => item.start === reference.start && item.end === reference.end
			);

			if (duplicate) {
				if (duplicate.replacement !== replacement) {
					failRewrite(
						`Conflicting asset references share a source range in ${document.label}.`
					);
				}
				continue;
			}

			scheduled.push({
				end: reference.end,
				replacement,
				start: reference.start
			});
			replacements.set(document, scheduled);
			rewrittenAssets.add(logicalPath);
			rewrittenReferenceCount++;
		}
	}

	for (const [document, scheduled] of replacements) {
		const ascending = [...scheduled].sort(
			(left, right) => left.start - right.start || left.end - right.end
		);

		for (let index = 1; index < ascending.length; index++) {
			if (ascending[index].start < ascending[index - 1].end) {
				failRewrite(`Overlapping asset references exist in ${document.label}.`);
			}
		}

		let source = document.get();
		for (const item of ascending.reverse()) {
			source =
				source.slice(0, item.start) + item.replacement + source.slice(item.end);
		}
		document.set(source);
	}

	return {
		rewrittenAssetCount: rewrittenAssets.size,
		rewrittenReferenceCount,
		story: transformedStory
	};
}

export interface PackageDependencyAsset {
	bytes: PackageExportBytes;
	logicalPath: string;
	mediaType?: string;
	requiredByStaticReference?: boolean;
}

export interface PackageDependencyScanLimits {
	maxCandidateBytes?: number;
	maxCandidates?: number;
	maxCssBytes?: number;
	maxCssFiles?: number;
	maxCssFileBytes?: number;
	maxCssNestingDepth?: number;
	maxEmbeddedHtmlDepth?: number;
	maxHtmlBytes?: number;
	maxHtmlElements?: number;
	maxScanIssues?: number;
}

export interface PackageDependencyScanIssue {
	code:
		| 'candidate-limit'
		| 'css-file-limit'
		| 'css-nesting-limit'
		| 'css-source-limit'
		| 'html-depth-limit'
		| 'html-element-limit'
		| 'html-source-limit'
		| 'invalid-css-utf8'
		| 'parser-unavailable'
		| 'scan-issue-limit'
		| 'unrecognized-static-reference';
	message: string;
	sourceLocation: string;
}

export interface PackageDependencyAssessmentResult {
	copiedAssetContents: 'not-evaluated' | 'partially-evaluated';
	dependencies: PackageExportDependencyAssessment[];
	scanIssues: PackageDependencyScanIssue[];
	staticRuntimeDependencies: 'complete' | 'incomplete' | 'unknown';
}

export interface AssessPackageDependenciesOptions {
	assets: PackageDependencyAsset[];
	html: string;
	htmlPath?: string;
	limits?: PackageDependencyScanLimits;
	packagedPaths?: string[];
}

const defaultScanLimits: Required<PackageDependencyScanLimits> = {
	maxCandidateBytes: 4096,
	maxCandidates: 4096,
	maxCssBytes: 8 * 1024 * 1024,
	maxCssFiles: 256,
	maxCssFileBytes: 1024 * 1024,
	maxCssNestingDepth: 256,
	maxEmbeddedHtmlDepth: 8,
	maxHtmlBytes: 8 * 1024 * 1024,
	maxHtmlElements: 20_000,
	maxScanIssues: 256
};

function resolvedScanLimits(limits: PackageDependencyScanLimits = {}) {
	const result = {...defaultScanLimits, ...limits};

	for (const [name, value] of Object.entries(result)) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new Error(
				`Package dependency limit "${name}" must be a nonnegative safe integer.`
			);
		}
	}
	return result;
}

function bytes(value: PackageExportBytes) {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function compareUtf8(left: string, right: string) {
	const a = encoder.encode(left);
	const b = encoder.encode(right);

	for (let index = 0; index < Math.min(a.length, b.length); index++) {
		if (a[index] !== b[index]) return a[index] - b[index];
	}
	return a.length - b.length;
}

function compareTuples(left: string[], right: string[]) {
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const compared = compareUtf8(left[index] ?? '', right[index] ?? '');

		if (compared !== 0) return compared;
	}
	return 0;
}

function canonicalPackagePath(path: string) {
	return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

function cssAsset(asset: PackageDependencyAsset) {
	const mediaType = asset.mediaType?.split(';', 1)[0].trim().toLowerCase();
	return (
		mediaType === 'text/css' || asset.logicalPath.toLowerCase().endsWith('.css')
	);
}

type DependencyContext =
	| 'active-data-document'
	| 'active-data-stylesheet'
	| 'automatic-navigation'
	| 'navigation'
	| 'resource';

type MutableAssessmentState = {
	candidateCount: number;
	candidateLimitReported: boolean;
	cssTargetPaths: Set<string>;
	dependencies: PackageExportDependencyAssessment[];
	htmlElementCount: number;
	htmlElementLimitReported: boolean;
	incomplete: boolean;
	issueKeys: Set<string>;
	issueLimitReported: boolean;
	issues: PackageDependencyScanIssue[];
	limits: Required<PackageDependencyScanLimits>;
	linkRelationExtensionReported: boolean;
	oversizedCandidateReported: boolean;
	packagedPaths: Set<string>;
	unknown: boolean;
};

function addDependency(
	state: MutableAssessmentState,
	dependency: PackageExportDependencyAssessment
) {
	state.dependencies.push(dependency);
	if (
		dependency.kind !== 'navigation' &&
		(dependency.disposition === 'external' ||
			dependency.disposition === 'blocked')
	) {
		state.incomplete = true;
	}
}

function addScanIssue(
	state: MutableAssessmentState,
	issue: PackageDependencyScanIssue
) {
	state.unknown = true;
	if (state.issueLimitReported) return;
	const key = JSON.stringify([issue.code, issue.message, issue.sourceLocation]);

	if (state.issueKeys.has(key)) return;
	if (state.issues.length >= state.limits.maxScanIssues) {
		state.issueLimitReported = true;
		const limitIssue: PackageDependencyScanIssue = {
			code: 'scan-issue-limit',
			message: `Static dependency discovery exceeded the ${state.limits.maxScanIssues}-issue retention limit.`,
			sourceLocation: issue.sourceLocation
		};

		state.issues.push(limitIssue);
		state.dependencies.push({
			disposition: 'not-evaluated',
			kind: 'dynamic-unknown',
			original: limitIssue.message,
			sourceLocation: limitIssue.sourceLocation
		});
		return;
	}
	state.issueKeys.add(key);

	state.issues.push(issue);
	state.dependencies.push({
		disposition: 'not-evaluated',
		kind: 'dynamic-unknown',
		original: issue.message,
		sourceLocation: issue.sourceLocation
	});
}

function reserveCandidate(
	state: MutableAssessmentState,
	original: string,
	sourceLocation: string
) {
	if (encoder.encode(original).length > state.limits.maxCandidateBytes) {
		if (!state.oversizedCandidateReported) {
			state.oversizedCandidateReported = true;
			addScanIssue(state, {
				code: 'candidate-limit',
				message: `A static dependency candidate exceeded the ${state.limits.maxCandidateBytes}-byte limit.`,
				sourceLocation
			});
		}
		return false;
	}
	if (state.candidateCount >= state.limits.maxCandidates) {
		if (!state.candidateLimitReported) {
			state.candidateLimitReported = true;
			addScanIssue(state, {
				code: 'candidate-limit',
				message: `Static dependency discovery exceeded the ${state.limits.maxCandidates}-candidate limit.`,
				sourceLocation
			});
		}
		return false;
	}
	state.candidateCount++;
	return true;
}

function strippedUrlPath(original: string) {
	const query = original.indexOf('?');
	const fragment = original.indexOf('#');
	const end =
		query === -1
			? fragment === -1
				? original.length
				: fragment
			: fragment === -1
				? query
				: Math.min(query, fragment);

	return original.slice(0, end);
}

function resolvedLocalPackagePath(original: string, basePath: string) {
	const path = strippedUrlPath(original);
	const base = canonicalPackagePath(basePath).split('/').slice(0, -1);
	const output = [...base];

	if (path === '') return canonicalPackagePath(basePath);
	for (const encodedSegment of path.split('/')) {
		if (!encodedSegment) return null;
		if (encodedSegment === '.') continue;
		let segment: string;

		try {
			segment = decodeURIComponent(encodedSegment);
		} catch {
			return null;
		}
		if (
			segment.includes('/') ||
			segment.includes('\\') ||
			segment.includes('\0')
		) {
			return null;
		}
		if (segment === '..') {
			if (output.length === 0) return null;
			output.pop();
		} else {
			output.push(segment);
		}
	}
	return output.join('/');
}

function isDynamicCandidate(value: string) {
	return /\$\{|\{\{|<%|<<[^>]*>>/.test(value);
}

function assessUrl(
	state: MutableAssessmentState,
	value: string,
	context: DependencyContext,
	basePath: string,
	sourceLocation: string
) {
	const original = value;
	const semantic = urlPreprocessedValue(value);

	if (!semantic || semantic.startsWith('#')) return;
	if (!reserveCandidate(state, original, sourceLocation)) return;
	if (/^data:/i.test(semantic)) {
		if (
			context === 'active-data-document' ||
			context === 'active-data-stylesheet' ||
			context === 'automatic-navigation'
		) {
			addScanIssue(state, {
				code: 'unrecognized-static-reference',
				message:
					'A data URL containing an active document or stylesheet was not evaluated statically.',
				sourceLocation
			});
		}
		return;
	}
	if (/^blob:/i.test(semantic)) {
		addDependency(state, {
			disposition: 'blocked',
			kind: 'unsafe-local',
			original,
			sourceLocation
		});
		return;
	}
	if (isDynamicCandidate(semantic)) {
		addScanIssue(state, {
			code: 'unrecognized-static-reference',
			message: `A dependency expression could not be evaluated statically: ${original}`,
			sourceLocation
		});
		return;
	}

	const isFile = /^file:/i.test(semantic) || windowsAbsolutePath.test(semantic);
	if (isFile) {
		addDependency(state, {
			disposition: 'blocked',
			kind: 'unsafe-local',
			original,
			sourceLocation
		});
		return;
	}

	if (/^javascript:/i.test(semantic)) {
		addDependency(state, {
			disposition: 'not-evaluated',
			kind: 'dynamic-unknown',
			original,
			sourceLocation
		});
		return;
	}

	if (semantic.startsWith('//') || protocol.test(semantic)) {
		addDependency(state, {
			disposition: 'external',
			kind: context === 'navigation' ? 'navigation' : 'remote-resource',
			original,
			sourceLocation
		});
		return;
	}

	if (
		semantic.startsWith('/') ||
		semantic.includes('\\') ||
		semantic.includes('\0')
	) {
		addDependency(state, {
			disposition: 'blocked',
			kind: 'unsafe-local',
			original,
			sourceLocation
		});
		return;
	}

	const resolved = resolvedLocalPackagePath(semantic, basePath);
	if (!resolved) {
		addDependency(state, {
			disposition: 'blocked',
			kind: 'unsafe-local',
			original,
			sourceLocation
		});
		return;
	}

	if (state.packagedPaths.has(resolved)) {
		addDependency(state, {
			disposition: 'packaged',
			kind: 'managed-local',
			original,
			sourceLocation
		});
		return resolved;
	}

	addDependency(state, {
		disposition: 'blocked',
		kind: resolved.startsWith('assets/') ? 'managed-local' : 'unsafe-local',
		original,
		sourceLocation
	});
}

function isCssWhitespace(character: string | undefined) {
	return character !== undefined && /[\t\n\f\r ]/u.test(character);
}

function isCssNameCharacter(character: string | undefined) {
	return character !== undefined && /[A-Za-z0-9_-]/u.test(character);
}

type CssTrivia =
	{end: number; malformed: false} | {end: number; malformed: true};

function skipCssTrivia(source: string, start: number): CssTrivia {
	let cursor = start;

	while (cursor < source.length) {
		if (isCssWhitespace(source[cursor])) {
			cursor++;
			continue;
		}
		if (source[cursor] === '/' && source[cursor + 1] === '*') {
			const end = source.indexOf('*/', cursor + 2);

			if (end === -1) return {end: source.length, malformed: true};
			cursor = end + 2;
			continue;
		}
		break;
	}

	return {end: cursor, malformed: false};
}

type CssName =
	| {end: number; malformed: false; value: string}
	| {end: number; malformed: true};

/** CSS comments are removed before tokenization and can splice identifiers. */
function readCssName(source: string, start: number): CssName {
	let cursor = start;
	let value = '';

	while (cursor < source.length) {
		if (isCssNameCharacter(source[cursor])) {
			value += source[cursor];
			cursor++;
			continue;
		}
		if (source[cursor] === '/' && source[cursor + 1] === '*') {
			const end = source.indexOf('*/', cursor + 2);

			if (end === -1) return {end: source.length, malformed: true};
			cursor = end + 2;
			continue;
		}
		break;
	}

	return {end: cursor, malformed: false, value};
}

type CssString = {
	end: number;
	escaped: boolean;
	terminated: boolean;
	value: string;
};

function readCssString(source: string, start: number): CssString {
	const quote = source[start];
	let cursor = start + 1;
	let escaped = false;
	let value = '';

	while (cursor < source.length) {
		const character = source[cursor];
		if (character === quote) {
			return {end: cursor + 1, escaped, terminated: true, value};
		}
		if (character === '\\') {
			escaped = true;
			if (cursor + 1 >= source.length) {
				return {end: source.length, escaped, terminated: false, value};
			}
			value += source.slice(cursor, cursor + 2);
			cursor += 2;
			continue;
		}
		if (character === '\n' || character === '\r' || character === '\f') {
			return {end: cursor, escaped, terminated: false, value};
		}
		value += character;
		cursor++;
	}

	return {end: source.length, escaped, terminated: false, value};
}

type CssUrl =
	| {end: number; escaped: boolean; malformed: false; value: string}
	| {end: number; escaped: boolean; malformed: true};

function readCssUrl(source: string, start: number): CssUrl {
	const leadingTrivia = skipCssTrivia(source, start);

	if (leadingTrivia.malformed)
		return {end: leadingTrivia.end, escaped: false, malformed: true};
	let cursor = leadingTrivia.end;
	let escaped = false;

	if (source[cursor] === '"' || source[cursor] === "'") {
		const string = readCssString(source, cursor);
		escaped = string.escaped;
		const trailingTrivia = skipCssTrivia(source, string.end);

		cursor = trailingTrivia.end;
		if (
			!string.terminated ||
			trailingTrivia.malformed ||
			source[cursor] !== ')'
		) {
			return {end: cursor, escaped, malformed: true};
		}
		return {end: cursor + 1, escaped, malformed: false, value: string.value};
	}

	const valueStart = cursor;
	while (cursor < source.length && source[cursor] !== ')') {
		const character = source[cursor];
		if (character === '"' || character === "'") {
			return {end: cursor, escaped, malformed: true};
		}
		if (
			isCssWhitespace(character) ||
			(character === '/' && source[cursor + 1] === '*')
		) {
			const trailingTrivia = skipCssTrivia(source, cursor);

			if (trailingTrivia.malformed || source[trailingTrivia.end] !== ')') {
				return {end: trailingTrivia.end, escaped, malformed: true};
			}
			return {
				end: trailingTrivia.end + 1,
				escaped,
				malformed: false,
				value: source.slice(valueStart, cursor)
			};
		}
		if (character === '\\') escaped = true;
		cursor++;
	}
	if (source[cursor] !== ')')
		return {end: source.length, escaped, malformed: true};
	return {
		end: cursor + 1,
		escaped,
		malformed: false,
		value: source.slice(valueStart, cursor)
	};
}

function addCssScanIssue(
	state: MutableAssessmentState,
	message: string,
	sourceLocation: string
) {
	addScanIssue(state, {
		code: 'unrecognized-static-reference',
		message,
		sourceLocation
	});
}

function scanCss(
	state: MutableAssessmentState,
	source: string,
	logicalPath: string,
	locationPrefix = logicalPath
) {
	type CssFunctionContext = {
		imageSet: boolean;
		optionStart: boolean;
		start: number;
	};
	const functions: CssFunctionContext[] = [];
	let imageSetDepth = 0;
	let cursor = 0;
	let reportedEscape = false;
	let reportedSubstitution = false;
	const reportEscape = () => {
		if (reportedEscape) return;
		reportedEscape = true;
		addCssScanIssue(
			state,
			'CSS escapes are not evaluated by bounded dependency discovery.',
			locationPrefix
		);
	};
	const reportMalformed = (message: string, location: string) =>
		addCssScanIssue(state, message, location);
	const reportSubstitution = (location: string) => {
		if (reportedSubstitution) return;
		reportedSubstitution = true;
		addCssScanIssue(
			state,
			'CSS substitution inside image-set() could not be evaluated statically.',
			location
		);
	};
	const pushFunction = (imageSet: boolean, start: number) => {
		if (functions.length >= state.limits.maxCssNestingDepth) {
			addScanIssue(state, {
				code: 'css-nesting-limit',
				message: `CSS dependency discovery exceeded the ${state.limits.maxCssNestingDepth}-level nesting limit.`,
				sourceLocation: `${locationPrefix}:css-function@${start}`
			});
			return false;
		}
		functions.push({imageSet, optionStart: imageSet, start});
		if (imageSet) imageSetDepth++;
		return true;
	};

	while (cursor < source.length) {
		const character = source[cursor];
		if (character === '/' && source[cursor + 1] === '*') {
			const end = source.indexOf('*/', cursor + 2);
			if (end === -1) {
				reportMalformed(
					'An unterminated CSS comment could not be evaluated statically.',
					`${locationPrefix}:css-comment@${cursor}`
				);
				return;
			}
			cursor = end + 2;
			continue;
		}
		if (character === '"' || character === "'") {
			const context = functions.at(-1);
			const imageSetOption = context?.imageSet && context.optionStart;
			const string = readCssString(source, cursor);
			if (imageSetOption && string.escaped) reportEscape();
			if (!string.terminated) {
				reportMalformed(
					'An unterminated CSS string could not be evaluated statically.',
					`${locationPrefix}:css-string@${cursor}`
				);
				return;
			}
			if (imageSetOption && !string.escaped) {
				assessUrl(
					state,
					string.value,
					'resource',
					logicalPath,
					`${locationPrefix}:css-image-set@${context.start}`
				);
			}
			if (context?.imageSet) context.optionStart = false;
			cursor = string.end;
			continue;
		}
		if (character === '\\') {
			reportEscape();
			const context = functions.at(-1);

			if (context?.imageSet && context.optionStart) context.optionStart = false;
			cursor += 2;
			continue;
		}
		if (character === '(') {
			const context = functions.at(-1);

			if (context?.imageSet && context.optionStart) context.optionStart = false;
			if (!pushFunction(false, cursor)) return;
			cursor++;
			continue;
		}
		if (character === ')') {
			const context = functions.pop();

			if (context?.imageSet) imageSetDepth--;
			cursor++;
			continue;
		}
		if (character === ',') {
			const context = functions.at(-1);

			if (context?.imageSet) context.optionStart = true;
			cursor++;
			continue;
		}

		if (character === '@') {
			const context = functions.at(-1);

			if (context?.imageSet && context.optionStart) context.optionStart = false;
			const atRuleName = readCssName(source, cursor + 1);

			if (atRuleName.malformed) {
				reportMalformed(
					'An unterminated CSS comment could not be evaluated statically.',
					`${locationPrefix}:css-comment@${cursor + 1}`
				);
				return;
			}
			if (atRuleName.value.toLowerCase() !== 'import') {
				cursor++;
				continue;
			}
			const sourceLocation = `${locationPrefix}:css-import@${cursor}`;
			const importTrivia = skipCssTrivia(source, atRuleName.end);
			if (importTrivia.malformed) {
				reportMalformed(
					'An unterminated CSS comment could not be evaluated statically.',
					sourceLocation
				);
				return;
			}
			const valueStart = importTrivia.end;
			if (source[valueStart] === '"' || source[valueStart] === "'") {
				const string = readCssString(source, valueStart);
				if (string.escaped) reportEscape();
				if (!string.terminated || string.escaped) {
					reportMalformed(
						'A CSS @import could not be evaluated statically.',
						sourceLocation
					);
				} else {
					const resolved = assessUrl(
						state,
						string.value,
						'active-data-stylesheet',
						logicalPath,
						sourceLocation
					);
					if (resolved) state.cssTargetPaths.add(resolved);
				}
				cursor = string.end;
				continue;
			}
			const importValueName = readCssName(source, valueStart);

			if (importValueName.malformed) {
				reportMalformed(
					'A CSS @import could not be evaluated statically.',
					sourceLocation
				);
				return;
			}
			if (importValueName.value.toLowerCase() === 'url') {
				const nameTrivia = skipCssTrivia(source, importValueName.end);

				if (nameTrivia.malformed) {
					reportMalformed(
						'An unterminated CSS comment could not be evaluated statically.',
						sourceLocation
					);
					return;
				}
				const open = nameTrivia.end;

				if (source[open] !== '(') {
					reportMalformed(
						'A CSS @import could not be evaluated statically.',
						sourceLocation
					);
					cursor = Math.max(importValueName.end, valueStart + 1);
					continue;
				}
				const url = readCssUrl(source, open + 1);
				if (url.escaped) reportEscape();
				if (url.malformed || url.escaped) {
					reportMalformed(
						'A CSS @import could not be evaluated statically.',
						sourceLocation
					);
				} else {
					const resolved = assessUrl(
						state,
						url.value,
						'active-data-stylesheet',
						logicalPath,
						sourceLocation
					);
					if (resolved) state.cssTargetPaths.add(resolved);
				}
				cursor = Math.max(url.end, open + 1);
				continue;
			}
			reportMalformed(
				'A CSS @import could not be evaluated statically.',
				sourceLocation
			);
			cursor = valueStart;
			continue;
		}

		if (
			isCssNameCharacter(character) &&
			!isCssNameCharacter(source[cursor - 1])
		) {
			const name = readCssName(source, cursor);

			if (name.malformed) {
				reportMalformed(
					'An unterminated CSS comment could not be evaluated statically.',
					`${locationPrefix}:css-comment@${cursor}`
				);
				return;
			}
			const nameTrivia = skipCssTrivia(source, name.end);

			if (nameTrivia.malformed) {
				reportMalformed(
					'An unterminated CSS comment could not be evaluated statically.',
					`${locationPrefix}:css-comment@${name.end}`
				);
				return;
			}
			const open = nameTrivia.end;
			const lowerName = name.value.toLowerCase();
			const context = functions.at(-1);
			if (
				imageSetDepth > 0 &&
				source[open] === '(' &&
				(['attr', 'env', 'if', 'inherit', 'random-item', 'var'].includes(
					lowerName
				) ||
					lowerName.startsWith('--'))
			) {
				reportSubstitution(
					`${locationPrefix}:css-image-set-substitution@${cursor}`
				);
			}

			if (lowerName === 'url') {
				if (context?.imageSet && context.optionStart)
					context.optionStart = false;
				if (source[open] === '(') {
					const sourceLocation = `${locationPrefix}:css-url@${cursor}`;
					const url = readCssUrl(source, open + 1);
					if (url.escaped) reportEscape();
					if (url.malformed || url.escaped) {
						reportMalformed(
							'A CSS url() could not be evaluated statically.',
							sourceLocation
						);
					} else {
						assessUrl(
							state,
							url.value,
							'resource',
							logicalPath,
							sourceLocation
						);
					}
					cursor = Math.max(url.end, open + 1);
					continue;
				}
			}
			if (source[open] === '(') {
				if (context?.imageSet && context.optionStart)
					context.optionStart = false;
				const imageSet =
					lowerName === 'image-set' || lowerName === '-webkit-image-set';

				if (!pushFunction(imageSet, cursor)) return;
				cursor = open + 1;
				continue;
			}
			if (context?.imageSet && context.optionStart) context.optionStart = false;
			cursor = Math.max(name.end, cursor + 1);
			continue;
		}

		const context = functions.at(-1);

		if (context?.imageSet && context.optionStart && !isCssWhitespace(character))
			context.optionStart = false;
		cursor++;
	}
	const unclosedImageSet = functions.find(context => context.imageSet);

	if (unclosedImageSet) {
		reportMalformed(
			'An unterminated CSS image-set() could not be evaluated statically.',
			`${locationPrefix}:css-image-set@${unclosedImageSet.start}`
		);
	}
}

function scanSrcset(
	state: MutableAssessmentState,
	value: string,
	basePath: string,
	sourceLocation: string
) {
	let index = 0;

	for (const candidate of srcsetCandidateRanges(value)) {
		assessUrl(
			state,
			value.slice(candidate.start, candidate.end),
			'resource',
			basePath,
			`${sourceLocation}[${index}]`
		);
		index++;
	}
}

function scanHtml(
	state: MutableAssessmentState,
	html: string,
	htmlPath: string,
	embeddedPassageSource = false,
	embeddedDepth = 0
) {
	if (typeof DOMParser === 'undefined') {
		addScanIssue(state, {
			code: 'parser-unavailable',
			message: 'HTML dependency parsing is unavailable in this environment.',
			sourceLocation: htmlPath
		});
		return;
	}
	const document = new DOMParser().parseFromString(html, 'text/html');
	const elements = [
		...(embeddedPassageSource
			? [
					...document.head.querySelectorAll('*'),
					...(document.body.attributes.length > 0 ? [document.body] : []),
					...document.body.querySelectorAll('*')
				]
			: document.querySelectorAll('*'))
	];
	const remainingElements = Math.max(
		0,
		state.limits.maxHtmlElements - state.htmlElementCount
	);
	if (elements.length > remainingElements && !state.htmlElementLimitReported) {
		state.htmlElementLimitReported = true;
		addScanIssue(state, {
			code: 'html-element-limit',
			message: `HTML dependency discovery exceeded the ${state.limits.maxHtmlElements}-element limit.`,
			sourceLocation: htmlPath
		});
	}
	const boundedElements = elements.slice(0, remainingElements);

	state.htmlElementCount += boundedElements.length;

	for (const [index, element] of boundedElements.entries()) {
		// DOMParser already applies HTML's ASCII-only tag-name normalization.
		// Unicode lowercasing would turn names such as `linK` into `link`.
		const tag = element.localName;
		const prefix = `${htmlPath}:${tag}[${index}]`;
		const resourceAttributes: string[] = [];
		const navigationAttributes: string[] = [];
		const htmlElement = element.namespaceURI === 'http://www.w3.org/1999/xhtml';
		const linkRelation =
			tag === 'link' && htmlElement
				? classifyHtmlLinkRelations(
						element.getAttribute('rel') ?? '',
						element.getAttribute('as') ?? ''
					)
				: undefined;

		if (
			linkRelation?.unknown &&
			(element.hasAttribute('href') || element.hasAttribute('imagesrcset')) &&
			!state.linkRelationExtensionReported
		) {
			state.linkRelationExtensionReported = true;
			addScanIssue(state, {
				code: 'unrecognized-static-reference',
				message:
					'An unrecognized HTML link relation could affect static dependency discovery.',
				sourceLocation: `${prefix}@rel`
			});
		}

		if (htmlElement) {
			const inputType = element.getAttribute('type') ?? '';

			for (const attribute of element.getAttributeNames()) {
				if (classifyHtmlAssetAttribute(tag, attribute, inputType)) {
					resourceAttributes.push(attribute);
				}
			}

			switch (tag) {
				case 'a':
				case 'area':
					(element.hasAttribute('download')
						? resourceAttributes
						: navigationAttributes
					).push('href');
					break;
				case 'form':
					navigationAttributes.push('action');
					break;
				case 'link':
					if (linkRelation?.href) resourceAttributes.push('href');
					if (linkRelation?.imagesrcset) resourceAttributes.push('imagesrcset');
					break;
				case 'base':
					resourceAttributes.push('href');
					addScanIssue(state, {
						code: 'unrecognized-static-reference',
						message:
							'An HTML base URL can change relative dependency resolution.',
						sourceLocation: prefix
					});
					break;
			}
		}

		const svgHrefDisposition =
			element.namespaceURI === 'http://www.w3.org/2000/svg'
				? classifySvgHrefElement(tag)
				: null;

		if (svgHrefDisposition && svgHrefDisposition !== 'structural') {
			const target =
				svgHrefDisposition === 'navigation' && !element.hasAttribute('download')
					? navigationAttributes
					: resourceAttributes;

			const attribute = element.hasAttribute('href')
				? 'href'
				: element.hasAttribute('xlink:href')
					? 'xlink:href'
					: null;

			if (attribute && !target.includes(attribute)) target.push(attribute);
		}

		for (const attribute of resourceAttributes) {
			const value = element.getAttribute(attribute);

			if (value === null) continue;
			if (attribute === 'srcset' || attribute === 'imagesrcset') {
				scanSrcset(state, value, htmlPath, `${prefix}@${attribute}`);
			} else {
				const stylesheet =
					tag === 'link' && attribute === 'href' && linkRelation?.stylesheet;
				const resolved = assessUrl(
					state,
					value,
					stylesheet
						? 'active-data-stylesheet'
						: tag === 'frame' ||
							  tag === 'iframe' ||
							  tag === 'object' ||
							  tag === 'embed'
							? 'active-data-document'
							: 'resource',
					htmlPath,
					`${prefix}@${attribute}`
				);
				if (resolved && stylesheet) {
					state.cssTargetPaths.add(resolved);
				}
			}
		}
		for (const attribute of navigationAttributes) {
			const value = element.getAttribute(attribute);

			if (value !== null) {
				assessUrl(
					state,
					value,
					'navigation',
					htmlPath,
					`${prefix}@${attribute}`
				);
			}
		}
		if (tag === 'iframe') {
			const srcdoc = element.getAttribute('srcdoc');

			if (srcdoc) {
				if (embeddedDepth >= state.limits.maxEmbeddedHtmlDepth) {
					addScanIssue(state, {
						code: 'html-depth-limit',
						message: `Embedded HTML dependency discovery exceeded the ${state.limits.maxEmbeddedHtmlDepth}-level depth limit.`,
						sourceLocation: `${prefix}@srcdoc`
					});
				} else {
					scanHtml(state, srcdoc, `${prefix}@srcdoc`, true, embeddedDepth + 1);
				}
			}
		}

		const inlineStyle = element.getAttribute('style');
		if (inlineStyle !== null) {
			scanCss(state, inlineStyle, htmlPath, `${prefix}@style`);
		}
		if (element.namespaceURI === 'http://www.w3.org/2000/svg') {
			for (const attribute of svgCssPresentationAttributes) {
				const value = element.getAttribute(attribute);

				if (value !== null) {
					scanCss(state, value, htmlPath, `${prefix}@${attribute}`);
				}
			}
		}
		if (tag === 'style') {
			scanCss(state, element.textContent ?? '', htmlPath, `${prefix}:text`);
		}
		if (
			tag === 'meta' &&
			/^refresh$/i.test(element.getAttribute('http-equiv') ?? '')
		) {
			const content = element.getAttribute('content') ?? '';
			const refreshRange = declarativeRefreshUrlRange(content);
			const refreshUrl = refreshRange
				? content.slice(refreshRange.start, refreshRange.end)
				: null;

			if (refreshUrl) {
				assessUrl(
					state,
					refreshUrl,
					'automatic-navigation',
					htmlPath,
					`${prefix}@content`
				);
			}
		}
		if (tag === 'tw-passagedata' && !embeddedPassageSource) {
			const passageSource = element.textContent ?? '';

			if (passageSource) {
				scanHtml(
					state,
					passageSource,
					`${prefix}:source`,
					true,
					embeddedDepth + 1
				);
			}
		}
	}
}

function sortedUniqueDependencies(
	dependencies: PackageExportDependencyAssessment[]
) {
	const sorted = [...dependencies].sort((left, right) =>
		compareTuples(
			[left.kind, left.disposition, left.original, left.sourceLocation ?? ''],
			[
				right.kind,
				right.disposition,
				right.original,
				right.sourceLocation ?? ''
			]
		)
	);
	const result: PackageExportDependencyAssessment[] = [];
	let priorKey: string | undefined;

	for (const dependency of sorted) {
		const key = JSON.stringify([
			dependency.kind,
			dependency.disposition,
			dependency.original,
			dependency.sourceLocation ?? null
		]);

		if (key !== priorKey) result.push(dependency);
		priorKey = key;
	}
	return result;
}

/**
 * Assesses statically visible runtime dependencies without fetching content.
 * Included CSS is decoded strictly and scanned within explicit bounds. Runtime
 * JavaScript dependency discovery (including script data URLs) is always
 * reported as not evaluated rather than parsed as static dependencies.
 */
export function assessPackageDependencies({
	assets,
	html,
	htmlPath = 'index.html',
	limits: requestedLimits,
	packagedPaths = []
}: AssessPackageDependenciesOptions): PackageDependencyAssessmentResult {
	const limits = resolvedScanLimits(requestedLimits);
	const canonicalHtmlPath = canonicalPackagePath(htmlPath);
	const canonicalAssets = [...assets].sort((left, right) =>
		compareUtf8(
			canonicalPackagePath(left.logicalPath),
			canonicalPackagePath(right.logicalPath)
		)
	);
	const state: MutableAssessmentState = {
		candidateCount: 0,
		candidateLimitReported: false,
		cssTargetPaths: new Set(),
		dependencies: [],
		htmlElementCount: 0,
		htmlElementLimitReported: false,
		incomplete: false,
		issueKeys: new Set(),
		issueLimitReported: false,
		issues: [],
		limits,
		linkRelationExtensionReported: false,
		oversizedCandidateReported: false,
		packagedPaths: new Set([
			canonicalHtmlPath,
			...packagedPaths.map(canonicalPackagePath),
			...canonicalAssets.map(asset => canonicalPackagePath(asset.logicalPath))
		]),
		unknown: false
	};

	for (const asset of canonicalAssets) {
		if (asset.requiredByStaticReference) {
			addDependency(state, {
				disposition: 'packaged',
				kind: 'managed-local',
				original: canonicalPackagePath(asset.logicalPath),
				sourceLocation: 'project asset inventory'
			});
		}
	}

	if (encoder.encode(html).length > limits.maxHtmlBytes) {
		addScanIssue(state, {
			code: 'html-source-limit',
			message: `Generated HTML exceeded the ${limits.maxHtmlBytes}-byte static dependency scan limit.`,
			sourceLocation: canonicalHtmlPath
		});
	} else {
		scanHtml(state, html, canonicalHtmlPath);
	}

	const assetsByPath = new Map(
		canonicalAssets.map(asset => [
			canonicalPackagePath(asset.logicalPath),
			asset
		])
	);
	const cssAssets: PackageDependencyAsset[] = [];
	const queuedCssPaths = new Set<string>();
	const unavailableCssPaths = new Set<string>();
	const enqueueCssPath = (logicalPath: string) => {
		const canonicalPath = canonicalPackagePath(logicalPath);

		if (queuedCssPaths.has(canonicalPath)) return;
		const asset = assetsByPath.get(canonicalPath);
		if (!asset) {
			if (!unavailableCssPaths.has(canonicalPath)) {
				unavailableCssPaths.add(canonicalPath);
				addCssScanIssue(
					state,
					'A packaged stylesheet target had no copied bytes available for static CSS scanning.',
					canonicalPath
				);
			}
			return;
		}
		queuedCssPaths.add(canonicalPath);
		cssAssets.push(asset);
	};

	for (const asset of canonicalAssets.filter(cssAsset)) {
		enqueueCssPath(asset.logicalPath);
	}
	for (const logicalPath of state.cssTargetPaths) enqueueCssPath(logicalPath);
	let scannedCssBytes = 0;
	const attemptedCss = cssAssets.length > 0 || state.cssTargetPaths.size > 0;
	let cssIndex = 0;
	while (cssIndex < cssAssets.length) {
		if (cssIndex >= limits.maxCssFiles) {
			addScanIssue(state, {
				code: 'css-file-limit',
				message: `Copied CSS discovery exceeded the ${limits.maxCssFiles}-file limit.`,
				sourceLocation:
					canonicalPackagePath(cssAssets[cssIndex]?.logicalPath ?? '') ||
					'copied CSS assets'
			});
			break;
		}
		const asset = cssAssets[cssIndex++];
		const logicalPath = canonicalPackagePath(asset.logicalPath);
		const assetBytes = bytes(asset.bytes);

		if (
			assetBytes.byteLength > limits.maxCssFileBytes ||
			scannedCssBytes + assetBytes.byteLength > limits.maxCssBytes
		) {
			addScanIssue(state, {
				code: 'css-source-limit',
				message: `Copied CSS exceeded a bounded static dependency scan limit.`,
				sourceLocation: logicalPath
			});
			continue;
		}
		scannedCssBytes += assetBytes.byteLength;
		let source: string;

		try {
			source = new TextDecoder('utf-8', {fatal: true}).decode(assetBytes);
		} catch {
			addScanIssue(state, {
				code: 'invalid-css-utf8',
				message: 'Copied CSS was not valid UTF-8 and was not scanned.',
				sourceLocation: logicalPath
			});
			continue;
		}
		scanCss(state, source, logicalPath);
		for (const targetPath of state.cssTargetPaths) enqueueCssPath(targetPath);
	}

	state.dependencies.push({
		disposition: 'not-evaluated',
		kind: 'dynamic-unknown',
		original: 'Runtime JavaScript dependency discovery',
		sourceLocation: 'generated HTML and packaged scripts'
	});

	return {
		copiedAssetContents: attemptedCss ? 'partially-evaluated' : 'not-evaluated',
		dependencies: sortedUniqueDependencies(state.dependencies),
		scanIssues: [...state.issues].sort((left, right) =>
			compareTuples(
				[left.code, left.sourceLocation, left.message],
				[right.code, right.sourceLocation, right.message]
			)
		),
		staticRuntimeDependencies: state.incomplete
			? 'incomplete'
			: state.unknown
				? 'unknown'
				: 'complete'
	};
}
