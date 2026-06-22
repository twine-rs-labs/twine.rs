import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import {
	normalizeGraphProjectionOptions,
	storyToCoreGraphProjection
} from '../graph-projection';
import {projectSnapshotFromStories} from '../project-snapshot';
import {normalizeStoryIndexOptions, storyToCoreIndex} from '../story-index';
import {fakePassage, fakeStory} from '../../test-util';
import type {Story} from '../../store/stories';

function parityStory() {
	const story = fakeStory(0);

	story.id = 'story-1';
	story.ifid = 'IFID';
	story.name = 'Parity Story';
	story.storyFormat = 'Harlowe';
	story.storyFormatVersion = '3.3.9';
	story.tagColors = {scene: 'red'};
	story.script = 'const $score = 1; assets/script.js';
	story.stylesheet = 'tw-story { background-image: url("assets/bg.png"); }';
	story.passages = [
		fakePassage({
			height: 100,
			id: 'start',
			left: 0,
			name: 'Start',
			story: story.id,
			tags: ['scene'],
			text: 'Set $score. [[Next]] <img src="assets/cover.png">',
			top: 0,
			width: 160
		}),
		fakePassage({
			height: 100,
			id: 'next',
			left: 220,
			name: 'Next',
			story: story.id,
			tags: [],
			text: 'Loop [[Next]] and [[Missing]]',
			top: 0,
			width: 160
		}),
		fakePassage({
			height: 100,
			id: 'loose',
			left: 0,
			name: 'Loose',
			story: story.id,
			tags: [],
			text: '',
			top: 180,
			width: 160
		})
	];
	story.startPassage = 'start';
	return story;
}

function runWasmQuery<T>(
	story: Story,
	query: {kind: 'graph'; options: unknown} | {kind: 'index'; options: unknown}
): T {
	const dir = mkdtempSync(path.join(tmpdir(), 'twine-wasm-parity-'));
	const inputPath = path.join(dir, 'input.json');
	const outputPath = path.join(dir, 'output.json');
	const root = process.cwd();
	const wasmPackage = path.join(root, 'src/core/wasm/pkg/twine_wasm.js');
	const wasmBytes = path.join(root, 'src/core/wasm/pkg/twine_wasm_bg.wasm');

	writeFileSync(
		inputPath,
		JSON.stringify({
			...query,
			snapshot: projectSnapshotFromStories([story]),
			storyId: story.id
		})
	);

	const script = `
		import {readFile, writeFile} from 'node:fs/promises';
		import init, {TwineWasmProjectSession} from ${JSON.stringify(
			`file://${wasmPackage}`
		)};
		const input = JSON.parse(await readFile(${JSON.stringify(inputPath)}, 'utf8'));
		await init(await readFile(${JSON.stringify(wasmBytes)}));
		const session = new TwineWasmProjectSession(input.snapshot);
		const result = input.kind === 'graph'
			? session.query_graph_projection(input.storyId, input.options)
			: session.query_story_index(input.storyId, input.options);
		await writeFile(${JSON.stringify(outputPath)}, JSON.stringify(result));
	`;
	const result = spawnSync(process.execPath, ['--input-type=module'], {
		encoding: 'utf8',
		input: script
	});

	try {
		if (result.status !== 0) {
			throw new Error(result.stderr || result.stdout);
		}

		return JSON.parse(readFileSync(outputPath, 'utf8')) as T;
	} finally {
		rmSync(dir, {force: true, recursive: true});
	}
}

function hitShape(hit: {
	line: number;
	matchText: string;
	passageId: string | null;
	scope: string;
	sourceId: string;
}) {
	return {
		line: hit.line,
		matchText: hit.matchText,
		passageId: hit.passageId,
		scope: hit.scope,
		sourceId: hit.sourceId
	};
}

describe('generated WASM core parity', () => {
	it('matches TypeScript graph projections for saved-layout stories', () => {
		const story = parityStory();
		const options = normalizeGraphProjectionOptions({
			layers: {broken: true, resolved: true, selfLinks: true},
			viewport: {height: 420, left: 0, top: 0, width: 500}
		});
		const jsProjection = storyToCoreGraphProjection(story, options);
		const wasmProjection = runWasmQuery<typeof jsProjection>(story, {
			kind: 'graph',
			options
		});

		expect(wasmProjection).toEqual(jsProjection);
	});

	it('matches TypeScript story index facts for diagnostics, symbols, assets, and search', () => {
		const story = parityStory();
		const options = normalizeStoryIndexOptions({
			knownAssets: [
				{
					durationMs: null,
					exists: true,
					height: null,
					kind: 'image',
					missing: false,
					modifiedAt: null,
					normalizedPath: 'assets/unused.png',
					path: 'assets/unused.png',
					previewUrl: null,
					publish: {
						copy: true,
						outputPath: 'assets/unused.png',
						reason: 'Copy asset into published output'
					},
					referenceCount: 0,
					references: [],
					sizeBytes: 42,
					snippet: {
						label: 'Insert asset reference',
						mediaType: 'image',
						text: '<img src="assets/unused.png" alt="">'
					},
					thumbnailUrl: null,
					unused: true,
					width: null
				}
			],
			query: '$score'
		});
		const jsIndex = storyToCoreIndex(story, options);
		const wasmIndex = runWasmQuery<typeof jsIndex>(story, {
			kind: 'index',
			options
		});

		expect(wasmIndex.graph).toEqual(jsIndex.graph);
		expect(wasmIndex.files).toEqual(jsIndex.files);
		expect(wasmIndex.tags).toEqual(jsIndex.tags);
		expect(wasmIndex.tagEntries).toEqual(jsIndex.tagEntries);
		expect(wasmIndex.assets).toEqual(jsIndex.assets);
		expect(wasmIndex.assetInventory).toEqual(jsIndex.assetInventory);
		expect(wasmIndex.symbols).toEqual(jsIndex.symbols);
		expect(wasmIndex.diagnostics.map(diagnostic => diagnostic.code)).toEqual(
			jsIndex.diagnostics.map(diagnostic => diagnostic.code)
		);
		expect(wasmIndex.searchHits.map(hitShape)).toEqual(
			jsIndex.searchHits.map(hitShape)
		);
	});

	it('matches TypeScript story index facts for lean search queries', () => {
		const story = parityStory();
		const options = normalizeStoryIndexOptions({
			includeAssets: false,
			includeContents: false,
			includeDiagnostics: false,
			includeFiles: false,
			includeGraph: false,
			includePassageNames: false,
			includeScript: true,
			includeStylesheet: true,
			includeTags: false,
			includeVariables: false,
			query: 'assets'
		});
		const jsIndex = storyToCoreIndex(story, options);
		const wasmIndex = runWasmQuery<typeof jsIndex>(story, {
			kind: 'index',
			options
		});

		expect(wasmIndex.assetInventory).toEqual([]);
		expect(wasmIndex.assets).toEqual([]);
		expect(wasmIndex.contents).toEqual([]);
		expect(wasmIndex.diagnostics).toEqual([]);
		expect(wasmIndex.files).toEqual([]);
		expect(wasmIndex.graph).toEqual(jsIndex.graph);
		expect(wasmIndex.symbols).toEqual([]);
		expect(wasmIndex.searchHits.map(hitShape)).toEqual(
			jsIndex.searchHits.map(hitShape)
		);
	});
});
