import type {CoreAssetReference} from './bindings/CoreAssetReference';
import type {CoreAssetInventoryEntry} from './bindings/CoreAssetInventoryEntry';
import type {CoreAssetPublishRule} from './bindings/CoreAssetPublishRule';
import type {CoreContentsEntry} from './bindings/CoreContentsEntry';
import type {CoreDiagnostic} from './bindings/CoreDiagnostic';
import type {CoreDiagnosticSeverity} from './bindings/CoreDiagnosticSeverity';
import type {CoreGraphStats} from './bindings/CoreGraphStats';
import type {CoreReplacePreview} from './bindings/CoreReplacePreview';
import type {CoreSearchHit} from './bindings/CoreSearchHit';
import type {CoreSearchScope} from './bindings/CoreSearchScope';
import type {CoreSourceFile} from './bindings/CoreSourceFile';
import type {CoreStoryIndex} from './bindings/CoreStoryIndex';
import type {CoreStoryIndexOptions} from './bindings/CoreStoryIndexOptions';
import type {CoreSymbol} from './bindings/CoreSymbol';
import type {CoreTagEntry} from './bindings/CoreTagEntry';
import {
	assetKindForPath,
	assetReferencesInSource,
	assetSnippet,
	normalizedAssetPath
} from './asset-paths';
import {Passage, Story} from '../store/stories';
import {parseLinks} from '../util/parse-links';
import {createRegExp} from '../util/regexp';

type StoryIndexQuery = string | Partial<CoreStoryIndexOptions>;

const defaultOptions: CoreStoryIndexOptions = {
	assetScanComplete: false,
	fuzzy: false,
	includeAssets: true,
	includeContents: true,
	includeDiagnostics: true,
	includeFiles: true,
	includeGraph: true,
	includePassageNames: true,
	includePassageText: true,
	includeScript: true,
	includeStylesheet: true,
	includeTags: true,
	includeVariables: true,
	knownAssets: [],
	matchCase: false,
	query: null,
	replacement: null,
	useRegexes: false
};

const maxSearchHits = 500;

export function normalizeStoryIndexOptions(
	query: StoryIndexQuery = {}
): CoreStoryIndexOptions {
	return typeof query === 'string'
		? {...defaultOptions, query}
		: {...defaultOptions, ...query};
}

function lineCount(text: string) {
	return Math.max(text.split(/\r?\n/).length, 1);
}

function lineNumberAt(source: string, start: number) {
	return source.slice(0, start).split(/\r?\n/).length;
}

function excerptAround(source: string, start: number, length: number) {
	const lineStart = source.lastIndexOf('\n', start - 1) + 1;
	const lineEnd = source.indexOf('\n', start);
	const end = lineEnd === -1 ? source.length : lineEnd;
	const excerpt = source.slice(lineStart, end).trim();

	if (excerpt.length <= 140) {
		return excerpt;
	}

	const windowStart = Math.max(start - 48, lineStart);
	const windowEnd = Math.min(start + length + 48, end);

	return `${windowStart > lineStart ? '...' : ''}${source
		.slice(windowStart, windowEnd)
		.trim()}${windowEnd < end ? '...' : ''}`;
}

function replacementPreview(
	source: string,
	start: number,
	end: number,
	replacement: string
) {
	const lineStart = source.lastIndexOf('\n', start - 1) + 1;
	const lineEnd = source.indexOf('\n', start);
	const sourceLineEnd = lineEnd === -1 ? source.length : lineEnd;
	const before = source.slice(lineStart, sourceLineEnd).trim();
	const after = `${source.slice(lineStart, start)}${replacement}${source.slice(
		end,
		sourceLineEnd
	)}`.trim();

	return {after, before};
}

function sourceFileForPassage(passage: Passage): CoreSourceFile {
	return {
		characterCount: passage.text.length,
		id: passage.id,
		kind: 'passage',
		lineCount: lineCount(passage.text),
		name: passage.name,
		passageId: passage.id,
		tags: passage.tags
	};
}

function scopeRank(scope: CoreSearchScope) {
	switch (scope) {
		case 'passageName':
			return 100;
		case 'passageTag':
			return 88;
		case 'variable':
			return 82;
		case 'metadata':
			return 78;
		case 'passageText':
			return 70;
		case 'script':
			return 62;
		case 'stylesheet':
			return 58;
		case 'asset':
			return 52;
	}
}

