import console from 'node:console';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, extname, isAbsolute, relative, resolve, sep} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

export const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'..'
);
export const documentationRoots = [
	'README.md',
	'CHANGELOG.md',
	'RELEASING.md',
	'SUPPORT.md',
	'benchmarks/README.md',
	'crates/README.md',
	'docs/README.md',
	'docs/architecture',
	'docs/decisions',
	'docs/design-system/IMPLEMENTATION_GUIDE.md',
	'docs/design-system/readme.md',
	'docs/en/src',
	'docs/product',
	'docs/releases',
	'docs/roadmap',
	'docs/status',
	'docs/user',
	'public/locales/README.md',
	'ui_kits',
	'ui_kits_remediation'
];
export const currentDocumentationDirectories = [
	'docs/architecture',
	'docs/product',
	'docs/releases',
	'docs/roadmap',
	'docs/status'
];
export const requiredMetadata = [
	'Status:',
	'Owner:',
	'Last verified:',
	'Source of truth:'
];

function filesWithExtension(root, entry, extension) {
	const absolute = resolve(root, entry);

	if (!existsSync(absolute)) {
		return [];
	}

	if (!statSync(absolute).isDirectory()) {
		return extname(absolute) === extension ? [absolute] : [];
	}

	return readdirSync(absolute, {withFileTypes: true}).flatMap(child =>
		filesWithExtension(root, `${entry}/${child.name}`, extension)
	);
}

export function localTarget(rawTarget) {
	let target = rawTarget.trim();

	if (target.startsWith('<') && target.endsWith('>')) {
		target = target.slice(1, -1);
	} else {
		target = target.split(/\s+["']/u, 1)[0];
	}

	if (
		!target ||
		target.startsWith('#') ||
		target.startsWith('//') ||
		/^[a-z][a-z\d+.-]*:/iu.test(target)
	) {
		return undefined;
	}

	target = target.split('#', 1)[0].split('?', 1)[0];

	try {
		return decodeURIComponent(target);
	} catch {
		return target;
	}
}

function targetExists(root, sourceFile, target, {mdBook = false} = {}) {
	const absoluteTarget = resolveTarget(root, sourceFile, target);

	if (!targetIsWithin(root, absoluteTarget)) {
		return false;
	}

	if (existsSync(absoluteTarget)) {
		return true;
	}

	return (
		mdBook &&
		extname(absoluteTarget) === '.html' &&
		existsSync(`${absoluteTarget.slice(0, -'.html'.length)}.md`)
	);
}

function resolveTarget(root, sourceFile, target) {
	return target.startsWith('/')
		? resolve(root, target.slice(1))
		: resolve(dirname(sourceFile), target);
}

function targetIsWithin(containmentRoot, absoluteTarget) {
	const relativeTarget = relative(containmentRoot, absoluteTarget);

	return !(
		relativeTarget === '..' ||
		relativeTarget.startsWith(`..${sep}`) ||
		isAbsolute(relativeTarget)
	);
}

export function checkMarkdownFiles({
	root,
	roots = documentationRoots,
	currentDirectories = currentDocumentationDirectories
}) {
	const files = [
		...new Set(roots.flatMap(entry => filesWithExtension(root, entry, '.md')))
	].sort();
	const failures = [];
	const linkPattern = /!?\[[^\]]*\]\((<[^>\n]+>|[^)\n]+)\)/gu;

	for (const file of files) {
		const contents = readFileSync(file, 'utf8');
		const relativeFile = relative(root, file);
		let match;

		while ((match = linkPattern.exec(contents))) {
			const target = localTarget(match[1]);
			const mdBook = relativeFile.startsWith('docs/en/src/');

			if (!target) {
				continue;
			}

			if (
				mdBook &&
				!targetIsWithin(
					resolve(root, 'docs/en/src'),
					resolveTarget(root, file, target)
				)
			) {
				const line = contents.slice(0, match.index).split('\n').length;
				failures.push(
					`${relativeFile}:${line}: local compatibility-manual link escapes docs/en/src (${target}); use an explicit external or repository URL`
				);
				continue;
			}

			if (
				!targetExists(root, file, target, {
					mdBook
				})
			) {
				const line = contents.slice(0, match.index).split('\n').length;
				failures.push(`${relativeFile}:${line}: missing link target ${target}`);
			}
		}

		if (
			currentDirectories.some(directory =>
				relativeFile.startsWith(`${directory}/`)
			)
		) {
			for (const field of requiredMetadata) {
				if (!contents.slice(0, 500).includes(field)) {
					failures.push(`${relativeFile}: missing metadata field "${field}"`);
				}
			}
		}
	}

	return {failures, files};
}

export function checkHtmlResources({root, htmlRoot = 'docs/design-system'}) {
	const files = filesWithExtension(root, htmlRoot, '.html').sort();
	const failures = [];
	const tagPattern = /<[^>]+>/gu;
	const resourcePattern =
		/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu;

	for (const file of files) {
		const contents = readFileSync(file, 'utf8');
		const relativeFile = relative(root, file);
		let tagMatch;

		while ((tagMatch = tagPattern.exec(contents))) {
			let resourceMatch;

			while ((resourceMatch = resourcePattern.exec(tagMatch[0]))) {
				const target = localTarget(
					resourceMatch[1] ?? resourceMatch[2] ?? resourceMatch[3]
				);

				if (!target || targetExists(root, file, target)) {
					continue;
				}

				const line = contents
					.slice(0, tagMatch.index + resourceMatch.index)
					.split('\n').length;
				failures.push(
					`${relativeFile}:${line}: missing local HTML resource ${target}`
				);
			}
		}
	}

	return {failures, files};
}

