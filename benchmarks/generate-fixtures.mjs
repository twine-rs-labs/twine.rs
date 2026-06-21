#!/usr/bin/env node

import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const defaultOutDir = path.join(rootDir, 'benchmarks', 'fixtures', 'generated');
const defaultSizes = [1000, 5000, 10000];
const largeSizes = [1000, 5000, 10000, 50000];
const defaultFormats = ['html', 'twee', 'json'];
const wordBank = [
	'archive',
	'beacon',
	'branch',
	'cipher',
	'corridor',
	'echo',
	'engine',
	'forest',
	'gate',
	'hidden',
	'index',
	'lantern',
	'loop',
	'marker',
	'mirror',
	'node',
	'path',
	'portal',
	'return',
	'signal',
	'thread',
	'threshold'
];

function usage() {
	return `Usage: node benchmarks/generate-fixtures.mjs [options]

Options:
  --sizes 1000,5000       Comma-separated passage counts.
  --large                 Use the standard large set: ${largeSizes.join(',')}.
  --out PATH              Output directory. Defaults to benchmarks/fixtures/generated.
  --formats html,twee,json
                           Output formats to write.
  --body-words 32         Approximate body word count per passage.
  --story-format NAME     Story format name. Defaults to Harlowe.
  --story-format-version VERSION
                           Story format version. Defaults to 3.3.9.
  --help                  Show this message.
`;
}

function parseArgs(argv) {
	const options = {
		bodyWords: 32,
		formats: defaultFormats,
		outDir: defaultOutDir,
		sizes: defaultSizes,
		storyFormat: 'Harlowe',
		storyFormatVersion: '3.3.9'
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const next = () => {
			const value = argv[i + 1];

			if (!value || value.startsWith('--')) {
				throw new Error(`${arg} requires a value.`);
			}

			i += 1;
			return value;
		};

		switch (arg) {
			case '--body-words':
				options.bodyWords = positiveInteger(next(), arg);
				break;

			case '--formats':
				options.formats = parseCsv(next(), arg);
				break;

			case '--help':
				options.help = true;
				break;

			case '--large':
				options.sizes = largeSizes;
				break;

			case '--out':
				options.outDir = path.resolve(rootDir, next());
				break;

			case '--sizes':
				options.sizes = parseCsv(next(), arg).map(value =>
					positiveInteger(value, arg)
				);
				break;

			case '--story-format':
				options.storyFormat = next();
				break;

			case '--story-format-version':
				options.storyFormatVersion = next();
				break;

			default:
				throw new Error(`Unknown option: ${arg}`);
		}
	}

	for (const format of options.formats) {
		if (!defaultFormats.includes(format)) {
			throw new Error(
				`Unsupported format "${format}". Expected one of ${defaultFormats.join(
					', '
				)}.`
			);
		}
	}

	return options;
}

function parseCsv(value, label) {
	const values = value
		.split(',')
		.map(item => item.trim())
		.filter(Boolean);

	if (values.length === 0) {
		throw new Error(`${label} must contain at least one value.`);
	}

	return values;
}

function positiveInteger(value, label) {
	const result = Number.parseInt(value, 10);

	if (!Number.isInteger(result) || result <= 0) {
		throw new Error(`${label} must be a positive integer.`);
	}

	return result;
}

function pad(value, width = 6) {
	return value.toString().padStart(width, '0');
}

function deterministicId(prefix, value) {
	return `${prefix}-${pad(value)}`;
}

function deterministicIfid(count) {
	return `00000000-0000-4000-8000-${count
		.toString()
		.padStart(12, '0')}`.toUpperCase();
}

function passageName(index) {
	return `Passage ${pad(index)}`;
}

function escapeHtml(value) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function escapeTweeHeader(value) {
	return value.replace(/\\/g, '\\\\').replace(/([[\]{}])/g, '\\$1');
}

function escapeTweeText(value) {
	return value.replace(/^::/gm, '\\::');
}

