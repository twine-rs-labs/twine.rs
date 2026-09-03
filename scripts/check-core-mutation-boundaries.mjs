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
			!displayPath.startsWith('src/core/wasm/') &&
			!displayPath.includes('/__tests__/') &&
			/(?:import|export)[\s\S]*?from\s+['"][^'"]*(?:core\/wasm\/pkg\/twine_wasm|wasm\/pkg\/twine_wasm)['"]/.test(
				source
			)
		) {
			violations.push(
				`${displayPath}: imports the generated WASM package outside the worker/build or boundary-test seam`
			);
		}
		if (
			/refactor-runtime-writer/.test(source) &&
			![
				'src/core/project-host.tsx',
				'src/store/project-session-sync.tsx'
			].includes(displayPath)
		) {
			violations.push(
				`${displayPath}: imports the trusted refactor runtime writer outside its integration boundary`
			);
		}
		if (
			![
				'src/core/project-host.tsx',
				'src/test-util/core-project-host-runtime.ts'
			].includes(displayPath) &&
			/import[\s\S]*?from\s+['"][^'"]*(?:core-project-host-runtime|project-host-runtime)['"]/.test(
				source
			)
		) {
			violations.push(
				`${displayPath}: imports the concrete Core host runtime instead of the public capability facade`
			);
		}
		if (
			![
				'src/core/project-host.tsx',
				'src/core/project-host-public.tsx',
				'src/test-util/core-project-host-runtime.ts'
			].includes(displayPath) &&
			/from\s+['"][^'"]*(?:\/|\.)project-host['"]/.test(source)
		) {
			violations.push(
				`${displayPath}: imports the Core host runtime directly instead of the public facade`
			);
		}
		if (
			![
				'src/core/project-host.tsx',
				'src/core/project-host-public.tsx',
				'src/test-util/core-project-host-runtime.ts'
			].includes(displayPath) &&
			/import\s+(?:type\s+)?{[^}]*\b(?:StoreCoreProjectHost|ProjectScopedCoreProjectHost)\b[^}]*}\s*from\s*['"][^'"]*project-host['"]/s.test(
				source
			)
		) {
			violations.push(
				`${displayPath}: references a concrete Core host instead of the public capability facade`
			);
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
