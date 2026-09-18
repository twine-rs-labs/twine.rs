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
					`${relativeFile}:${line}: local user-manual link escapes docs/en/src (${target}); use an explicit external or repository URL`
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

export const userManualTitle = 'Twine RS User Manual';
export const userManualLandingMarker =
	'<!-- documentation-class: twine-rs-user-manual -->';
export const userManualScopePhrase =
	'This manual describes the shipped Twine RS desktop and browser editors.';
export const userManualLinks = [
	{
		label: 'documentation map',
		url: 'https://github.com/twine-rs-labs/twine.rs/blob/main/docs/README.md'
	},
	{
		label: 'user documentation',
		url: 'https://github.com/twine-rs-labs/twine.rs/blob/main/docs/user/README.md'
	}
];
export const upstreamHistoryMarker =
	'<!-- documentation-class: upstream-history -->';
export const upstreamHistoryPhrase =
	'Historical upstream Twine documentation; not Twine RS release notes.';
export const legacyUserManualLanding = {
	source: 'README.md',
	heading: 'Twine RS user documentation',
	anchor: 'twiners-user-documentation',
	target: '../en/src/README.md'
};
export const legacyUserManualHeadingMap = [
	{
		source: 'availability-and-updates.md',
		heading: 'Twine RS availability and updates',
		target: 'getting-started/installing.md#installing-twine-rs'
	},
	{
		source: 'availability-and-updates.md',
		heading: 'Updates',
		target: 'getting-started/updating.md#updating-twine-rs'
	},
	...[
		'Story-graph navigation',
		'Move around the graph',
		'Select and edit passages'
	].map(heading => ({
		source: 'graph-navigation.md',
		heading,
		target: `editing-stories/navigating.md#${markdownAnchorSlug(heading)}`
	})),
	...[
		'Desktop command line',
		'Launch the application',
		'Supported options',
		'Folder safety'
	].map(heading => ({
		source: 'desktop-command-line.md',
		heading,
		target: `customizing/command-line.md#${markdownAnchorSlug(heading)}`
	})),
	...[
		'Desktop recovery and backups',
		'Story-library and backup locations',
		'Restore a project from a backup',
		'Test with an isolated library',
		'Interrupted operations',
		'Choose dedicated folders'
	].map(heading => ({
		source: 'recovery-and-backups.md',
		heading,
		target: `troubleshooting/backups.md#${markdownAnchorSlug(heading)}`
	})),
	{
		source: 'recovery-and-backups.md',
		heading: 'Recovering from damaged settings',
		target: 'troubleshooting/wont-start.md#recovering-from-damaged-settings'
	}
];

function markdownAnchorSlug(heading) {
	return heading
		.toLowerCase()
		.replace(/<[^>]+>/gu, '')
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.trim()
		.replace(/\s+/gu, '-');
}

function markdownHeadings(contents) {
	const headings = [];
	let fenced = false;
	let fence;
	let offset = 0;

	for (const line of contents.split(/\n/u)) {
		const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u);
		if (fenceMatch) {
			if (!fenced) {
				fenced = true;
				fence = fenceMatch[1][0];
			} else if (fenceMatch[1][0] === fence) {
				fenced = false;
				fence = undefined;
			}
			offset += line.length + 1;
			continue;
		}

		if (!fenced) {
			const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u);
			if (match) {
				const explicitId = match[1].match(/\s*\{#([^}\s]+)\}\s*$/u);
				const text = match[1].replace(/\s*\{#[^}\s]+\}\s*$/u, '').trim();
				headings.push({
					anchor: explicitId?.[1] ?? markdownAnchorSlug(text),
					offset: offset + line.length,
					slug: markdownAnchorSlug(text)
				});
			}
		}

		offset += line.length + 1;
	}

	return headings;
}

function markdownAnchors(contents) {
	const anchors = new Set(markdownHeadings(contents).map(({anchor}) => anchor));
	let fenced = false;
	let fence;

	for (const line of contents.split(/\n/u)) {
		const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u);
		if (fenceMatch) {
			if (!fenced) {
				fenced = true;
				fence = fenceMatch[1][0];
			} else if (fenceMatch[1][0] === fence) {
				fenced = false;
				fence = undefined;
			}
			continue;
		}

		if (!fenced) {
			for (const match of line.matchAll(
				/<[^>]+\bid\s*=\s*["']([^"']+)["'][^>]*>/giu
			)) {
				anchors.add(match[1]);
			}
		}
	}

	return anchors;
}

function htmlAnchorIds(contents) {
	const anchors = new Set();
	let fenced = false;
	let fence;

	for (const line of contents.split(/\n/u)) {
		const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u);
		if (fenceMatch) {
			if (!fenced) {
				fenced = true;
				fence = fenceMatch[1][0];
			} else if (fenceMatch[1][0] === fence) {
				fenced = false;
				fence = undefined;
			}
			continue;
		}

		if (!fenced) {
			for (const match of line.matchAll(
				/<a\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>/giu
			)) {
				anchors.add(match[1]);
			}
		}
	}

	return anchors;
}