function tagsFor(index) {
	const tags = [`chapter-${pad(Math.floor((index - 1) / 100) + 1, 3)}`];

	if (index % 2 === 0) {
		tags.push('even');
	} else {
		tags.push('odd');
	}

	if (index % 25 === 0) {
		tags.push('checkpoint');
	}

	if (index % 100 === 1) {
		tags.push('hub');
	}

	return tags;
}

function linksFor(index, count) {
	const links = [];

	if (index < count) {
		links.push({
			kind: 'next',
			target: passageName(index + 1),
			text: `[[Next ${pad(index + 1)}->${passageName(index + 1)}]]`
		});
	}

	if (index + 7 <= count) {
		links.push({
			kind: 'branch',
			target: passageName(index + 7),
			text: `[[Branch ${pad(index + 7)}->${passageName(index + 7)}]]`
		});
	}

	if (index % 101 === 0) {
		links.push({
			kind: 'self',
			target: passageName(index),
			text: `[[Loop ${pad(index)}->${passageName(index)}]]`
		});
	}

	if (index % 37 === 0) {
		links.push({
			kind: 'broken',
			target: `Missing ${pad(index)}`,
			text: `[[Missing ${pad(index)}]]`
		});
	}

	return links;
}

function textFor(index, count, bodyWords) {
	const words = [];

	for (let i = 0; i < bodyWords; i += 1) {
		words.push(wordBank[(index + i * 7) % wordBank.length]);
	}

	const links = linksFor(index, count).map(({text}) => text);

	return [
		`Synthetic passage ${pad(index)} for large-project benchmarks.`,
		words.join(' '),
		links.join(' ')
	]
		.filter(Boolean)
		.join('\n\n');
}

function generateStory(count, options) {
	const cols = Math.ceil(Math.sqrt(count));
	const passageWidth = 100;
	const passageHeight = 100;
	const gap = 25;
	const passages = [];

	for (let index = 1; index <= count; index += 1) {
		const left = gap + ((index - 1) % cols) * (passageWidth + gap);
		const top = gap + Math.floor((index - 1) / cols) * (passageHeight + gap);

		passages.push({
			height: passageHeight,
			highlighted: false,
			id: deterministicId('passage', index),
			left,
			name: passageName(index),
			selected: false,
			story: deterministicId('story', count),
			tags: tagsFor(index),
			text: textFor(index, count, options.bodyWords),
			top,
			width: passageWidth
		});
	}

	const story = {
		ifid: deterministicIfid(count),
		id: deterministicId('story', count),
		lastUpdate: '2026-01-01T00:00:00.000Z',
		name: `Benchmark ${count} passages`,
		passages,
		script: '',
		selected: false,
		snapToGrid: true,
		startPassage: passages[0]?.id ?? '',
		storyFormat: options.storyFormat,
		storyFormatVersion: options.storyFormatVersion,
		stylesheet: '',
		tags: ['benchmark', `passages-${count}`],
		tagColors: {
			checkpoint: 'blue',
			hub: 'green'
		},
		zoom: 1
	};

	const linkCounts = passages.reduce(
		(result, passage, index) => {
			for (const link of linksFor(index + 1, count)) {
				result[link.kind] += 1;
				result.total += 1;
			}

			return result;
		},
		{branch: 0, broken: 0, next: 0, self: 0, total: 0}
	);

	return {linkCounts, story};
}

