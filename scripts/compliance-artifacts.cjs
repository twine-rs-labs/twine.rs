const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync
} = require('node:fs');
const path = require('node:path');

const COMPLIANCE_FILES = [
	'LICENSE',
	'THIRD_PARTY_NOTICES.md',
	'sbom.cdx.json',
	'LICENSES.chromium.html'
];
const GENERATED_COMPLIANCE_FILES = COMPLIANCE_FILES.slice(1);
const RUST_ROOT_PACKAGES = ['twine_native', 'twine_wasm'];
const licenseFilePattern = /^(?:licen[cs]e|copying|notice)(?:[._-].*|$)/i;

function fail(message) {
	throw new Error(`compliance: ${message}`);
}

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sha256(contents) {
	return createHash('sha256').update(contents).digest('hex');
}

function normalizedText(contents) {
	return contents.replace(/\r\n?/g, '\n').trimEnd() + '\n';
}

function normalizeLicense(license) {
	if (Array.isArray(license)) {
		license = license.map(item => item.type ?? item).join(' OR ');
	}

	if (typeof license !== 'string' || license.trim() === '') {
		return undefined;
	}

	return license.trim().replace(/^MIT\/Apache-2\.0$/, 'MIT OR Apache-2.0');
}

function normalizeRepository(repository, fallback) {
	let value = typeof repository === 'object' ? repository?.url : repository;

	value = value || fallback;
	if (typeof value !== 'string' || value.trim() === '') {
		return undefined;
	}

	value = value.trim();
	if (/^[\w.-]+\/[\w.-]+$/.test(value)) {
		value = `https://github.com/${value}`;
	} else if (value.startsWith('github:')) {
		value = `https://github.com/${value.slice('github:'.length)}`;
	} else if (value.startsWith('git@github.com:')) {
		value = `https://github.com/${value.slice('git@github.com:'.length)}`;
	} else if (value.startsWith('git+')) {
		value = value.slice('git+'.length);
	} else if (value.startsWith('git://')) {
		value = `https://${value.slice('git://'.length)}`;
	}

	return value.replace(/\.git$/, '');
}

function purlName(name) {
	if (!name.startsWith('@')) {
		return encodeURIComponent(name);
	}

	const [scope, packageName] = name.split('/');
	return `${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}`;
}

function npmPurl(name, version) {
	return `pkg:npm/${purlName(name)}@${encodeURIComponent(version)}`;
}

