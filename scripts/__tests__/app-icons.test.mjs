import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..'
);

test('release and preview application icons differ', async () => {
	for (const suffix of ['.png', '-no-padding.png', '.ico', '-no-padding.ico']) {
		const [preview, release] = await Promise.all([
			readFile(path.join(rootDir, `icons/app-preview${suffix}`)),
			readFile(path.join(rootDir, `icons/app-release${suffix}`))
		]);

		assert.notDeepEqual(
			preview,
			release,
			`preview and release ${suffix} icons must differ`
		);
	}
});
