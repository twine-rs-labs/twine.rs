import {readFile} from 'node:fs/promises';

const packageLock = JSON.parse(
	await readFile(new URL('../package-lock.json', import.meta.url), 'utf8')
);
const cachePackages = {
	electron: 'node_modules/electron',
	electron_builder: 'node_modules/electron-builder'
};

for (const [output, packagePath] of Object.entries(cachePackages)) {
	const version = packageLock.packages?.[packagePath]?.version;

	if (
		typeof version !== 'string' ||
		!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)
	) {
		throw new Error(`No safe locked version found for ${packagePath}.`);
	}

	process.stdout.write(`${output}=${version}\n`);
}
