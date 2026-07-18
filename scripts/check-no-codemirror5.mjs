import {readdir, readFile} from 'node:fs/promises';
import {join, relative} from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const sourceRoot = join(root, 'src');
const violations = [];
const removedPackages = [
	'@types/codemirror',
	'codemirror',
	'react-codemirror2'
];
const removedPackageSpecifier = String.raw`(?:@types/codemirror|codemirror|react-codemirror2)(?:/[^'"]*)?`;
const removedPackageImport = new RegExp(
	`(?:\\bfrom\\s+|\\bimport\\s*(?:\\(\\s*)?|\\brequire\\s*\\(\\s*)['"]${removedPackageSpecifier}['"]`
);

export function legacyCodeMirrorImportViolation(source, displayPath) {
	if (
		removedPackageImport.test(source) ||
		/from\s+['"](?:[^'"]*\/)?code-area(?:\/[^'"]*)?['"]/.test(source) ||
		/import\s+['"](?:[^'"]*\/)?code-area(?:\/[^'"]*)?['"]/.test(source) ||
		/import\s*\(\s*['"](?:[^'"]*\/)?code-area(?:\/[^'"]*)?['"]\s*\)/.test(
			source
		)
	) {
		return `${displayPath}: imports the removed CodeMirror 5 runtime or wrapper`;
	}
}

export function legacyCodeMirrorDependencyViolations(packageJson) {
	return removedPackages.flatMap(name =>
		['dependencies', 'devDependencies', 'optionalDependencies'].flatMap(
			section =>
				Object.hasOwn(packageJson[section] ?? {}, name)
					? [`package.json: ${section} still contains ${name}`]
					: []
		)
	);
}

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
		const violation = legacyCodeMirrorImportViolation(source, displayPath);

		if (violation) {
			violations.push(violation);
		}
	}
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
	const packageJson = JSON.parse(
		await readFile(join(root, 'package.json'), 'utf8')
	);

	violations.push(...legacyCodeMirrorDependencyViolations(packageJson));
	await visit(sourceRoot);

	if (violations.length > 0) {
		console.error(violations.join('\n'));
		process.exitCode = 1;
	}
}