function cargoPurl(name, version) {
	return `pkg:cargo/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function storyFormatPurl(directory, version) {
	return `pkg:generic/${encodeURIComponent(directory)}@${encodeURIComponent(
		version
	)}`;
}

function licenseFiles(directory) {
	return readdirSync(directory, {withFileTypes: true})
		.filter(entry => entry.isFile() && licenseFilePattern.test(entry.name))
		.map(entry => ({
			name: entry.name,
			text: normalizedText(
				readFileSync(path.join(directory, entry.name), 'utf8')
			)
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

function resolveDependencyLocation({
	dependency,
	lockPackages,
	parentLocation,
	rootDir
}) {
	let directory = path.join(rootDir, parentLocation);

	while (directory.startsWith(rootDir)) {
		const candidate = path.join(directory, 'node_modules', dependency);
		const location = path
			.relative(rootDir, candidate)
			.split(path.sep)
			.join('/');

		if (
			lockPackages[location] &&
			existsSync(path.join(candidate, 'package.json'))
		) {
			return location;
		}

		if (directory === rootDir) {
			break;
		}
		directory = path.dirname(directory);
	}

	fail(
		`could not resolve production dependency ${dependency} from ${
			parentLocation || 'the application root'
		}`
	);
}

function productionNpmLocations(rootDir, lockPackages) {
	const rootManifest = readJson(path.join(rootDir, 'package.json'));
	const queue = Object.keys(rootManifest.dependencies ?? {}).map(
		dependency => ({
			dependency,
			parentLocation: ''
		})
	);
	const locations = new Set();

	while (queue.length > 0) {
		const request = queue.pop();
		const location = resolveDependencyLocation({
			...request,
			lockPackages,
			rootDir
		});
		if (locations.has(location)) {
			continue;
		}

		locations.add(location);
		const manifest = readJson(path.join(rootDir, location, 'package.json'));
		const dependencies = {
			...(manifest.dependencies ?? {}),
			...(manifest.optionalDependencies ?? {})
		};
		for (const dependency of Object.keys(dependencies)) {
			queue.push({dependency, parentLocation: location});
		}
	}

	return [...locations].sort();
}

function integrityHashes(integrity) {
	if (typeof integrity !== 'string') {
		return undefined;
	}

	const hashes = integrity
		.split(/\s+/)
		.map(value => value.match(/^(sha(?:256|384|512))-(.+)$/))
		.filter(Boolean)
		.map(match => ({
			alg: match[1].toUpperCase().replace('SHA', 'SHA-'),
			content: Buffer.from(match[2], 'base64').toString('hex')
		}));

	return hashes.length > 0 ? hashes : undefined;
}

function collectNpmPackages(rootDir) {
	const lock = readJson(path.join(rootDir, 'package-lock.json'));
	const components = [];

	for (const location of productionNpmLocations(rootDir, lock.packages ?? {})) {
		const locked = lock.packages[location];
		const directory = path.join(rootDir, location);
		const manifestPath = path.join(directory, 'package.json');
		if (!existsSync(manifestPath)) {
			fail(
				`${location} is a production lockfile entry but its installed package is missing`
			);
		}

		const manifest = readJson(manifestPath);
		const fallbackManifest = existsSync(path.join(directory, 'bower.json'))
			? readJson(path.join(directory, 'bower.json'))
			: {};
		const name = manifest.name;
		const version = locked.version ?? manifest.version;
		const license = normalizeLicense(
			locked.license ??
				manifest.license ??
				manifest.licenses ??
				fallbackManifest.license
		);

		if (!name || !version || !license) {
			fail(`${location} is missing a name, version, or license declaration`);
		}

		const purl = npmPurl(name, version);
		components.push({
			bomRef: purl,
			ecosystem: 'npm',
			hashes: integrityHashes(locked.integrity),
			license,
			licenseFiles: licenseFiles(directory),
			locations: [location],
			name,
			purl,
			source: normalizeRepository(
				manifest.repository,
				manifest.homepage ?? locked.resolved
			),
			version
		});
	}

	return deduplicateComponents(components);
}

function cargoMetadata(rootDir) {
	const cargo = process.env.CARGO ?? 'cargo';
	const output = execFileSync(
		cargo,
		['metadata', '--locked', '--format-version', '1'],
		{
			cwd: rootDir,
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024
		}
	);

	return JSON.parse(output);
}

function collectCargoPackages(rootDir, metadata = cargoMetadata(rootDir)) {
	const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
	const nodes = new Map(
		(metadata.resolve?.nodes ?? []).map(node => [node.id, node])
	);
	const workspace = new Set(metadata.workspace_members ?? []);
	const roots = RUST_ROOT_PACKAGES.map(name =>
		metadata.packages.find(pkg => pkg.name === name && workspace.has(pkg.id))
	);

	if (roots.some(root => !root)) {
		fail(
			`Cargo metadata must contain workspace roots ${RUST_ROOT_PACKAGES.join(', ')}`
		);
	}

	const reachable = new Set();
	const stack = roots.map(root => root.id);
	while (stack.length > 0) {
		const id = stack.pop();
		if (reachable.has(id)) {
			continue;
		}

		reachable.add(id);
		for (const dependency of nodes.get(id)?.deps ?? []) {
			if (dependency.dep_kinds.some(kind => kind.kind !== 'dev')) {
				stack.push(dependency.pkg);
			}
		}
	}

	const components = [];
	for (const id of reachable) {
		if (workspace.has(id)) {
			continue;
		}

		const pkg = packages.get(id);
		const license = normalizeLicense(pkg?.license);
		if (!pkg || !license) {
			fail(
				`reachable Cargo package ${id} is missing package metadata or a license`
			);
		}

		const purl = cargoPurl(pkg.name, pkg.version);
		components.push({
			bomRef: purl,
			ecosystem: 'cargo',
			license,
			licenseFiles: licenseFiles(path.dirname(pkg.manifest_path)),
			name: pkg.name,
			purl,
			source: normalizeRepository(
				pkg.repository,
				pkg.homepage ?? `https://crates.io/crates/${pkg.name}/${pkg.version}`
			),
			version: pkg.version
		});
	}

	return deduplicateComponents(components);
}

