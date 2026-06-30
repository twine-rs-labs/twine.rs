import {readdir, readFile} from 'node:fs/promises';
import {join, relative} from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const sourceRoot = join(root, 'src');
const violations = [];

async function visit(directory) {
	for (const entry of await readdir(directory, {withFileTypes: true})) {
		const path = join(directory, entry.name);

		if (entry.isDirectory()) {
			if (!['__tests__', '__mocks__'].includes(entry.name)) {
				await visit(path);
			}
			continue;
		}
		if (!/\.[jt]sx?$/.test(entry.name)) {
			continue;
		}

		const source = await readFile(path, 'utf8');
		const displayPath = relative(root, path);

		if (/from\s+['"][^'"]*undoable-stories/.test(source)) {
			violations.push(`${displayPath}: imports the removed legacy undo store`);
		}
		if (
			!displayPath.startsWith('src/store/') &&
			/\breplaceInStory\s*\(/.test(source)
		) {
			violations.push(
				`${displayPath}: calls the persistent reducer replace helper`
			);
		}
	}
}

await visit(sourceRoot);

if (violations.length > 0) {
	console.error(violations.join('\n'));
	process.exitCode = 1;
}
