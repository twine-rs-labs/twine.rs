import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const fixtureDirectory = join(root, 'src', '__boundary-fixture__');
const fixturePath = join(fixtureDirectory, 'illegal-wasm-import.ts');

test('core mutation boundary checker rejects generated WASM imports outside the worker seam', async () => {
	await mkdir(fixtureDirectory, {recursive: true});
	await writeFile(
		fixturePath,
		"import wasm from '../core/wasm/pkg/twine_wasm';\nvoid wasm;\n"
	);
	try {
		await assert.rejects(
			execFileAsync('node', ['scripts/check-core-mutation-boundaries.mjs'], {
				cwd: root
			}),
			error =>
				error.stderr.includes(
					'src/__boundary-fixture__/illegal-wasm-import.ts: imports the generated WASM package'
				)
		);
	} finally {
		await rm(fixtureDirectory, {force: true, recursive: true});
	}
});
