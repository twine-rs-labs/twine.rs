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
		const productSurface =
			/^(?:src\/routes|src\/components|src\/dialogs|src\/route-actions)\//.test(
				displayPath
			);

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
		if (productSurface && /\bqueryPassageFactsAsync\s*\(/.test(source)) {
			violations.push(
				`${displayPath}: requests compatibility passage facts; use local passage facts plus a bounded backlink page`
			);
		}
		if (
			productSurface &&
			displayPath !== 'src/routes/build/build-route.tsx' &&
			/\b(?:passage|selectedPassage|target|start)\.text\b/.test(source)
		) {
			violations.push(
				`${displayPath}: reads a passage body from the React story mirror; use a bounded session query or explicit document materialization`
			);
		}
		if (
			productSurface &&
			/import\s*{[^}]*\b(?:createStory|deleteStory|duplicateStory|importStories)\b[^}]*}\s*from\s*['"][^'"]*store\/stories['"]/s.test(
				source
			)
		) {
			violations.push(
				`${displayPath}: imports a legacy persistent story action; route lifecycle through ProjectLibraryService or project content through CoreProjectHost`
			);
		}
		if (
			productSurface &&
			/type:\s*['"](?:applyCorePatchBatch|createStory|deleteStory|updateStory|createPassage|createPassages|deletePassage|deletePassages|updatePassage)['"]/.test(
				source
			)
		) {
			violations.push(
				`${displayPath}: constructs a persistent story reducer action outside the core or project-library boundary`
			);
		}
		if (
			productSurface &&
			/\b(?:twineElectron|desktopBridge\(\)|bridge)\??\.(?:createProjectFolder|duplicateProjectFolder|deleteProjectFolder|openProjectFolder|prepareProjectImport)\s*\(/.test(
				source
			)
		) {
			violations.push(
				`${displayPath}: calls a native project lifecycle bridge directly; use ProjectLibraryService`
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
