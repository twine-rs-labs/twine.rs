#!/usr/bin/env node
// Buckets electron-builder artifacts into release/{mac,windows,linux}/.
import {createHash} from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import {join} from 'node:path';

const releaseDir = process.argv[2] || join(process.cwd(), 'release');
const guideName = 'WHICH TO DOWNLOAD.md';
const checksumsName = 'SHA256SUMS.txt';

const buckets = [
	{
		dir: 'windows',
		match: name => name.includes('-win-'),
		primary: name => name.endsWith('.exe')
	},
	{
		dir: 'mac',
		match: name => name.includes('-mac-'),
		primary: name => name.endsWith('.dmg') && name.includes('-universal.')
	},
	{
		dir: 'linux',
		match: name => name.includes('-linux-'),
		primary: name => name.endsWith('.AppImage')
	}
];

const builderMetadata = new Set([
	'.DS_Store',
	'builder-debug.yml',
	'builder-effective-config.yaml',
	checksumsName,
	guideName
]);

function packageVersion() {
	try {
		const pkg = JSON.parse(
			readFileSync(join(process.cwd(), 'package.json'), 'utf8')
		);

		return typeof pkg.version === 'string' ? pkg.version : 'VERSION';
	} catch {
		return 'VERSION';
	}
}

function isScratchDir(name, fullPath) {
	if (name.endsWith('-unpacked')) {
		return true;
	}

	if (name === '.icon-icns') {
		return true;
	}

	if (name.startsWith('mac-')) {
		return true;
	}

	return name === 'mac' && existsSync(join(fullPath, 'Twine RS.app'));
}

function removeBuilderScratchDirs() {
	let removed = 0;

	for (const name of safeReaddir(releaseDir)) {
		const fullPath = join(releaseDir, name);

		if (safeStat(fullPath)?.isDirectory() && isScratchDir(name, fullPath)) {
			rmSync(fullPath, {force: true, recursive: true});
			removed++;
		}
	}

	return removed;
}

function bucketArtifacts() {
	let dropped = 0;
	let moved = 0;
	const perOs = {linux: 0, mac: 0, windows: 0};

	for (const name of safeReaddir(releaseDir)) {
		const fullPath = join(releaseDir, name);
		const stat = safeStat(fullPath);

		if (!stat || stat.isDirectory()) {
			continue;
		}

		if (
			name.endsWith('.blockmap') ||
			/^latest-.*\.ya?ml$/.test(name) ||
			builderMetadata.has(name)
		) {
			rmSync(fullPath, {force: true});
			dropped++;
			continue;
		}

		const bucket = buckets.find(candidate => candidate.match(name));

		if (!bucket) {
			rmSync(fullPath, {force: true});
			dropped++;
			continue;
		}

		const destDir = bucket.primary(name)
			? join(releaseDir, bucket.dir)
			: join(releaseDir, bucket.dir, 'alternatives');

		mkdirSync(destDir, {recursive: true});
		renameSync(fullPath, join(destDir, name));
		perOs[bucket.dir]++;
		moved++;
	}

	return {dropped, moved, perOs};
}

function safeReaddir(dir) {
	try {
		return readdirSync(dir).sort();
	} catch {
		console.error(`organize-release: no folder at ${dir}`);
		process.exit(1);
	}
}

function safeStat(path) {
	try {
		return statSync(path);
	} catch {
		return undefined;
	}
}

function collectDownloads() {
	const downloads = {};

	for (const bucket of buckets) {
		downloads[bucket.dir] = listDownloadFiles(bucket.dir);
	}

	return downloads;
}

function listDownloadFiles(dir) {
	const files = [];
	const root = join(releaseDir, dir);

	for (const name of safeOptionalReaddir(root)) {
		const fullPath = join(root, name);

		if (safeStat(fullPath)?.isFile()) {
			files.push(`${dir}/${name}`);
		}
	}

	for (const name of safeOptionalReaddir(join(root, 'alternatives'))) {
		const fullPath = join(root, 'alternatives', name);

		if (safeStat(fullPath)?.isFile()) {
			files.push(`${dir}/alternatives/${name}`);
		}
	}

	return files;
}

function safeOptionalReaddir(dir) {
	try {
		return readdirSync(dir).sort();
	} catch {
		return [];
	}
}

function preferredDownload(files, predicate) {
	return files.find(predicate) ?? files[0] ?? null;
}