function exactRankBonus(start: number) {
	return 1 / (1 + start);
}

function fuzzyMatch(source: string, query: string, matchCase: boolean) {
	const haystack = matchCase ? source : source.toLocaleLowerCase();
	const needle = matchCase ? query : query.toLocaleLowerCase();
	let needleIndex = 0;
	let start: number | undefined;
	let end = 0;

	for (let index = 0; index < haystack.length; index++) {
		if (haystack[index] === needle[needleIndex]) {
			start ??= index;
			end = index + 1;
			needleIndex++;

			if (needleIndex === needle.length) {
				const span = Math.max(end - start, 1);

				return {end, score: needle.length / span, start};
			}
		}
	}
}

function createSearchMatcher(options: CoreStoryIndexOptions) {
	const query = options.query?.trim() ?? '';

	if (query === '') {
		return;
	}

	return createRegExp(query, {
		matchCase: options.matchCase,
		useRegexes: options.useRegexes
	});
}

function hasSearchQuery(options: CoreStoryIndexOptions) {
	return (options.query?.trim() ?? '') !== '';
}

function replacementForMatch(
	match: RegExpExecArray | undefined,
	matcher: RegExp | undefined,
	options: CoreStoryIndexOptions
) {
	if (options.replacement === null) {
		return null;
	}

	if (!options.useRegexes || !match || !matcher) {
		return options.replacement;
	}

	const localFlags = matcher.flags.replace(/g/g, '');

	return match[0].replace(
		new RegExp(matcher.source, localFlags),
		options.replacement
	);
}

function searchHit(
	options: CoreStoryIndexOptions,
	match: RegExpExecArray | undefined,
	matcher: RegExp | undefined,
	sourceId: string,
	sourceName: string,
	source: string,
	scope: CoreSearchScope,
	passageId: string | null,
	start: number,
	end: number,
	rank: number
): CoreSearchHit {
	const replacement = replacementForMatch(match, matcher, options);
	const preview =
		replacement !== null
			? replacementPreview(source, start, end, replacement)
			: {after: null, before: null};

	return {
		after: preview.after ?? null,
		before: preview.before ?? null,
		end,
		excerpt: excerptAround(source, start, end - start),
		line: lineNumberAt(source, start),
		matchText: source.slice(start, end),
		passageId,
		rank,
		replacement,
		scope,
		sourceId,
		sourceName,
		start
	};
}

function searchHitsInSource(
	options: CoreStoryIndexOptions,
	matcher: RegExp | undefined,
	sourceId: string,
	sourceName: string,
	source: string,
	scope: CoreSearchScope,
	passageId: string | null
): CoreSearchHit[] {
	const query = options.query?.trim() ?? '';

	if (!matcher || query === '') {
		return [];
	}

	const hits: CoreSearchHit[] = [];

	matcher.lastIndex = 0;

	for (let match = matcher.exec(source); match; match = matcher.exec(source)) {
		const start = match.index;
		const end = start + match[0].length;

		if (start === end) {
			matcher.lastIndex++;
			continue;
		}

		hits.push(
			searchHit(
				options,
				match,
				matcher,
				sourceId,
				sourceName,
				source,
				scope,
				passageId,
				start,
				end,
				scopeRank(scope) + exactRankBonus(start)
			)
		);

		if (hits.length >= maxSearchHits) {
			break;
		}
	}

	if (hits.length === 0 && options.fuzzy) {
		const fuzzy = fuzzyMatch(source, query, options.matchCase);

		if (fuzzy) {
			hits.push(
				searchHit(
					options,
					undefined,
					undefined,
					sourceId,
					sourceName,
					source,
					scope,
					passageId,
					fuzzy.start,
					fuzzy.end,
					scopeRank(scope) * 0.7 + fuzzy.score
				)
			);
		}
	}

	return hits;
}

