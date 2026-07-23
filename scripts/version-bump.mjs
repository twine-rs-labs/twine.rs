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
const semverPattern =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
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
		'Usage: npm run version:bump -- [patch|minor|major|semver] [--dry-run]',
		'',
		'Examples:',
		'  npm run version:bump',
		'  npm run version:bump -- minor',
		'  npm run version:bump -- major',
		'  npm run version:bump -- 1.2.3',
		'  npm run version:bump -- 1.3.0-beta.1'
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
	const match = semverPattern.exec(version);

	if (!match) {
		throw new Error(
			`Expected a valid SemVer version like 0.1.0 or 0.2.0-beta.1, got ${version}`
		);
	}

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4],
		build: match[5]
	};
}

function formatVersion({major, minor, patch}) {
	return `${major}.${minor}.${patch}`;
}

function bumpVersion(version, kind) {
	switch (kind) {
		case 'major': {
			const parsed = parseVersion(version);

			return formatVersion({major: parsed.major + 1, minor: 0, patch: 0});
		}
		case 'minor': {
			const parsed = parseVersion(version);

			return formatVersion({
				major: parsed.major,
				minor: parsed.minor + 1,
				patch: 0
			});
		}
		case 'patch': {
			const parsed = parseVersion(version);

			return formatVersion({
				major: parsed.major,
				minor: parsed.minor,
				patch: parsed.patch + 1
			});
		}
		default: {
			parseVersion(kind);

			return kind;
		}
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
