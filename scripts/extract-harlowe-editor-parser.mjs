import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = path.join(
	root,
	'public/story-formats/harlowe-3.3.9/format.js'
);
const outputPath = path.join(
	root,
	'src/util/story-format/harlowe-3.3.9/harlowe-parser-vendor.js'
);
const macroOutputPath = path.join(
	root,
	'src/util/story-format/harlowe-3.3.9/harlowe-macros-vendor.js'
);
const parserBoundary = ',!function(){var t=Math.round';
const utilsBoundary = ',!function(){this&&this.loaded?(e=this.modules.Utils';
const expectedHydrateHash =
	'6599e022c1e2e532170bd0180cc01954d9f9d8c49647a8a3d89c5c690710e723';
const expectedParserHash =
	'3045729b0b41bf74b1e2fba3e392e8bb9dabae6a96b2263a820d4f8cfadb4c44';
const expectedUtilsHash =
	'48bc6c1f911a8652932e3390315f1c8ffc0fb50eca12194c0c708af94402eb9e';

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

const bundledFormat = fs.readFileSync(inputPath, 'utf8');
let properties;

// The format wrapper contains a single object literal, but its strings use
// JavaScript-only escape sequences. Capture that literal without invoking
// either its `source` or `hydrate` strings.
vm.runInNewContext(bundledFormat, {
	window: {
		storyFormat(value) {
			properties = value;
		}
	}
});

if (
	!properties ||
	properties.name !== 'Harlowe' ||
	properties.version !== '3.3.9'
) {
	throw new Error('Bundled Harlowe format wrapper changed');
}
const hydrate = properties.hydrate;

if (typeof hydrate !== 'string' || sha256(hydrate) !== expectedHydrateHash) {
	throw new Error(
		'Bundled Harlowe 3.3.9 hydrate does not match audited source'
	);
}

const boundary = hydrate.indexOf(parserBoundary);

if (boundary === -1) {
	throw new Error('Could not locate the Harlowe parser module boundary');
}

const parserSource = hydrate.slice(0, boundary);

if (sha256(parserSource) !== expectedParserHash) {
	throw new Error('Extracted Harlowe parser does not match audited source');
}

const utilsBoundaryIndex = hydrate.indexOf(utilsBoundary);
const utilsSource = hydrate.slice(0, utilsBoundaryIndex);

if (utilsBoundaryIndex === -1 || sha256(utilsSource) !== expectedUtilsHash) {
	throw new Error('Extracted Harlowe metadata does not match audited source');
}

const metadataScope = {
	document: {
		createElement() {
			return {
				append() {},
				appendChild() {},
				firstChild: null,
				setAttribute() {},
				set innerHTML(_value) {}
			};
		},
		head: {appendChild() {}},
		querySelector() {
			return null;
		}
	},
	loaded: true,
	localStorage: {
		getItem() {
			return null;
		},
		setItem() {}
	},
	modules: {}
};

vm.runInNewContext(
	`${utilsSource.replaceAll('eval("this")', 'this')};\n}).call(this);`,
	metadataScope
);
const macroDefinitions = metadataScope.modules.Utils?.ShortDefs?.Macro;

if (!macroDefinitions || Object.keys(macroDefinitions).length !== 304) {
	throw new Error('Extracted Harlowe macro metadata is incomplete');
}

const moduleSource = `/* eslint-disable */
/*
 * Harlowe 3.3.9 Lexer, Patterns, and Markup modules.
 *
 * Copyright (c) 2013-2024 Leon Arnott
 * SPDX-License-Identifier: Zlib
 *
 * Mechanically extracted from public/story-formats/harlowe-3.3.9/format.js by
 * scripts/extract-harlowe-editor-parser.mjs. The original source is Harlowe's
 * bundled editor parser; the CodeMirror 5 integration and all DOM/runtime code
 * are deliberately excluded. Do not edit this generated file directly.
 */
const harloweParserScope = {loaded: true, modules: {}};
${parserSource
	.replace('(function(){', '(function(module, define, require){')
	.replaceAll('eval("this")', 'this')};
}).call(harloweParserScope);

export const HarloweLexer = harloweParserScope.modules.Lexer;
export const HarlowePatterns = harloweParserScope.modules.Patterns;
export const HarloweMarkup = harloweParserScope.modules.Markup;
`;

fs.mkdirSync(path.dirname(outputPath), {recursive: true});
fs.writeFileSync(outputPath, moduleSource);
fs.writeFileSync(
	macroOutputPath,
	`/*
 * Harlowe 3.3.9 macro metadata.
 *
 * Copyright (c) 2013-2024 Leon Arnott
 * SPDX-License-Identifier: Zlib
 *
 * Mechanically extracted alongside harlowe-parser-vendor.js. Do not edit.
 */
export const HarloweMacroDefinitions = ${JSON.stringify(macroDefinitions)};
`
);
console.log(
	`Extracted Harlowe 3.3.9 parser and ${
		Object.keys(macroDefinitions).length
	} macro definitions to ${path.relative(root, path.dirname(outputPath))}`
);