export function checkCompatibilityManual({root}) {
	const failures = [];
	const bookFile = resolve(root, 'docs/en/book.toml');
	const landingFile = resolve(root, 'docs/en/src/README.md');
	const titlePattern =
		/^\s*title\s*=\s*"Twine compatibility manual \(upstream\)"\s*(?:#.*)?$/mu;
	const ownershipMarker =
		'<!-- documentation-class: upstream-compatibility -->';
	const scopePhrases = [
		'predominantly the upstream twine',
		'not yet an authoritative guide to every twine.rs workflow'
	];
	const canonicalLinks = [
		{
			label: 'twine.rs documentation map',
			url: 'https://github.com/twine-rs-labs/twine.rs/blob/main/docs/README.md'
		},
		{
			label: 'user-documentation status',
			url: 'https://github.com/twine-rs-labs/twine.rs/blob/main/docs/user/README.md'
		}
	];

	if (
		!existsSync(bookFile) ||
		!titlePattern.test(readFileSync(bookFile, 'utf8'))
	) {
		failures.push(
			'docs/en/book.toml: compatibility manual title must remain "Twine compatibility manual (upstream)"'
		);
	}

	if (!existsSync(landingFile)) {
		failures.push(
			'docs/en/src/README.md: compatibility manual requires a scope landing page'
		);
	} else {
		const landing = readFileSync(landingFile, 'utf8');
		const normalizedLanding = landing
			.replace(/^\s*>\s?/gmu, '')
			.replace(/\s+/gu, ' ')
			.trim()
			.toLowerCase();
		const normalizedLinks = new Map(
			[
				...normalizedLanding.matchAll(/\[([^\]]+)\]\s*\(\s*([^)]+?)\s*\)/gu)
			].map(match => [match[1], match[2]])
		);

		if (!landing.includes(ownershipMarker)) {
			failures.push(
				`docs/en/src/README.md: missing compatibility ownership marker "${ownershipMarker}"`
			);
		}

		for (const phrase of scopePhrases) {
			if (!normalizedLanding.includes(phrase)) {
				failures.push(
					`docs/en/src/README.md: missing compatibility scope phrase "${phrase}"`
				);
			}
		}

		for (const {label, url} of canonicalLinks) {
			if (normalizedLinks.get(label) !== url.toLowerCase()) {
				failures.push(
					`docs/en/src/README.md: compatibility link "[${label}]" must target ${url}`
				);
			}
		}
	}

	return failures;
}

export function checkLegacyWorkbench({root}) {
	const legacyWorkbench = resolve(root, 'ui_kits/workbench');
	const failures = [];

	if (
		existsSync(legacyWorkbench) &&
		(!statSync(legacyWorkbench).isDirectory() ||
			readdirSync(legacyWorkbench).length > 0)
	) {
		failures.push(
			'ui_kits/workbench: legacy workbench content is not allowed; docs/design-system/ui_kits/workbench is the sole authoritative workbench kit'
		);
	}

	for (const file of filesWithExtension(root, 'ui_kits_remediation', '.md')) {
		const contents = readFileSync(file, 'utf8');
		const withoutCanonicalPaths = contents.replaceAll(
			'docs/design-system/ui_kits/workbench',
			''
		);
		const legacyReference = withoutCanonicalPaths.indexOf('ui_kits/workbench');

		if (legacyReference !== -1) {
			const line = withoutCanonicalPaths
				.slice(0, legacyReference)
				.split('\n').length;
			failures.push(
				`${relative(root, file)}:${line}: active remediation guidance must use docs/design-system/ui_kits/workbench; root ui_kits/workbench references are forbidden`
			);
		}
	}

	return failures;
}

export function checkDesignSystemGuide({root}) {
	const guideFile = resolve(root, 'docs/design-system/IMPLEMENTATION_GUIDE.md');

	if (!existsSync(guideFile)) {
		return [
			'docs/design-system/IMPLEMENTATION_GUIDE.md: design-system implementation guide is required'
		];
	}

	const contents = readFileSync(guideFile, 'utf8');
	const failures = [];

	if (contents.includes('@twine/ui')) {
		failures.push(
			'docs/design-system/IMPLEMENTATION_GUIDE.md: nonexistent @twine/ui imports are not allowed'
		);
	}

	if (!contents.includes('src/components/design-system/index.ts')) {
		failures.push(
			'docs/design-system/IMPLEMENTATION_GUIDE.md: production component guidance must identify src/components/design-system/index.ts as the real barrel'
		);
	}

	if (
		!/\bimport\s*\{[^}]+\}\s*from\s*['"](?:\.\.\/)+components\/design-system['"]/u.test(
			contents
		)
	) {
		failures.push(
			'docs/design-system/IMPLEMENTATION_GUIDE.md: production component guidance must show a relative components/design-system import'
		);
	}

	return failures;
}

export function checkDocumentation({root = repositoryRoot} = {}) {
	const markdown = checkMarkdownFiles({root});
	const html = checkHtmlResources({root});
	const failures = [
		...markdown.failures,
		...html.failures,
		...checkCompatibilityManual({root}),
		...checkLegacyWorkbench({root}),
		...checkDesignSystemGuide({root})
	];

	return {
		failures,
		htmlFiles: html.files,
		markdownFiles: markdown.files
	};
}

export function main() {
	const result = checkDocumentation();

	if (result.failures.length > 0) {
		console.error('Documentation checks failed:\n');
		console.error(result.failures.map(failure => `- ${failure}`).join('\n'));
		process.exitCode = 1;
	} else {
		console.log(
			`Documentation checks passed (${result.markdownFiles.length} Markdown files, ${result.htmlFiles.length} HTML files).`
		);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main();
}
