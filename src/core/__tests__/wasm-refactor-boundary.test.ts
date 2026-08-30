import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import {projectSnapshotFromStories} from '../project-snapshot';
import {fakePassage, fakeStory} from '../../test-util';

describe('generated WASM refactor boundary', () => {
	it('plans multiple chunks then applies a compact Rust-produced passage rename batch', () => {
		const story = fakeStory(0);
		story.id = 'wasm-refactor-story';
		story.passages = Array.from({length: 129}, (_, index) =>
			fakePassage({
				id: `passage-${index}`,
				name: index === 0 ? 'Target' : `Passage ${index}`,
				story: story.id,
				text: index === 1 ? '[[Target]]' : ''
			})
		);
		story.startPassage = 'passage-0';
		const directory = mkdtempSync(path.join(tmpdir(), 'twine-wasm-refactor-'));
		const inputPath = path.join(directory, 'input.json');
		const outputPath = path.join(directory, 'output.json');
		const root = process.cwd();
		const wasmPackage = path.join(root, 'src/core/wasm/pkg/twine_wasm.js');
		const wasmBytes = path.join(root, 'src/core/wasm/pkg/twine_wasm_bg.wasm');

		writeFileSync(
			inputPath,
			JSON.stringify({snapshot: projectSnapshotFromStories([story])})
		);
		const script = `
			import {readFile, writeFile} from 'node:fs/promises';
			import init, {TwineWasmProjectSession} from ${JSON.stringify(`file://${wasmPackage}`)};
			const input = JSON.parse(await readFile(${JSON.stringify(inputPath)}, 'utf8'));
			await init(await readFile(${JSON.stringify(wasmBytes)}));
			const session = new TwineWasmProjectSession(input.snapshot);
			session.set_revision(1);
			session.sync_refactor_runtime({buffers: [], external: null, projectRevision: 1, provider: null});
			let result = session.begin_passage_rename_plan({storyId: 'wasm-refactor-story', passageId: 'passage-0', afterName: 'Renamed'});
			const chunks = [];
			while (result.type === 'begun' || result.type === 'pending') {
				result = session.continue_passage_rename_plan(result.task);
				chunks.push(result.type);
			}
			if (result.type !== 'complete') throw new Error(JSON.stringify({chunks, result}));
			const summary = result.summary;
			const detail = session.query_refactor_plan_detail(summary.firstDetailCursor);
			const applied = session.apply_refactor_plan({expectedProjectRevision: 1, planId: summary.planId, selection: {type: 'all'}});
			const replacement = new TwineWasmProjectSession(input.snapshot);
			replacement.set_revision(1);
			const replacedDetail = replacement.query_refactor_plan_detail(summary.firstDetailCursor);
			const stale = new TwineWasmProjectSession(input.snapshot);
			stale.set_revision(1);
			stale.sync_refactor_runtime({buffers: [], external: null, projectRevision: 1, provider: null});
			let staleResult = stale.begin_passage_rename_plan({storyId: 'wasm-refactor-story', passageId: 'passage-0', afterName: 'Renamed'});
			staleResult = stale.continue_passage_rename_plan(staleResult.task);
			stale.apply({type: 'updatePassageText', story_id: 'wasm-refactor-story', passage_id: 'passage-1', text: 'intervening mutation'}, true);
			staleResult = stale.continue_passage_rename_plan(staleResult.task);
			await writeFile(${JSON.stringify(outputPath)}, JSON.stringify({applied, chunks, detail, replacedDetail, staleResult, revision: session.revision(), status: session.status()}));
		`;
		const result = spawnSync(process.execPath, ['--input-type=module'], {
			encoding: 'utf8',
			input: script
		});

		try {
			if (result.status !== 0) {
				throw new Error(result.stderr || result.stdout);
			}
			const output = JSON.parse(readFileSync(outputPath, 'utf8')) as {
				applied: {
					batch: {
						patches: Array<{
							type: string;
							changes?: {name?: string | null; text?: string | null};
						}>;
					};
					type: string;
				};
				chunks: string[];
				detail: {type: string};
				replacedDetail: {failure: {code: string}; type: string};
				revision: number;
				staleResult: {failure: {code: string}; type: string};
				status: {canUndo: boolean; undoKind: string | null};
			};

			expect(output.chunks.filter(type => type === 'pending')).toHaveLength(1);
			expect(output.chunks).toHaveLength(2);
			expect(output.chunks.at(-1)).toBe('complete');
			expect(output.detail.type).toBe('page');
			expect(output.replacedDetail).toMatchObject({
				failure: {code: 'plan-evicted'},
				type: 'failure'
			});
			expect(output.staleResult).toMatchObject({
				failure: {code: 'stale-project-revision'},
				type: 'failure'
			});
			expect(output.applied.type).toBe('applied');
			expect(output.applied.batch.patches).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						changes: expect.objectContaining({name: 'Renamed'}),
						type: 'passageUpdated'
					}),
					expect.objectContaining({
						changes: expect.objectContaining({text: '[[Renamed]]'}),
						type: 'passageUpdated'
					})
				])
			);
			expect(output.revision).toBe(2);
			expect(output.status).toMatchObject({
				canUndo: true,
				undoKind: 'refactor'
			});
		} finally {
			rmSync(directory, {force: true, recursive: true});
		}
	});
});