function collectStoryFormats(rootDir) {
	const formatsDir = path.join(rootDir, 'public', 'story-formats');
	const manifest = readJson(path.join(formatsDir, 'licenses.json'));
	if (manifest.version !== 1 || !Array.isArray(manifest.formats)) {
		fail('public/story-formats/licenses.json has an unsupported schema');
	}

	const actualDirectories = readdirSync(formatsDir, {withFileTypes: true})
		.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
		.map(entry => entry.name)
		.sort();
	const declaredDirectories = manifest.formats
		.map(format => format.directory)
		.sort();

	if (
		actualDirectories.length !== declaredDirectories.length ||
		actualDirectories.some(
			(directory, index) => directory !== declaredDirectories[index]
		)
	) {
		fail(
			`story-format inventory does not match public/story-formats directories: ` +
				`declared ${declaredDirectories.join(', ')}; found ${actualDirectories.join(', ')}`
		);
	}

	const components = manifest.formats.map(format => {
		const directory = path.join(formatsDir, format.directory);
		const formatPath = path.join(directory, 'format.js');
		const noticePath = path.join(directory, 'LICENSE');
		const license = normalizeLicense(format.license);

		if (
			!format.directory ||
			!format.name ||
			!format.version ||
			!license ||
			!format.source ||
			!existsSync(formatPath) ||
			!existsSync(noticePath)
		) {
			fail(
				`${format.directory ?? 'unknown story format'} is missing inventory metadata, format.js, or LICENSE`
			);
		}

		const purl = storyFormatPurl(format.directory, format.version);
		return {
			bomRef: purl,
			directory: format.directory,
			ecosystem: 'story-format',
			hashes: [
				{
					alg: 'SHA-256',
					content: sha256(readFileSync(formatPath))
				}
			],
			license,
			licenseFiles: licenseFiles(directory),
			licenseHash: sha256(readFileSync(noticePath)),
			name: format.name,
			purl,
			source: format.source,
			version: format.version
		};
	});

	return deduplicateComponents(components);
}

function collectBundledAssets(rootDir) {
	const assetsManifest = readJson(
		path.join(rootDir, 'scripts', 'compliance-assets.json')
	);
	if (assetsManifest.version !== 1 || !Array.isArray(assetsManifest.assets)) {
		fail('scripts/compliance-assets.json has an unsupported schema');
	}

	const fontsDirectory = path.join(
		rootDir,
		'src',
		'styles',
		'design-system',
		'fonts'
	);
	const actualFonts = readdirSync(fontsDirectory, {withFileTypes: true})
		.filter(entry => entry.isFile() && entry.name.endsWith('.woff2'))
		.map(entry => path.posix.join('src/styles/design-system/fonts', entry.name))
		.sort();
	const declaredFonts = assetsManifest.assets.map(asset => asset.file).sort();
	if (
		actualFonts.length !== declaredFonts.length ||
		actualFonts.some((file, index) => file !== declaredFonts[index])
	) {
		fail(
			`bundled font inventory does not match source assets: ` +
				`declared ${declaredFonts.join(', ')}; found ${actualFonts.join(', ')}`
		);
	}

	return assetsManifest.assets.map(asset => {
		const assetPath = path.join(rootDir, asset.file);
		const noticePath = path.join(rootDir, asset.licenseFile);
		const license = normalizeLicense(asset.license);
		if (
			!asset.name ||
			!asset.version ||
			!license ||
			!asset.source ||
			!existsSync(assetPath) ||
			!existsSync(noticePath)
		) {
			fail(
				`${asset.name ?? asset.file ?? 'unknown asset'} has incomplete metadata`
			);
		}

		const hash = sha256(readFileSync(assetPath));
		const purl = `pkg:generic/${encodeURIComponent(asset.name)}@${encodeURIComponent(
			asset.version
		)}?download_url=${encodeURIComponent(asset.source)}`;
		return {
			assetPath: asset.file,
			assetSha256: hash,
			bomRef: purl,
			componentType: 'file',
			ecosystem: 'asset',
			hashes: [{alg: 'SHA-256', content: hash}],
			license,
			licenseFiles: [
				{
					name: path.basename(noticePath),
					text: normalizedText(readFileSync(noticePath, 'utf8'))
				}
			],
			name: asset.name,
			purl,
			source: asset.source,
			version: asset.version
		};
	});
}

