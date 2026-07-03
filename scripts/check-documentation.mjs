import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const documentationRoots = [
	'README.md',
	'benchmarks/README.md',
	'crates/README.md',
	'docs/README.md',
	'docs/architecture',
	'docs/decisions',
	'docs/design-system/IMPLEMENTATION_GUIDE.md',
	'docs/design-system/readme.md',
	'docs/product',
	'docs/roadmap',
	'docs/status',
	'docs/user',
	'public/locales/README.md',
	'ui_kits',
	'ui_kits_remediation'
];
const currentDocumentationDirectories = [
	'docs/architecture',
	'docs/product',
	'docs/roadmap',
	'docs/status'
];
const requiredMetadata = [
	'Status:',
	'Owner:',
	'Last verified:',
	'Source of truth:'
];

function markdownFiles(entry) {
	const absolute = resolve(repositoryRoot, entry);

	if (!existsSync(absolute)) {
		return [];
	}

	if (!statSync(absolute).isDirectory()) {
		return extname(absolute) === '.md' ? [absolute] : [];
	}

	return readdirSync(absolute, {withFileTypes: true}).flatMap(child =>
		markdownFiles(`${entry}/${child.name}`)
	);
}

function localTarget(rawTarget) {
	let target = rawTarget.trim();

	if (target.startsWith('<') && target.endsWith('>')) {
		target = target.slice(1, -1);
	} else {
		target = target.split(/\s+["']/u, 1)[0];
	}

	if (
		!target ||
		target.startsWith('#') ||
		/^(?:https?:|mailto:|data:|javascript:)/iu.test(target)
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

const files = [...new Set(documentationRoots.flatMap(markdownFiles))].sort();
const failures = [];
const linkPattern = /!?\[[^\]]*\]\(([^)\n]+)\)/g;

for (const file of files) {
	const contents = readFileSync(file, 'utf8');
	const relativeFile = file.slice(repositoryRoot.length + 1);
	let match;

	while ((match = linkPattern.exec(contents))) {
		const target = localTarget(match[1]);

		if (!target) {
			continue;
		}

		const absoluteTarget = target.startsWith('/')
			? resolve(repositoryRoot, target.slice(1))
			: resolve(dirname(file), target);

		if (!existsSync(absoluteTarget)) {
			const line = contents.slice(0, match.index).split('\n').length;
			failures.push(`${relativeFile}:${line}: missing link target ${target}`);
		}
	}

	if (
		currentDocumentationDirectories.some(directory =>
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

if (failures.length > 0) {
	console.error('Documentation checks failed:\n');
	console.error(failures.map(failure => `- ${failure}`).join('\n'));
	process.exitCode = 1;
} else {
	console.log(`Documentation checks passed (${files.length} Markdown files).`);
}