export function checkUserManual({root}) {
	const failures = [];
	const bookFile = resolve(root, 'docs/en/book.toml');
	const landingFile = resolve(root, 'docs/en/src/README.md');
	const titlePattern = /^\s*title\s*=\s*"Twine RS User Manual"\s*(?:#.*)?$/mu;

	if (
		!existsSync(bookFile) ||
		!titlePattern.test(readFileSync(bookFile, 'utf8'))
	) {
		failures.push(
			`docs/en/book.toml: user manual title must be "${userManualTitle}"`
		);
	}

	if (!existsSync(landingFile)) {
		failures.push(
			'docs/en/src/README.md: user manual requires a scope landing page'
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

		if (!landing.includes(userManualLandingMarker)) {
			failures.push(
				`docs/en/src/README.md: missing user-manual marker "${userManualLandingMarker}"`
			);
		}

		if (!normalizedLanding.includes(userManualScopePhrase.toLowerCase())) {
			failures.push(
				`docs/en/src/README.md: missing user-manual scope phrase "${userManualScopePhrase}"`
			);
		}

		for (const {label, url} of userManualLinks) {
			if (normalizedLinks.get(label) !== url.toLowerCase()) {
				failures.push(
					`docs/en/src/README.md: user-manual link "[${label}]" must target ${url}`
				);
			}
		}
	}

	return failures;
}

export function checkUpstreamHistory({root}) {
	const failures = [];

	for (const file of filesWithExtension(
		root,
		'docs/en/src/release-notes',
		'.md'
	)) {
		const relativeFile = relative(root, file);
		const contents = readFileSync(file, 'utf8');

		if (!contents.includes(upstreamHistoryMarker)) {
			failures.push(
				`${relativeFile}: missing upstream-history marker "${upstreamHistoryMarker}"`
			);
		}
		if (!contents.includes(upstreamHistoryPhrase)) {
			failures.push(
				`${relativeFile}: missing upstream-history notice "${upstreamHistoryPhrase}"`
			);
		}
	}

	return failures;
}

export function checkLegacyUserManualLinks({root}) {
	const failures = [];

	for (const {source, heading, target} of legacyUserManualHeadingMap) {
		const sourceFile = resolve(root, 'docs/user', source);
		if (!existsSync(sourceFile)) {
			const message = `docs/user/${source}: missing legacy guide`;
			if (!failures.includes(message)) failures.push(message);
			continue;
		}

		const contents = readFileSync(sourceFile, 'utf8');
		const slug = markdownAnchorSlug(heading);
		const headings = markdownHeadings(contents);
		const index = headings.findIndex(item => item.slug === slug);
		const relativeSource = `docs/user/${source}`;

		if (index === -1 || headings[index].anchor !== slug) {
			failures.push(`${relativeSource}: missing legacy heading #${slug}`);
			continue;
		}

		const nextOffset = headings[index + 1]?.offset ?? contents.length;
		const immediateBlock = contents
			.slice(headings[index].offset, nextOffset)
			.replace(/^\s+/u, '')
			.split(/\n\s*\n/u, 1)[0];
		const expectedTarget = `../en/src/${target}`;
		const linkPattern = new RegExp(
			`\\[[^\\]]*\\]\\(\\s*${expectedTarget.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*\\)`,
			'u'
		);

		if (!linkPattern.test(immediateBlock)) {
			failures.push(
				`${relativeSource}: legacy heading #${slug} must immediately link to ${expectedTarget}`
			);
		}

		const [targetPath, targetAnchor] = target.split('#', 2);
		const destination = resolve(root, 'docs/en/src', targetPath);
		if (!existsSync(destination)) {
			failures.push(
				`${relativeSource}: legacy heading #${slug} target is missing ${targetPath}`
			);
		} else if (
			!markdownAnchors(readFileSync(destination, 'utf8')).has(targetAnchor)
		) {
			failures.push(
				`${relativeSource}: legacy heading #${slug} target is missing anchor #${targetAnchor}`
			);
		}
	}

	return failures;
}

export function checkLegacyUserManualLanding({root}) {
	const {source, heading, anchor, target} = legacyUserManualLanding;
	const sourceFile = resolve(root, 'docs/user', source);
	const relativeSource = `docs/user/${source}`;

	if (!existsSync(sourceFile)) {
		return [`${relativeSource}: missing legacy Help landing`];
	}

	const contents = readFileSync(sourceFile, 'utf8');
	const failures = [];

	if (
		!markdownHeadings(contents).some(
			item => item.slug === markdownAnchorSlug(heading)
		) ||
		!htmlAnchorIds(contents).has(anchor)
	) {
		failures.push(
			`${relativeSource}: legacy Help landing must preserve HTML anchor #${anchor}`
		);
	}

	const linkPattern = new RegExp(
		`\\[[^\\]]*\\]\\(\\s*${target.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*\\)`,
		'u'
	);
	if (!linkPattern.test(contents)) {
		failures.push(
			`${relativeSource}: legacy Help landing must link to ${target}`
		);
	}

	if (!existsSync(resolve(dirname(sourceFile), target))) {
		failures.push(
			`${relativeSource}: legacy Help landing target is missing ${target}`
		);
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
		...checkUserManual({root}),
		...checkUpstreamHistory({root}),
		...checkLegacyUserManualLinks({root}),
		...checkLegacyUserManualLanding({root}),
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