function electronRuntimeVersions(rootDir) {
	const executable = require('electron');
	const output = execFileSync(
		executable,
		['-p', 'JSON.stringify(process.versions)'],
		{
			cwd: rootDir,
			encoding: 'utf8',
			env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}
		}
	);

	return JSON.parse(output);
}

function collectElectronRuntime(
	rootDir,
	runtimeVersions = electronRuntimeVersions(rootDir)
) {
	const electronPackage = readJson(
		path.join(rootDir, 'node_modules', 'electron', 'package.json')
	);
	if (runtimeVersions.electron !== electronPackage.version) {
		fail(
			`Electron runtime ${runtimeVersions.electron ?? 'unknown'} does not match ` +
				`installed package ${electronPackage.version}`
		);
	}

	const distDirectory = path.join(rootDir, 'node_modules', 'electron', 'dist');
	const electronLicense = path.join(distDirectory, 'LICENSE');
	const chromiumLicenses = path.join(distDirectory, 'LICENSES.chromium.html');
	if (!existsSync(electronLicense) || !existsSync(chromiumLicenses)) {
		fail('installed Electron distribution is missing runtime license files');
	}

	const standaloneNotice = {
		contents: readFileSync(chromiumLicenses),
		name: 'LICENSES.chromium.html',
		packagedAs: 'LICENSES.chromium.html'
	};
	const specifications = [
		{
			license: 'MIT',
			licenseFiles: [
				{
					name: 'LICENSE',
					text: normalizedText(readFileSync(electronLicense, 'utf8'))
				}
			],
			name: 'Electron',
			purl: npmPurl('electron', runtimeVersions.electron),
			source: 'https://github.com/electron/electron',
			version: runtimeVersions.electron
		},
		{
			license: 'BSD-3-Clause',
			name: 'Chromium',
			purl: `pkg:generic/chromium@${encodeURIComponent(runtimeVersions.chrome)}`,
			source: 'https://chromium.googlesource.com/chromium/src',
			version: runtimeVersions.chrome
		},
		{
			license: 'MIT',
			name: 'Node.js',
			purl: `pkg:generic/node.js@${encodeURIComponent(runtimeVersions.node)}`,
			source: 'https://github.com/nodejs/node',
			version: runtimeVersions.node
		},
		{
			license: 'BSD-3-Clause',
			name: 'V8',
			purl: `pkg:generic/v8@${encodeURIComponent(runtimeVersions.v8)}`,
			source: 'https://chromium.googlesource.com/v8/v8',
			version: runtimeVersions.v8
		}
	];

	return specifications.map(specification => ({
		...specification,
		bomRef: specification.purl,
		componentType: 'framework',
		ecosystem: 'runtime',
		licenseFiles: specification.licenseFiles ?? [standaloneNotice]
	}));
}

function applyLicenseOverrides(rootDir, components) {
	const overrides = readJson(
		path.join(rootDir, 'scripts', 'compliance-license-overrides.json')
	);
	if (overrides.version !== 1 || typeof overrides.components !== 'object') {
		fail('scripts/compliance-license-overrides.json has an unsupported schema');
	}

	for (const component of components) {
		if (component.licenseFiles.length === 0) {
			const key = `${component.ecosystem}:${component.name}@${component.version}`;
			const override = overrides.components[key];
			if (override) {
				const overridePath = path.join(rootDir, override);
				if (!existsSync(overridePath)) {
					fail(`license override for ${key} does not exist: ${override}`);
				}
				component.licenseFiles = [
					{
						name: path.basename(overridePath),
						text: normalizedText(readFileSync(overridePath, 'utf8'))
					}
				];
			}
		}

		if (component.licenseFiles.length === 0) {
			fail(
				`${component.ecosystem}:${component.name}@${component.version} has no distributable license notice`
			);
		}
	}
}