function graphStats(story: Story): CoreGraphStats {
	const passageByName = new Map(
		story.passages.map(passage => [passage.name, passage])
	);
	const incoming = new Map(story.passages.map(passage => [passage.id, 0]));
	let brokenLinks = 0;
	let links = 0;
	let resolvedLinks = 0;
	let selfLinks = 0;

	for (const passage of story.passages) {
		for (const link of parseLinks(passage.text, true)) {
			links++;

			const target = passageByName.get(link);

			if (!target) {
				brokenLinks++;
			} else if (target.id === passage.id) {
				selfLinks++;
			} else {
				resolvedLinks++;
				incoming.set(target.id, (incoming.get(target.id) ?? 0) + 1);
			}
		}
	}

	return {
		brokenLinks,
		emptyPassages: story.passages.filter(passage => passage.text.trim() === '')
			.length,
		links,
		orphanPassages: story.passages.filter(
			passage =>
				passage.id !== story.startPassage &&
				(incoming.get(passage.id) ?? 0) === 0
		).length,
		passages: story.passages.length,
		resolvedLinks,
		selfLinks,
		taggedPassages: story.passages.filter(passage => passage.tags.length > 0)
			.length,
		unreachablePassages: 0
	};
}

function emptyGraphStats(): CoreGraphStats {
	return {
		brokenLinks: 0,
		emptyPassages: 0,
		links: 0,
		orphanPassages: 0,
		passages: 0,
		resolvedLinks: 0,
		selfLinks: 0,
		taggedPassages: 0,
		unreachablePassages: 0
	};
}

function locateLinkTarget(text: string, target: string) {
	const start = text.indexOf(target);

	if (start === -1) {
		return {end: target.length, line: 1, start: 0};
	}

	return {end: start + target.length, line: lineNumberAt(text, start), start};
}

function diagnosticsForStory(story: Story): CoreDiagnostic[] {
	const passageByName = new Map(
		story.passages.map(passage => [passage.name, passage])
	);
	const diagnostics: CoreDiagnostic[] = [];
	const names = new Map<string, Passage[]>();

	for (const passage of story.passages) {
		const sameName = names.get(passage.name) ?? [];

		sameName.push(passage);
		names.set(passage.name, sameName);

		for (const link of parseLinks(passage.text, true)) {
			if (!passageByName.has(link)) {
				const range = locateLinkTarget(passage.text, link);

				diagnostics.push({
					code: 'broken-link',
					end: range.end,
					line: range.line,
					message: `Broken link to "${link}"`,
					passageId: passage.id,
					quickFixes: [
						{command: `create-passage:${link}`, title: `Create "${link}"`},
						{command: 'rename-link-target', title: 'Change link target'}
					],
					severity: 'warning',
					sourceId: passage.id,
					start: range.start
				});
			}
		}
	}

	for (const passages of names.values()) {
		if (passages.length > 1) {
			for (const passage of passages) {
				diagnostics.push({
					code: 'duplicate-passage-name',
					end: passage.name.length,
					line: 1,
					message: `Duplicate passage name "${passage.name}"`,
					passageId: passage.id,
					quickFixes: [{command: 'rename-passage', title: 'Rename passage'}],
					severity: 'error',
					sourceId: passage.id,
					start: 0
				});
			}
		}
	}

	if (!story.passages.some(passage => passage.id === story.startPassage)) {
		diagnostics.push({
			code: 'missing-start-passage',
			end: 0,
			line: 1,
			message: 'Story start passage is missing',
			passageId: null,
			quickFixes: [
				{command: 'set-start-passage', title: 'Choose a start passage'}
			],
			severity: 'error',
			sourceId: `${story.id}:metadata`,
			start: 0
		});
	}

	return diagnostics;
}

