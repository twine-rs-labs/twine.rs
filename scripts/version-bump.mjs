#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = path.join(root, 'package.json');
const packageLockPath = path.join(root, 'package-lock.json');
const cargoTomlPath = path.join(root, 'Cargo.toml');
const cargoLockPath = path.join(root, 'Cargo.lock');
const bumpKinds = new Set(['major', 'minor', 'patch']);
const workspaceCrateNames = [
	'twine_cli',
	'twine_core',
	'twine_export',
	'twine_graph',
	'twine_model',
	'twine_native',
	'twine_parse',
	'twine_search',
	'twine_store',
	'twine_wasm'
];

function usage() {
	return [
		'Usage: npm run version:bump -- [patch|minor|major|x.y.z] [--dry-run]',
		'',
		'Examples:',
		'  npm run version:bump',
		'  npm run version:bump -- minor',
		'  npm run version:bump -- major',
		'  npm run version:bump -- 1.2.3'
	].join('\n');
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value, dryRun) {
	if (!dryRun) {
		fs.writeFileSync(filePath, `${JSON.stringify(value, null, '\t')}\n`);
	}
}

function parseVersion(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);

	if (!match) {
		throw new Error(
			`Expected a plain semver version like 0.1.0, got ${version}`
		);
	}

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3])
	};
}

function formatVersion({major, minor, patch}) {
	return `${major}.${minor}.${patch}`;
}

function bumpVersion(version, kind) {
	const parsed = parseVersion(version);

	switch (kind) {
		case 'major':
			return formatVersion({major: parsed.major + 1, minor: 0, patch: 0});
		case 'minor':
			return formatVersion({
				major: parsed.major,
				minor: parsed.minor + 1,
				patch: 0
			});
		case 'patch':
			return formatVersion({
				major: parsed.major,
				minor: parsed.minor,
				patch: parsed.patch + 1
			});
		default:
			if (/^\d+\.\d+\.\d+$/.test(kind)) {
				return kind;
			}

			throw new Error(`Unknown bump target "${kind}".\n\n${usage()}`);
	}
}

function replaceWorkspaceVersion(filePath, fromVersion, toVersion, dryRun) {
	const contents = fs.readFileSync(filePath, 'utf8');
	const next = contents.replace(
		/(\[workspace\.package\][\s\S]*?\nversion = ")([^"]+)(")/,
		(match, before, version, after) => {
			if (version !== fromVersion) {
				throw new Error(
					`Cargo.toml workspace version is ${version}, expected ${fromVersion}`
				);
			}

			return `${before}${toVersion}${after}`;
		}
	);

	if (next === contents) {
		throw new Error('Could not find [workspace.package] version in Cargo.toml');
	}

	if (!dryRun) {
		fs.writeFileSync(filePath, next);
	}
}

function replaceCargoLockWorkspaceVersions(
	filePath,
	fromVersion,
	toVersion,
	dryRun
) {
	if (!fs.existsSync(filePath)) {
		return;
	}

	const contents = fs.readFileSync(filePath, 'utf8');
	let replacements = 0;
	const next = contents.replace(
		/(name = "([^"]+)"\nversion = ")([^"]+)(")/g,
		(match, before, crateName, version, after) => {
			if (!workspaceCrateNames.includes(crateName)) {
				return match;
			}

			if (version !== fromVersion) {
				throw new Error(
					`Cargo.lock ${crateName} version is ${version}, expected ${fromVersion}`
				);
			}

			replacements += 1;
			return `${before}${toVersion}${after}`;
		}
	);

	if (replacements === 0) {
		throw new Error('Could not find workspace crate versions in Cargo.lock');
	}

	if (!dryRun) {
		fs.writeFileSync(filePath, next);
	}
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
	console.log(usage());
	process.exit(0);
}

const dryRun = args.includes('--dry-run');
const target = args.find(arg => !arg.startsWith('-')) ?? 'patch';

try {
	const packageJson = readJson(packageJsonPath);
	const packageLock = readJson(packageLockPath);
	const currentVersion = packageJson.version;
	const nextVersion = bumpVersion(currentVersion, target);

	if (!bumpKinds.has(target) && target === currentVersion) {
		throw new Error(`Version is already ${currentVersion}`);
	}

	if (packageLock.version !== currentVersion) {
		throw new Error(
			`package-lock.json version is ${packageLock.version}, expected ${currentVersion}`
		);
	}

	if (packageLock.packages?.['']?.version !== currentVersion) {
		throw new Error(
			`package-lock root package version is ${packageLock.packages?.['']?.version}, expected ${currentVersion}`
		);
	}

	packageJson.version = nextVersion;
	packageLock.version = nextVersion;
	packageLock.packages[''].version = nextVersion;

	writeJson(packageJsonPath, packageJson, dryRun);
	writeJson(packageLockPath, packageLock, dryRun);
	replaceWorkspaceVersion(cargoTomlPath, currentVersion, nextVersion, dryRun);
	replaceCargoLockWorkspaceVersions(
		cargoLockPath,
		currentVersion,
		nextVersion,
		dryRun
	);

	console.log(
		`${dryRun ? 'Would bump' : 'Bumped'} version ${currentVersion} -> ${nextVersion}`
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