function deduplicateComponents(components) {
	const byReference = new Map();
	for (const component of components) {
		const existing = byReference.get(component.bomRef);
		if (existing) {
			const same =
				existing.name === component.name &&
				existing.version === component.version &&
				existing.license === component.license;
			if (!same) {
				fail(`conflicting metadata for ${component.bomRef}`);
			}
			existing.locations = [
				...new Set([
					...(existing.locations ?? []),
					...(component.locations ?? [])
				])
			].sort();
			continue;
		}

		byReference.set(component.bomRef, component);
	}

	return [...byReference.values()].sort(
		(left, right) =>
			left.name.localeCompare(right.name) ||
			left.version.localeCompare(right.version) ||
			left.bomRef.localeCompare(right.bomRef)
	);
}

function cyclonedxLicense(license) {
	return /\s|\(|\)|\//.test(license)
		? {expression: license}
		: {license: {id: license}};
}

function externalReferences(source) {
	return source ? [{type: 'vcs', url: source}] : undefined;
}

function cyclonedxComponent(component) {
	const properties = [{name: 'twine:ecosystem', value: component.ecosystem}];
	for (const location of component.locations ?? []) {
		properties.push({name: 'twine:npm-package-path', value: location});
	}

	if (component.directory) {
		properties.push({
			name: 'twine:story-format-directory',
			value: component.directory
		});
		properties.push({
			name: 'twine:license-sha256',
			value: component.licenseHash
		});
	}
	if (component.assetPath) {
		properties.push({
			name: 'twine:asset-source-path',
			value: component.assetPath
		});
		properties.push({name: 'twine:asset-sha256', value: component.assetSha256});
	}

	return {
		type:
			component.componentType ??
			(component.ecosystem === 'story-format' ? 'framework' : 'library'),
		'bom-ref': component.bomRef,
		name: component.name,
		version: component.version,
		licenses: [cyclonedxLicense(component.license)],
		purl: component.purl,
		...(component.hashes ? {hashes: component.hashes} : {}),
		...(component.source
			? {externalReferences: externalReferences(component.source)}
			: {}),
		properties
	};
}

function createBom({packageJson, components}) {
	const rootPurl = npmPurl(packageJson.name, packageJson.version);

	return {
		$schema: 'https://cyclonedx.org/schema/bom-1.6.schema.json',
		bomFormat: 'CycloneDX',
		specVersion: '1.6',
		version: 1,
		metadata: {
			component: {
				type: 'application',
				'bom-ref': rootPurl,
				name: packageJson.productName ?? packageJson.name,
				version: packageJson.version,
				licenses: [
					cyclonedxLicense(
						normalizeLicense(packageJson.license) ?? 'NOASSERTION'
					)
				],
				purl: rootPurl,
				externalReferences: externalReferences(
					normalizeRepository(packageJson.repository)
				)
			}
		},
		components: components.map(cyclonedxComponent),
		dependencies: [
			{
				ref: rootPurl,
				dependsOn: components.map(component => component.bomRef).sort()
			}
		]
	};
}

function escapeTableCell(value) {
	return String(value ?? '')
		.replace(/\|/g, '\\|')
		.replace(/\r?\n/g, ' ');
}

function componentTable(components) {
	return [
		'| Component | Version | License | Source |',
		'| --- | --- | --- | --- |',
		...components.map(
			component =>
				`| ${escapeTableCell(component.name)} | ${escapeTableCell(
					component.version
				)} | ${escapeTableCell(component.license)} | ${escapeTableCell(
					component.source ?? 'Not declared'
				)} |`
		)
	].join('\n');
}