function symbolsInSource(
	sourceId: string,
	sourceName: string,
	source: string,
	scope: CoreSearchScope,
	passageId: string | null
): CoreSymbol[] {
	const symbols: CoreSymbol[] = [];
	const matcher = /(^|[^A-Za-z0-9_])(\$[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g;

	for (let match = matcher.exec(source); match; match = matcher.exec(source)) {
		const start = match.index + match[1].length;
		const name = match[2];
		const end = start + name.length;

		if (!symbolNameHasIdentifierBody(name.slice(1))) {
			continue;
		}

		symbols.push({
			end,
			excerpt: excerptAround(source, start, name.length),
			kind: 'variable',
			line: lineNumberAt(source, start),
			name,
			passageId,
			scope,
			sourceId,
			sourceName,
			start
		});
	}

	return symbols;
}

function symbolNameHasIdentifierBody(nameWithoutSigil: string) {
	return /[A-Za-z0-9]/.test(nameWithoutSigil);
}

function assetPublishRule(
	path: string,
	missing: boolean
): CoreAssetPublishRule {
	return {
		copy: !missing,
		outputPath: path,
		reason: missing
			? 'Referenced file is missing'
			: 'Copy asset into published output'
	};
}

function assetInventoryEntry(
	path: string,
	kind: string,
	exists: boolean | null,
	references: CoreAssetReference[]
): CoreAssetInventoryEntry {
	const missing = exists === false && references.length > 0;
	const unused = exists === true && references.length === 0;

	return {
		durationMs: null,
		exists,
		height: null,
		kind,
		missing,
		modifiedAt: null,
		normalizedPath: normalizedAssetPath(path),
		path,
		previewUrl: null,
		publish: assetPublishRule(path, missing),
		referenceCount: references.length,
		references,
		sizeBytes: null,
		snippet: assetSnippet(path, kind),
		thumbnailUrl: null,
		unused,
		width: null
	};
}

function assetInventoryFromReferences(
	references: CoreAssetReference[],
	knownAssets: CoreAssetInventoryEntry[],
	assetScanComplete: boolean
) {
	const referencesByPath = new Map<string, CoreAssetReference[]>();

	for (const reference of references) {
		const normalized = normalizedAssetPath(reference.path);

		referencesByPath.set(normalized, [
			...(referencesByPath.get(normalized) ?? []),
			reference
		]);
	}

	const inventory = new Map<string, CoreAssetInventoryEntry>();

	for (const knownAsset of knownAssets) {
		const normalized = normalizedAssetPath(
			knownAsset.normalizedPath || knownAsset.path
		);
		const assetReferences = referencesByPath.get(normalized);
		const references =
			assetReferences && assetReferences.length > 0
				? assetReferences
				: knownAsset.references;
		const kind = knownAsset.kind || assetKindForPath(knownAsset.path);
		const missing = knownAsset.exists === false && references.length > 0;
		const unused = knownAsset.exists === true && references.length === 0;
		const publish = knownAsset.publish.outputPath
			? knownAsset.publish
			: assetPublishRule(knownAsset.path, missing);

		referencesByPath.delete(normalized);
		inventory.set(normalized, {
			...knownAsset,
			kind,
			missing,
			normalizedPath: normalized,
			publish: missing
				? {
						...publish,
						copy: false,
						reason: 'Referenced file is missing'
					}
				: publish,
			referenceCount: references.length,
			references,
			snippet: knownAsset.snippet.text
				? knownAsset.snippet
				: assetSnippet(knownAsset.path, kind),
			unused
		});
	}

	for (const references of referencesByPath.values()) {
		const firstReference = references[0];

		inventory.set(
			normalizedAssetPath(firstReference.path),
			assetInventoryEntry(
				firstReference.path,
				firstReference.kind,
				assetScanComplete ? false : null,
				references
			)
		);
	}

	return Array.from(inventory.values()).sort((left, right) =>
		left.path.localeCompare(right.path)
	);
}

function tagEntries(story: Story): CoreTagEntry[] {
	const entries = new Map<string, Set<string>>();

	for (const passage of story.passages) {
		for (const tag of passage.tags) {
			const passageIds = entries.get(tag) ?? new Set<string>();

			passageIds.add(passage.id);
			entries.set(tag, passageIds);
		}
	}

	return Array.from(entries)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, passageIds]) => ({
			color: story.tagColors[name] ?? null,
			count: passageIds.size,
			name,
			passageIds: Array.from(passageIds).sort()
		}));
}

function groupKind(tagName: string) {
	const normalized = tagName.toLocaleLowerCase();

	return normalized.startsWith('chapter') ||
		normalized.startsWith('section') ||
		normalized.startsWith('group')
		? 'group'
		: 'tag';
}

function countedSymbolEntries(symbols: CoreSymbol[]) {
	const result = new Map<
		string,
		{count: number; passageId: string | null; sourceId: string}
	>();

	for (const symbol of symbols) {
		const existing = result.get(symbol.name);

		if (existing) {
			existing.count++;
		} else {
			result.set(symbol.name, {
				count: 1,
				passageId: symbol.passageId,
				sourceId: symbol.sourceId
			});
		}
	}

	return Array.from(result).sort(([left], [right]) =>
		left.localeCompare(right)
	);
}

function assetStatusSeverity(asset: CoreAssetInventoryEntry) {
	if (asset.missing) {
		return 'error' as CoreDiagnosticSeverity;
	}

	if (asset.unused) {
		return 'info' as CoreDiagnosticSeverity;
	}

	return null;
}