function storyToHtml(story) {
	const startIndex =
		story.passages.findIndex(passage => passage.id === story.startPassage) + 1;
	const passages = story.passages
		.map((passage, index) => {
			return (
				`<tw-passagedata pid="${index + 1}" ` +
				`name="${escapeHtml(passage.name)}" ` +
				`tags="${escapeHtml(passage.tags.join(' '))}" ` +
				`position="${passage.left},${passage.top}" ` +
				`size="${passage.width},${passage.height}">` +
				`${escapeHtml(passage.text)}</tw-passagedata>`
			);
		})
		.join('');
	const tagColors = Object.keys(story.tagColors)
		.map(
			tag =>
				`<tw-tag name="${escapeHtml(tag)}" color="${escapeHtml(
					story.tagColors[tag]
				)}"></tw-tag>`
		)
		.join('');

	return (
		'<!doctype html>\n' +
		'<html><head><meta charset="utf-8"><title>' +
		`${escapeHtml(story.name)}</title></head><body>\n` +
		`<tw-storydata name="${escapeHtml(story.name)}" ` +
		`startnode="${startIndex || ''}" ` +
		'creator="Twine" creator-version="2.12.0" ' +
		`format="${escapeHtml(story.storyFormat)}" ` +
		`format-version="${escapeHtml(story.storyFormatVersion)}" ` +
		`ifid="${escapeHtml(story.ifid)}" ` +
		'options="" ' +
		`tags="${escapeHtml(story.tags.join(' '))}" ` +
		`zoom="${story.zoom}" hidden>` +
		'<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">' +
		`${story.stylesheet}</style>` +
		'<script role="script" id="twine-user-script" type="text/twine-javascript">' +
		`${story.script}</script>` +
		tagColors +
		passages +
		'</tw-storydata>\n</body></html>\n'
	);
}

function storyToTwee(story) {
	const startPassage = story.passages.find(
		passage => passage.id === story.startPassage
	);
	const storyData = {
		ifid: story.ifid,
		format: story.storyFormat,
		'format-version': story.storyFormatVersion,
		start: startPassage?.name,
		'tag-colors': story.tagColors,
		zoom: story.zoom
	};
	const passages = story.passages
		.map(passage => {
			const tags =
				passage.tags.length > 0
					? ` [${passage.tags.map(escapeTweeHeader).join(' ')}]`
					: '';
			const metadata = JSON.stringify({
				position: `${passage.left},${passage.top}`,
				size: `${passage.width},${passage.height}`
			}).replace(/\s+/g, '');

			return (
				`:: ${escapeTweeHeader(passage.name)}${tags} ${metadata}\n` +
				`${escapeTweeText(passage.text)}\n`
			);
		})
		.join('\n');

	return (
		`:: StoryTitle\n${escapeTweeText(story.name)}\n\n` +
		`:: StoryData\n${JSON.stringify(storyData, null, 2)}\n\n` +
		passages
	);
}

async function writeFixture(count, options) {
	const {linkCounts, story} = generateStory(count, options);
	const baseName = `story-${count}`;
	const files = [];

	await mkdir(options.outDir, {recursive: true});

	if (options.formats.includes('html')) {
		const file = path.join(options.outDir, `${baseName}.html`);
		await writeFile(file, storyToHtml(story));
		files.push(file);
	}

	if (options.formats.includes('twee')) {
		const file = path.join(options.outDir, `${baseName}.twee`);
		await writeFile(file, storyToTwee(story));
		files.push(file);
	}

	if (options.formats.includes('json')) {
		const file = path.join(options.outDir, `${baseName}.story.json`);
		await writeFile(file, JSON.stringify(story, null, 2) + '\n');
		files.push(file);
	}

	const manifest = {
		bodyWords: options.bodyWords,
		files: files.map(file => path.relative(rootDir, file)),
		linkCounts,
		passageCount: count,
		storyFormat: story.storyFormat,
		storyFormatVersion: story.storyFormatVersion
	};
	const manifestFile = path.join(options.outDir, `${baseName}.manifest.json`);

	await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

	return {
		files: [...files, manifestFile].map(file => path.relative(rootDir, file)),
		manifest
	};
}

try {
	const options = parseArgs(process.argv.slice(2));

	if (options.help) {
		process.stdout.write(usage());
		process.exit(0);
	}

	for (const size of options.sizes) {
		const result = await writeFixture(size, options);

		process.stdout.write(
			[
				`Generated ${size} passages`,
				`  links: ${result.manifest.linkCounts.total}`,
				...result.files.map(file => `  ${file}`)
			].join('\n') + '\n'
		);
	}
} catch (error) {
	process.stderr.write(`${error.message}\n\n${usage()}`);
	process.exit(1);
}