function createNotices(componentGroups) {
	const allComponents = componentGroups.flatMap(group => group.components);
	const notices = new Map();
	const standaloneFiles = new Map();

	for (const component of allComponents) {
		for (const notice of component.licenseFiles) {
			const contents = notice.contents ?? Buffer.from(notice.text, 'utf8');
			const hash = sha256(contents);
			const source = `${component.ecosystem}:${component.name}@${component.version} (${notice.name})`;
			if (notice.packagedAs) {
				const existing = standaloneFiles.get(notice.packagedAs);
				if (existing && !existing.contents.equals(contents)) {
					fail(`conflicting standalone notice ${notice.packagedAs}`);
				}
				const packaged = existing ?? {contents, hash, sources: []};
				packaged.sources.push(source);
				standaloneFiles.set(notice.packagedAs, packaged);
				continue;
			}

			const existing = notices.get(hash) ?? {
				sources: [],
				text: contents.toString('utf8')
			};
			existing.sources.push(source);
			notices.set(hash, existing);
		}
	}

	const lines = [
		'# Third-Party Notices',
		'',
		'This file is generated by `npm run build:compliance`. The packaged root',
		'`LICENSE` covers Twine RS itself. This notice inventories the production npm',
		'dependency closure, every non-development Cargo dependency reachable from the',
		'shipped native and WASM crates, the Electron runtime, bundled fonts, and every',
		'bundled story format.',
		''
	];

	for (const group of componentGroups) {
		lines.push(`## ${group.title}`, '', componentTable(group.components), '');
	}

	lines.push('## Bundled license texts', '');
	for (const [hash, notice] of [...notices.entries()].sort(([left], [right]) =>
		left.localeCompare(right)
	)) {
		lines.push(
			`### Notice ${hash.slice(0, 16)}`,
			'',
			'Applies to:',
			'',
			...notice.sources
				.sort()
				.map(source => `- ${source.replace(/([*_`])/g, '\\$1')}`),
			'',
			'~~~~text',
			notice.text.trimEnd(),
			'~~~~',
			''
		);
	}

	if (standaloneFiles.size > 0) {
		lines.push('## Packaged standalone notices', '');
		for (const [fileName, notice] of [...standaloneFiles.entries()].sort(
			([left], [right]) => left.localeCompare(right)
		)) {
			lines.push(
				`### ${fileName.replace(/([*_`])/g, '\\$1')}`,
				'',
				`SHA-256: \`${notice.hash}\``,
				'',
				'Applies to:',
				'',
				...notice.sources
					.sort()
					.map(source => `- ${source.replace(/([*_`])/g, '\\$1')}`),
				''
			);
		}
	}

	return {standaloneFiles, text: lines.join('\n')};
}

function generateComplianceArtifacts({
	cargo: cargoMetadataOverride,
	outputDir,
	rootDir,
	runtimeVersions
}) {
	const packageJson = readJson(path.join(rootDir, 'package.json'));
	const applicationLicense = path.join(rootDir, 'LICENSE');
	if (
		!existsSync(applicationLicense) ||
		statSync(applicationLicense).size === 0
	) {
		fail('root LICENSE is missing or empty');
	}

	const npm = collectNpmPackages(rootDir);
	const cargo = collectCargoPackages(rootDir, cargoMetadataOverride);
	const runtime = collectElectronRuntime(rootDir, runtimeVersions);
	const assets = collectBundledAssets(rootDir);
	const storyFormats = collectStoryFormats(rootDir);
	const componentGroups = [
		{components: npm, title: 'Production npm packages'},
		{components: cargo, title: 'Shipped Rust dependency closure'},
		{components: runtime, title: 'Electron runtime'},
		{components: assets, title: 'Bundled font assets'},
		{components: storyFormats, title: 'Bundled story formats'}
	];
	const components = componentGroups.flatMap(group => group.components);
	applyLicenseOverrides(rootDir, components);
	const references = new Set();
	for (const component of components) {
		if (references.has(component.bomRef)) {
			fail(`duplicate cross-ecosystem SBOM reference ${component.bomRef}`);
		}
		references.add(component.bomRef);
	}

	mkdirSync(outputDir, {recursive: true});
	const notices = createNotices(componentGroups);
	const bom =
		JSON.stringify(createBom({components, packageJson}), null, 2) + '\n';

	writeFileSync(path.join(outputDir, 'THIRD_PARTY_NOTICES.md'), notices.text);
	writeFileSync(path.join(outputDir, 'sbom.cdx.json'), bom);
	for (const [fileName, notice] of notices.standaloneFiles) {
		writeFileSync(path.join(outputDir, fileName), notice.contents);
	}

	return {
		assets: assets.length,
		cargo: cargo.length,
		npm: npm.length,
		outputDir,
		runtime: runtime.length,
		storyFormats: storyFormats.length,
		total: components.length
	};
}

function packagedResourcesDirectory(context, productName) {
	return context.electronPlatformName === 'darwin'
		? path.join(
				context.appOutDir,
				`${productName}.app`,
				'Contents',
				'Resources'
			)
		: path.join(context.appOutDir, 'resources');
}

function propertyValues(component, name) {
	return (component.properties ?? [])
		.filter(property => property.name === name)
		.map(property => property.value);
}

function validateBom(bom) {
	if (
		bom.bomFormat !== 'CycloneDX' ||
		bom.specVersion !== '1.6' ||
		!Array.isArray(bom.components) ||
		bom.components.length === 0
	) {
		fail('generated SBOM is not a nonempty CycloneDX 1.6 document');
	}

	const rootReference = bom.metadata?.component?.['bom-ref'];
	if (!rootReference) {
		fail('generated SBOM metadata has no root component reference');
	}

	const references = new Set();
	const purls = new Set();
	for (const component of bom.components) {
		if (
			!component['bom-ref'] ||
			!component.name ||
			!component.version ||
			!component.purl ||
			!Array.isArray(component.licenses) ||
			component.licenses.length === 0
		) {
			fail('generated SBOM contains an incomplete component');
		}
		if (references.has(component['bom-ref'])) {
			fail(`generated SBOM repeats bom-ref ${component['bom-ref']}`);
		}
		if (purls.has(component.purl)) {
			fail(`generated SBOM repeats purl ${component.purl}`);
		}
		references.add(component['bom-ref']);
		purls.add(component.purl);

		for (const license of component.licenses) {
			if (!license.expression && !license.license?.id) {
				fail(`generated SBOM has an empty license for ${component['bom-ref']}`);
			}
		}
		for (const hash of component.hashes ?? []) {
			const expectedLength = {'SHA-256': 64, 'SHA-384': 96, 'SHA-512': 128}[
				hash.alg
			];
			if (
				!expectedLength ||
				typeof hash.content !== 'string' ||
				hash.content.length !== expectedLength ||
				!/^[0-9a-f]+$/i.test(hash.content)
			) {
				fail(
					`generated SBOM has an invalid ${hash.alg} hash for ${component['bom-ref']}`
				);
			}
		}
	}

	const rootDependency = (bom.dependencies ?? []).find(
		dependency => dependency.ref === rootReference
	);
	if (!rootDependency || !Array.isArray(rootDependency.dependsOn)) {
		fail('generated SBOM has no dependency graph for its root component');
	}
	for (const reference of rootDependency.dependsOn) {
		if (!references.has(reference)) {
			fail(
				`generated SBOM dependency references missing component ${reference}`
			);
		}
	}
	if (
		rootDependency.dependsOn.length !== references.size ||
		new Set(rootDependency.dependsOn).size !== references.size
	) {
		fail('generated SBOM root dependency graph is not exhaustive');
	}
}

function npmPackageLocations(packageEntries) {
	const pattern =
		/^node_modules\/(?:@[^/]+\/[^/]+|[^/@][^/]*)(?:\/node_modules\/(?:@[^/]+\/[^/]+|[^/@][^/]*))*\/package\.json$/;
	return packageEntries
		.map(entry => entry.replace(/^\//, ''))
		.filter(entry => pattern.test(entry))
		.map(entry => entry.slice(0, -'/package.json'.length))
		.sort();
}

function verifyNpmInventory({asarPath, bom, extractFile, packageEntries}) {
	const expected = new Map();
	for (const component of bom.components) {
		if (propertyValues(component, 'twine:ecosystem')[0] !== 'npm') {
			continue;
		}
		const locations = propertyValues(component, 'twine:npm-package-path');
		if (locations.length === 0) {
			fail(`generated SBOM has no install path for ${component.purl}`);
		}
		expected.set(component.purl, locations.length);
	}

	const actualLocations = npmPackageLocations(packageEntries);
	const actual = new Map();
	for (const location of actualLocations) {
		const manifest = JSON.parse(
			Buffer.from(extractFile(asarPath, `${location}/package.json`)).toString(
				'utf8'
			)
		);
		const purl = npmPurl(manifest.name, manifest.version);
		actual.set(purl, (actual.get(purl) ?? 0) + 1);
	}

	const expectedIdentities = [...expected.entries()].sort(([left], [right]) =>
		left.localeCompare(right)
	);
	const actualIdentities = [...actual.entries()].sort(([left], [right]) =>
		left.localeCompare(right)
	);
	if (JSON.stringify(expectedIdentities) !== JSON.stringify(actualIdentities)) {
		fail(
			`packaged npm dependency identities differ from SBOM: expected ${JSON.stringify(
				expectedIdentities
			)}; found ${JSON.stringify(actualIdentities)}`
		);
	}
}

function verifyAssetInventory({asarPath, bom, extractFile, packageEntries}) {
	const expectedHashes = bom.components
		.filter(
			component => propertyValues(component, 'twine:ecosystem')[0] === 'asset'
		)
		.map(component => propertyValues(component, 'twine:asset-sha256')[0])
		.sort();
	const assetEntries = packageEntries
		.map(entry => entry.replace(/^\//, ''))
		.filter(entry => entry.endsWith('.woff2'))
		.sort();
	const actualHashes = assetEntries
		.map(entry => sha256(extractFile(asarPath, entry)))
		.sort();

	if (
		expectedHashes.length !== actualHashes.length ||
		expectedHashes.some((hash, index) => hash !== actualHashes[index])
	) {
		fail(
			`packaged font asset hashes differ from SBOM: expected ${expectedHashes.join(
				', '
			)}; found ${actualHashes.join(', ')}`
		);
	}
}

function verifyPackagedCompliance({
	asarPath,
	expectedFiles,
	extractFile = require('@electron/asar').extractFile,
	listPackage = require('@electron/asar').listPackage
}) {
	for (const fileName of COMPLIANCE_FILES) {
		const expected = expectedFiles[fileName];
		if (!Buffer.isBuffer(expected) || expected.length === 0) {
			fail(`expected package input ${fileName} is missing or empty`);
		}

		let packaged;
		try {
			packaged = extractFile(asarPath, fileName);
		} catch (error) {
			fail(`packaged app is missing root /${fileName}: ${error.message}`);
		}

		if (!Buffer.from(packaged).equals(expected)) {
			fail(`packaged root /${fileName} differs from its generated input`);
		}
	}

	const bom = JSON.parse(expectedFiles['sbom.cdx.json'].toString('utf8'));
	validateBom(bom);
	const packageEntries = listPackage(asarPath);
	verifyNpmInventory({asarPath, bom, extractFile, packageEntries});
	verifyAssetInventory({asarPath, bom, extractFile, packageEntries});

	return {components: bom.components.length};
}

function createCompliancePackagingHooks({
	extractFile = require('@electron/asar').extractFile,
	generate = generateComplianceArtifacts,
	listPackage = require('@electron/asar').listPackage,
	productName,
	rootDir
}) {
	const outputDir = path.join(rootDir, 'electron-build', 'compliance');

	function beforePack() {
		const counts = generate({outputDir, rootDir});
		console.log(
			`compliance: generated ${counts.total} third-party components ` +
				`(${counts.npm} npm, ${counts.cargo} Cargo, ${counts.runtime} runtime, ` +
				`${counts.assets} assets, ${counts.storyFormats} story formats)`
		);
	}

	function afterPack(context) {
		const resourcesDir = packagedResourcesDirectory(context, productName);
		const asarPath = path.join(resourcesDir, 'app.asar');
		const expectedFiles = Object.fromEntries(
			COMPLIANCE_FILES.map(fileName => [
				fileName,
				readFileSync(
					fileName === 'LICENSE'
						? path.join(rootDir, fileName)
						: path.join(outputDir, fileName)
				)
			])
		);
		const result = verifyPackagedCompliance({
			asarPath,
			expectedFiles,
			extractFile,
			listPackage
		});

		console.log(
			`compliance: verified license notices, packaged dependencies, and ` +
				`${result.components}-component SBOM in ${asarPath}`
		);
	}

	return {afterPack, beforePack};
}

module.exports = {
	COMPLIANCE_FILES,
	GENERATED_COMPLIANCE_FILES,
	collectBundledAssets,
	collectCargoPackages,
	collectElectronRuntime,
	collectNpmPackages,
	collectStoryFormats,
	createCompliancePackagingHooks,
	generateComplianceArtifacts,
	verifyPackagedCompliance
};
