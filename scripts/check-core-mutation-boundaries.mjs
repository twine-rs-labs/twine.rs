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
		if (
			!displayPath.startsWith('src/core/') &&
			/\bqueryStoryIndexAsync\(\s*[^,\n)]+\s*\)/.test(source)
		) {
			violations.push(
				`${displayPath}: issues an unscoped full-story-index query; use a bounded read-model query or explicit index options`
			);
		}
		if (
			/^(?:src\/routes|src\/components|src\/dialogs|src\/route-actions)\//.test(
				displayPath
			) &&
			displayPath !== 'src/routes/build/build-route.tsx' &&
			/\b(?:passage|selectedPassage|target|start)\.text\b/.test(source)
		) {
			violations.push(
				`${displayPath}: reads a passage body from the React story mirror; use a bounded session query or explicit document materialization`
			);
		}
		if (
			displayPath === 'src/store/project-session-sync.tsx' &&
			/\b(?:passageToSnapshot|storyToSnapshot)\b|snapshot\.stories/.test(source)
		) {
			violations.push(
				`${displayPath}: reconstructs external deltas from full renderer snapshots`
			);
		}
		if (displayPath === 'src/electron/main-process/project-folder.ts') {
			const watcherStart = source.indexOf('async function pollProjectSession');
			const watcherEnd = source.indexOf(
				'function scheduleProjectSessionPoll',
				watcherStart
			);
			const watcherSource = source.slice(watcherStart, watcherEnd);

			if (/readProjectSessionSnapshot|readProjectStories/.test(watcherSource)) {
				violations.push(
					`${displayPath}: watcher polling loads a complete project snapshot`
				);
			}
		}
	}
}

await visit(sourceRoot);

if (violations.length > 0) {
	console.error(violations.join('\n'));
	process.exitCode = 1;
}