function assetLocation(story: Story, asset: CoreAssetInventoryEntry) {
	const reference = asset.references[0];

	if (reference) {
		return {
			line: reference.line,
			passageId: reference.passageId,
			sourceId: reference.sourceId,
			sourceName: reference.sourceName,
			start: reference.start,
			end: reference.end
		};
	}

	return {
		line: 1,
		passageId: null,
		sourceId: `${story.id}:assets`,
		sourceName: 'Assets',
		start: 0,
		end: asset.path.length
	};
}

function assetDiagnostics(
	story: Story,
	assetInventory: CoreAssetInventoryEntry[]
): CoreDiagnostic[] {
	const diagnostics: CoreDiagnostic[] = [];

	for (const asset of assetInventory) {
		const location = assetLocation(story, asset);

		if (asset.missing) {
			diagnostics.push({
				code: 'missing-asset',
				end: location.end,
				line: location.line,
				message: `Referenced asset "${asset.path}" is missing`,
				passageId: location.passageId,
				quickFixes: [
					{
						command: `import-asset:${asset.path}`,
						title: 'Import or relink asset'
					}
				],
				severity: 'error',
				sourceId: location.sourceId,
				start: location.start
			});
		}

		if (asset.unused) {
			diagnostics.push({
				code: 'unused-asset',
				end: asset.path.length,
				line: 1,
				message: `Asset "${asset.path}" is not referenced`,
				passageId: null,
				quickFixes: [
					{
						command: `delete-asset:${asset.path}`,
						title: 'Delete unused asset'
					}
				],
				severity: 'info',
				sourceId: `${story.id}:assets`,
				start: 0
			});
		}
	}

	return diagnostics;
}

function contentsEntries(
	story: Story,
	files: CoreSourceFile[],
	tags: CoreTagEntry[],
	symbols: CoreSymbol[],
	assetInventory: CoreAssetInventoryEntry[],
	diagnostics: CoreDiagnostic[]
): CoreContentsEntry[] {
	const entries: CoreContentsEntry[] = [
		{
			count: story.passages.length,
			detail: story.name,
			id: `metadata:${story.id}`,
			kind: 'metadata',
			label: 'Story metadata',
			passageId: null,
			severity: null,
			sourceId: `${story.id}:metadata`
		},
		{
			count: 1,
			detail: `${story.storyFormat} ${story.storyFormatVersion}`,
			id: `format:${story.id}`,
			kind: 'metadata',
			label: 'Story format',
			passageId: null,
			severity: null,
			sourceId: `${story.id}:metadata`
		}
	];
	const startPassage = story.passages.find(
		passage => passage.id === story.startPassage
	);

	if (startPassage) {
		entries.push({
			count: 1,
			detail: startPassage.name,
			id: `entry:${startPassage.id}`,
			kind: 'entryPoint',
			label: 'Start passage',
			passageId: startPassage.id,
			severity: null,
			sourceId: startPassage.id
		});
	}

	for (const file of files) {
		entries.push({
			count: file.lineCount,
			detail: `${file.characterCount} characters`,
			id: `source:${file.id}`,
			kind:
				file.kind === 'script'
					? 'script'
					: file.kind === 'stylesheet'
						? 'stylesheet'
						: 'passage',
			label: file.name,
			passageId: file.passageId,
			severity: null,
			sourceId: file.id
		});
	}

	for (const tag of tags) {
		entries.push({
			count: tag.count,
			detail: tag.color,
			id: `tag:${tag.name}`,
			kind: groupKind(tag.name),
			label: tag.name,
			passageId: tag.passageIds[0] ?? null,
			severity: null,
			sourceId: tag.passageIds[0] ?? null
		});
	}

	for (const [name, entry] of countedSymbolEntries(symbols)) {
		entries.push({
			count: entry.count,
			detail: null,
			id: `symbol:${name}`,
			kind: 'variable',
			label: name,
			passageId: entry.passageId,
			severity: null,
			sourceId: entry.sourceId
		});
	}

	for (const asset of assetInventory) {
		const location = assetLocation(story, asset);

		entries.push({
			count: asset.referenceCount,
			detail: asset.missing ? 'missing' : asset.unused ? 'unused' : asset.kind,
			id: `asset:${asset.path}`,
			kind: 'asset',
			label: asset.path,
			passageId: location.passageId,
			severity: assetStatusSeverity(asset),
			sourceId: location.sourceId
		});
	}

	for (const diagnostic of diagnostics) {
		entries.push({
			count: 1,
			detail: diagnostic.message,
			id: `diagnostic:${diagnostic.code}:${diagnostic.sourceId}:${diagnostic.start}`,
			kind: diagnostic.code === 'broken-link' ? 'brokenLink' : 'diagnostic',
			label: diagnostic.code,
			passageId: diagnostic.passageId,
			severity: diagnostic.severity,
			sourceId: diagnostic.sourceId
		});
	}

	const incoming = new Map(story.passages.map(passage => [passage.id, 0]));
	const passageByName = new Map(
		story.passages.map(passage => [passage.name, passage])
	);

	for (const passage of story.passages) {
		for (const link of parseLinks(passage.text, true)) {
			const target = passageByName.get(link);

			if (target && target.id !== passage.id) {
				incoming.set(target.id, (incoming.get(target.id) ?? 0) + 1);
			}
		}
	}

	for (const passage of story.passages) {
		if (
			passage.id !== story.startPassage &&
			(incoming.get(passage.id) ?? 0) === 0
		) {
			entries.push({
				count: 1,
				detail: passage.name,
				id: `orphan:${passage.id}`,
				kind: 'orphan',
				label: 'Orphan passage',
				passageId: passage.id,
				severity: 'info',
				sourceId: passage.id
			});
		}
	}

	return entries;
}