function releaseGuide(version, downloads) {
	const windows = downloads.windows ?? [];
	const mac = downloads.mac ?? [];
	const linux = downloads.linux ?? [];
	const preferredWindows = preferredDownload(
		windows,
		file => !file.includes('/alternatives/') && file.endsWith('.exe')
	);
	const preferredMac = preferredDownload(
		mac,
		file => !file.includes('/alternatives/') && file.endsWith('.dmg')
	);
	const preferredLinuxX64 = preferredDownload(
		linux,
		file =>
			!file.includes('/alternatives/') &&
			(file.includes('-x64.') || file.includes('-x86_64.')) &&
			file.endsWith('.AppImage')
	);
	const preferredLinuxArm64 = preferredDownload(
		linux,
		file =>
			!file.includes('/alternatives/') &&
			file.includes('-arm64.') &&
			file.endsWith('.AppImage')
	);
	const startHere = [
		preferredWindows ? `- Windows: \`${preferredWindows}\`` : null,
		preferredMac ? `- Mac: \`${preferredMac}\`` : null,
		preferredLinuxX64 ? `- Linux x64: \`${preferredLinuxX64}\`` : null,
		preferredLinuxArm64 ? `- Linux ARM64: \`${preferredLinuxArm64}\`` : null
	]
		.filter(Boolean)
		.join('\n');

	return `# Which To Download

Twine RS ${version}

Most desktop users should use the file directly inside their OS folder:

${startHere || '- No downloads found yet. Run `npm run build:electron` first.'}

Use an \`alternatives/\` folder only when the main download does not match the machine or the primary package format is inconvenient.

## Windows

${downloadList(windows, 'windows')}

## Mac

${downloadList(mac, 'mac')}

## Linux

${downloadList(linux, 'linux')}

## Checksums

Use \`${checksumsName}\` to verify downloads.
`;
}

function downloadList(files, platform) {
	if (files.length === 0) {
		return 'No downloads generated for this platform.';
	}

	return files
		.map(file => `- \`${file}\`: ${downloadNote(file, platform)}`)
		.join('\n');
}

function downloadNote(file, platform) {
	const name = file.split('/').pop() ?? file;
	const notes = [];

	notes.push(
		file.includes('/alternatives/')
			? 'alternative download'
			: 'recommended first download'
	);

	if (platform === 'windows') {
		if (name.endsWith('.exe')) {
			notes.push('installer for 64-bit Windows');
		}
	} else if (platform === 'mac') {
		if (name.includes('-universal.')) {
			notes.push('universal Apple Silicon and Intel Mac build');
		}

		if (name.endsWith('.dmg')) {
			notes.push(
				'open the DMG, drag the app to Applications, then right-click Open the first time if macOS warns'
			);
		}
	} else if (platform === 'linux') {
		if (name.includes('-x64.')) {
			notes.push('64-bit Intel/AMD Linux');
		}

		if (name.includes('-x86_64.')) {
			notes.push('64-bit Intel/AMD Linux');
		}

		if (name.includes('-arm64.')) {
			notes.push('64-bit ARM Linux');
		}

		if (name.endsWith('.AppImage')) {
			notes.push('mark executable if needed with `chmod +x`, then run it');
		}

		if (name.endsWith('.zip')) {
			notes.push(
				'unzip first; use this if AppImage does not work on your setup'
			);
		}
	}

	return `${notes.join('; ')}.`;
}

function writeChecksums(downloads) {
	const files = Object.values(downloads).flat().sort();
	const lines = files.map(file => {
		const hash = createHash('sha256')
			.update(readFileSync(join(releaseDir, file)))
			.digest('hex');

		return `${hash}  ${file}`;
	});

	writeFileSync(join(releaseDir, checksumsName), `${lines.join('\n')}\n`);
}

const removedDirs = removeBuilderScratchDirs();
const {dropped, moved, perOs} = bucketArtifacts();
const downloads = collectDownloads();

writeFileSync(
	join(releaseDir, guideName),
	releaseGuide(packageVersion(), downloads)
);
writeChecksums(downloads);

console.log(
	`organize-release: ${moved} artifact(s) bucketed ` +
		`(windows ${perOs.windows}, mac ${perOs.mac}, linux ${perOs.linux}), ` +
		`${dropped} sidecar(s) removed, ${removedDirs} scratch dir(s) removed.`
);
console.log(`Guide written to release/${guideName}`);
console.log('Downloads ready under release/{windows,mac,linux}/');
