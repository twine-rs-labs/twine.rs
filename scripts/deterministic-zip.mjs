import {deflateRawSync} from 'node:zlib';
import {
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	writeFile
} from 'node:fs/promises';
import path from 'node:path';

const dosEpochDate = (1 << 5) | 1;
const utf8Flag = 0x0800;
const deflateMethod = 8;
const crcTable = new Uint32Array(256);

for (let index = 0; index < crcTable.length; index += 1) {
	let value = index;

	for (let bit = 0; bit < 8; bit += 1) {
		value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	}

	crcTable[index] = value >>> 0;
}

function crc32(contents) {
	let value = 0xffffffff;

	for (const byte of contents) {
		value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
	}

	return (value ^ 0xffffffff) >>> 0;
}

function compareNames(left, right) {
	return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

async function archiveFiles(rootDirectory, relativeDirectory = '') {
	const directory = path.join(rootDirectory, relativeDirectory);
	const entries = (await readdir(directory, {withFileTypes: true})).sort(
		compareNames
	);
	const files = [];

	for (const entry of entries) {
		const relativePath = path.join(relativeDirectory, entry.name);

		if (entry.isDirectory()) {
			files.push(...(await archiveFiles(rootDirectory, relativePath)));
		} else if (entry.isFile()) {
			files.push(relativePath.split(path.sep).join('/'));
		} else {
			throw new Error(
				`Deterministic ZIP input must contain only files and directories: ${relativePath}`
			);
		}
	}

	return files;
}

function assertClassicZipLimit(value, maximum, label) {
	if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
		throw new Error(`${label} exceeds the supported classic ZIP limit.`);
	}
}

function localFileHeader({compressed, contents, crc, name}) {
	const header = Buffer.alloc(30);

	header.writeUInt32LE(0x04034b50, 0);
	header.writeUInt16LE(20, 4);
	header.writeUInt16LE(utf8Flag, 6);
	header.writeUInt16LE(deflateMethod, 8);
	header.writeUInt16LE(0, 10);
	header.writeUInt16LE(dosEpochDate, 12);
	header.writeUInt32LE(crc, 14);
	header.writeUInt32LE(compressed.length, 18);
	header.writeUInt32LE(contents.length, 22);
	header.writeUInt16LE(name.length, 26);
	header.writeUInt16LE(0, 28);

	return header;
}

function centralDirectoryHeader({compressed, contents, crc, name, offset}) {
	const header = Buffer.alloc(46);

	header.writeUInt32LE(0x02014b50, 0);
	header.writeUInt16LE(0x0314, 4);
	header.writeUInt16LE(20, 6);
	header.writeUInt16LE(utf8Flag, 8);
	header.writeUInt16LE(deflateMethod, 10);
	header.writeUInt16LE(0, 12);
	header.writeUInt16LE(dosEpochDate, 14);
	header.writeUInt32LE(crc, 16);
	header.writeUInt32LE(compressed.length, 20);
	header.writeUInt32LE(contents.length, 24);
	header.writeUInt16LE(name.length, 28);
	header.writeUInt16LE(0, 30);
	header.writeUInt16LE(0, 32);
	header.writeUInt16LE(0, 34);
	header.writeUInt16LE(0, 36);
	header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
	header.writeUInt32LE(offset, 42);

	return header;
}

function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
	const record = Buffer.alloc(22);

	record.writeUInt32LE(0x06054b50, 0);
	record.writeUInt16LE(0, 4);
	record.writeUInt16LE(0, 6);
	record.writeUInt16LE(entryCount, 8);
	record.writeUInt16LE(entryCount, 10);
	record.writeUInt32LE(centralSize, 12);
	record.writeUInt32LE(centralOffset, 16);
	record.writeUInt16LE(0, 20);

	return record;
}

export async function writeDeterministicZip({
	archivePath,
	prefix,
	rootDirectory
}) {
	const normalizedPrefix = prefix
		.replaceAll('\\', '/')
		.replace(/^\/+|\/+$/g, '');
	const filePaths = await archiveFiles(rootDirectory);
	const localParts = [];
	const centralParts = [];
	let localOffset = 0;

	assertClassicZipLimit(filePaths.length, 0xffff, 'ZIP entry count');

	for (const filePath of filePaths) {
		const archiveName = normalizedPrefix
			? `${normalizedPrefix}/${filePath}`
			: filePath;
		const name = Buffer.from(archiveName, 'utf8');
		const contents = await readFile(path.join(rootDirectory, filePath));
		const compressed = deflateRawSync(contents, {level: 9});
		const crc = crc32(contents);

		assertClassicZipLimit(name.length, 0xffff, `ZIP path ${archiveName}`);
		assertClassicZipLimit(
			contents.length,
			0xffffffff,
			`ZIP file ${archiveName}`
		);
		assertClassicZipLimit(
			compressed.length,
			0xffffffff,
			`Compressed ZIP file ${archiveName}`
		);
		assertClassicZipLimit(localOffset, 0xffffffff, 'ZIP archive offset');

		const localHeader = localFileHeader({compressed, contents, crc, name});
		localParts.push(localHeader, name, compressed);
		centralParts.push(
			centralDirectoryHeader({
				compressed,
				contents,
				crc,
				name,
				offset: localOffset
			}),
			name
		);
		localOffset += localHeader.length + name.length + compressed.length;
	}

	const centralDirectory = Buffer.concat(centralParts);
	const archive = Buffer.concat([
		...localParts,
		centralDirectory,
		endOfCentralDirectory(
			filePaths.length,
			centralDirectory.length,
			localOffset
		)
	]);
	const temporaryPath = `${archivePath}.tmp-${process.pid}`;

	assertClassicZipLimit(
		localOffset,
		0xffffffff,
		'ZIP central-directory offset'
	);
	assertClassicZipLimit(
		centralDirectory.length,
		0xffffffff,
		'ZIP central-directory size'
	);
	await mkdir(path.dirname(archivePath), {recursive: true});

	try {
		await writeFile(temporaryPath, archive);
		await rename(temporaryPath, archivePath);
	} catch (error) {
		await rm(temporaryPath, {force: true});
		throw error;
	}
}