function storyMetadataSource(story: Story) {
	return [
		`Name: ${story.name}`,
		`IFID: ${story.ifid}`,
		`Story format: ${story.storyFormat} ${story.storyFormatVersion}`,
		`Story tags: ${story.tags.join(', ')}`
	].join('\n');
}

function invalidRegexDiagnostic(story: Story, query: string): CoreDiagnostic {
	return {
		code: 'invalid-search-regex',
		end: query.length,
		line: 1,
		message: 'Search regular expression is invalid',
		passageId: null,
		quickFixes: [
			{command: 'disable-regex-search', title: 'Turn off regular expressions'}
		],
		severity: 'error' as CoreDiagnosticSeverity,
		sourceId: `${story.id}:metadata`,
		start: 0
	};
}

export function storyToCoreIndex(
	story: Story,
	query: StoryIndexQuery = {}
): CoreStoryIndex {
	const options = normalizeStoryIndexOptions(query);
	const searchEnabled = hasSearchQuery(options);
	let matcher: RegExp | undefined;
	const diagnostics = options.includeDiagnostics
		? diagnosticsForStory(story)
		: [];

	try {
		if (searchEnabled) {
			matcher = createSearchMatcher(options);
		}
	} catch {
		if (searchEnabled && options.includeDiagnostics) {
			diagnostics.push(invalidRegexDiagnostic(story, options.query ?? ''));
		}
	}

	const files: CoreSourceFile[] = options.includeFiles
		? [
				...story.passages.map(sourceFileForPassage),
				{
					characterCount: story.script.length,
					id: `${story.id}:script`,
					kind: 'script',
					lineCount: lineCount(story.script),
					name: 'Story JavaScript',
					passageId: null,
					tags: []
				},
				{
					characterCount: story.stylesheet.length,
					id: `${story.id}:stylesheet`,
					kind: 'stylesheet',
					lineCount: lineCount(story.stylesheet),
					name: 'Story Stylesheet',
					passageId: null,
					tags: []
				}
			]
		: [];
	const searchHits: CoreSearchHit[] = [];
	const symbols: CoreSymbol[] = [];
	const assets: CoreAssetReference[] = [];

	for (const passage of story.passages) {
		if (searchEnabled && options.includePassageNames) {
			searchHits.push(
				...searchHitsInSource(
					options,
					matcher,
					passage.id,
					passage.name,
					passage.name,
					'passageName',
					passage.id
				)
			);
		}

		if (searchEnabled && options.includePassageText) {
			searchHits.push(
				...searchHitsInSource(
					options,
					matcher,
					passage.id,
					passage.name,
					passage.text,
					'passageText',
					passage.id
				)
			);
		}

		if (searchEnabled && options.includeTags) {
			for (const tag of passage.tags) {
				searchHits.push(
					...searchHitsInSource(
						options,
						matcher,
						passage.id,
						passage.name,
						tag,
						'passageTag',
						passage.id
					)
				);
			}
		}

		if (options.includeVariables) {
			symbols.push(
				...symbolsInSource(
					passage.id,
					passage.name,
					passage.text,
					'passageText',
					passage.id
				)
			);
		}

		if (options.includeAssets) {
			assets.push(
				...assetReferencesInSource(
					passage.id,
					passage.name,
					passage.text,
					passage.id
				)
			);
		}
	}

	if (searchEnabled) {
		searchHits.push(
			...searchHitsInSource(
				options,
				matcher,
				`${story.id}:metadata`,
				'Story Metadata',
				storyMetadataSource(story),
				'metadata',
				null
			)
		);
	}

	if (searchEnabled && options.includeScript) {
		searchHits.push(
			...searchHitsInSource(
				options,
				matcher,
				`${story.id}:script`,
				'Story JavaScript',
				story.script,
				'script',
				null
			)
		);
	}

	if (searchEnabled && options.includeStylesheet) {
		searchHits.push(
			...searchHitsInSource(
				options,
				matcher,
				`${story.id}:stylesheet`,
				'Story Stylesheet',
				story.stylesheet,
				'stylesheet',
				null
			)
		);
	}

	if (options.includeVariables) {
		symbols.push(
			...symbolsInSource(
				`${story.id}:script`,
				'Story JavaScript',
				story.script,
				'script',
				null
			),
			...symbolsInSource(
				`${story.id}:stylesheet`,
				'Story Stylesheet',
				story.stylesheet,
				'stylesheet',
				null
			)
		);
	}

	if (options.includeAssets) {
		assets.push(
			...assetReferencesInSource(
				`${story.id}:script`,
				'Story JavaScript',
				story.script,
				null
			),
			...assetReferencesInSource(
				`${story.id}:stylesheet`,
				'Story Stylesheet',
				story.stylesheet,
				null
			)
		);
	}

	const assetInventory = options.includeAssets
		? assetInventoryFromReferences(
				assets,
				options.knownAssets,
				options.assetScanComplete
			)
		: [];

	if (searchEnabled && options.includeVariables) {
		for (const symbol of symbols) {
			searchHits.push(
				...searchHitsInSource(
					options,
					matcher,
					symbol.sourceId,
					symbol.sourceName,
					symbol.name,
					'variable',
					symbol.passageId
				)
			);
		}
	}

	if (searchEnabled && options.includeAssets) {
		for (const asset of assetInventory) {
			const location = assetLocation(story, asset);

			searchHits.push(
				...searchHitsInSource(
					options,
					matcher,
					location.sourceId,
					location.sourceName,
					asset.path,
					'asset',
					location.passageId
				)
			);
		}
	}

	searchHits.sort((left, right) => {
		if (right.rank !== left.rank) {
			return right.rank - left.rank;
		}

		if (left.sourceName !== right.sourceName) {
			return left.sourceName.localeCompare(right.sourceName);
		}

		return left.line - right.line || left.start - right.start;
	});
	searchHits.splice(maxSearchHits);

	const tags = tagEntries(story);
	const replacePreviews: CoreReplacePreview[] = searchHits
		.filter(
			(
				hit
			): hit is CoreSearchHit & {
				after: string;
				before: string;
				replacement: string;
			} => hit.after !== null && hit.before !== null && hit.replacement !== null
		)
		.map(hit => ({
			after: hit.after,
			before: hit.before,
			end: hit.end,
			line: hit.line,
			matchText: hit.matchText,
			passageId: hit.passageId,
			replacement: hit.replacement,
			scope: hit.scope,
			sourceId: hit.sourceId,
			sourceName: hit.sourceName,
			start: hit.start
		}));

	if (options.includeDiagnostics) {
		diagnostics.push(...assetDiagnostics(story, assetInventory));
	}

	return {
		assetInventory,
		assets,
		contents: options.includeContents
			? contentsEntries(
					story,
					files,
					tags,
					symbols,
					assetInventory,
					diagnostics
				)
			: [],
		diagnostics,
		files,
		graph: options.includeGraph ? graphStats(story) : emptyGraphStats(),
		replacePreviews,
		searchHits,
		storyId: story.id,
		tags: tags.map(tag => tag.name),
		tagEntries: tags,
		symbols
	};
}
