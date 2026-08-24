import {createHash, webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {
	StoryFormat,
	StoryFormatProperties
} from '../../store/story-formats/story-formats.types';
import {instrumentPreviewHtml} from '../story-preview-contract';
import {
	canonicalPreviewFormatAdmission,
	previewFormatAdmissionForHtml,
	previewFormatAdmissionForBuild,
	snapshotPreviewStoryFormat,
	structuralPreviewFormatTuple,
	SUGARCUBE_COMPATIBILITY
} from '../story-preview-sugarcube';

type LoadedStoryFormat = Extract<StoryFormat, {loadState: 'loaded'}>;

const EXPECTED_FORMATS = [
	[
		'2.31.0',
		'sugarcube-read-2.31',
		'sugarcube-restart-2.31',
		'83d87082885b6e9f5eaf54bc33cbeae946603c9a92815260e52a559123a836d2'
	],
	[
		'2.31.1',
		'sugarcube-read-2.31',
		'sugarcube-restart-2.31',
		'5da92f2b2f68ad8ec78096cda24fde53fd9bfddfe6230b7fe523ab01543282bc'
	],
	[
		'2.32.0',
		'sugarcube-read-2.32-2.35',
		'sugarcube-restart-2.32-2.33.0',
		'1b212aae076475039ba2f17d28a18ad06cf209c5daeda7d03c88d67cb7db688a'
	],
	[
		'2.33.0',
		'sugarcube-read-2.32-2.35',
		'sugarcube-restart-2.32-2.33.0',
		'b45ca255655c290f303e55c1e7af6bd048db3c8d55f70831f9ea1872e1634229'
	],
	[
		'2.33.1',
		'sugarcube-read-2.32-2.35',
		'sugarcube-restart-2.33.1-2.34.1',
		'4b6f141f644c4d25519f6f0dc5e18c10a316c2bfc41fdd118eabcfb266794de0'
	],
	[
		'2.33.2',
		'sugarcube-read-2.32-2.35',
		'sugarcube-restart-2.33.1-2.34.1',
		'f692bc35c1da5390166264f4900ddee3cc90b42d1c3291e9b8222a9d3379b395'
	],
	[
		'2.33.3',
		'sugarcube-read-2.32-2.35',
		'sugarcube-restart-2.33.1-2.34.1',
		'1ed27c2de282372f162841e5b98005c85561204d2672469dee3aca6a2f74c47f'
	],
	[
		'2.33.4',
		'sugarcube-read-2.32-2.35',
		'sugarcube-restart-2.33.1-2.34.1',
		'0aa47b20e8a7d233c809896df16e6f1d38db63d2608819d6de925ca529d45caa'
	],
	[
		'2.34.0',
		'sugarcube-read-2.32-2.35',
		'sugarcube-restart-2.33.1-2.34.1',
		'c3b794a27095bc310daf80a123a89303f25680b042a4eccb56bc07874a90318a'
	],
	[
		'2.34.1',
		'sugarcube-read-2.32-2.35',
		'sugarcube-restart-2.33.1-2.34.1',
		'5ce9f9528a6be5c5c37d493609d700ee91a10827f7e506696999d141b6e17e01'
	],
	[
		'2.35.0',
		'sugarcube-read-2.32-2.35',
		'sugarcube-restart-2.35',
		'3f6344162d94bd896f411845a5f238dce4f112b71b065d2fe326ff273a460c3c'
	],
	[
		'2.36.0',
		'sugarcube-read-2.36',
		'sugarcube-restart-2.36',
		'84b480220e1c0873b3263be4b876c01466eb0fb89ac1b7939dc583f422a03aef'
	],
	[
		'2.36.1',
		'sugarcube-read-2.36',
		'sugarcube-restart-2.36',
		'0dc22abfd93af05636b2dbab5a3a5892687c849d38b0c3f174484e407126685d'
	],
	[
		'2.37.0',
		'sugarcube-read-2.37',
		'sugarcube-restart-2.37',
		'bbb5660be99b3e1f05f30574c716cbb78637172f8d9fafbf1b52cfb3dd939a34'
	],
	[
		'2.37.3',
		'sugarcube-read-2.37',
		'sugarcube-restart-2.37',
		'9a2954dd88a55a6738411fe7a93409ff2150662e5296e76808ce5c0d9310b533'
	]
] as const;

function loadBundledProperties(version: string): StoryFormatProperties {
	const file = readFileSync(
		resolve(
			__dirname,
			`../../../public/story-formats/sugarcube-${version}/format.js`
		),
		'utf8'
	);
	const prefix = 'window.storyFormat(';
	const suffix = ');';

	expect(file.startsWith(prefix)).toBe(true);
	expect(file.endsWith(suffix)).toBe(true);
	return JSON.parse(file.slice(prefix.length, -suffix.length));
}

function formatRecord(
	version: string,
	properties = loadBundledProperties(version)
): LoadedStoryFormat {
	return {
		id: `sugarcube-${version}`,
		loadState: 'loaded',
		name: 'SugarCube',
		properties,
		url: `story-formats/sugarcube-${version}/format.js`,
		userAdded: false,
		version
	};
}

function storyData(version: string) {
	return `<html><body><tw-storydata format="SugarCube" format-version="${version}"></tw-storydata></body></html>`;
}

describe('bundled SugarCube compatibility artifacts', () => {
	it.each(EXPECTED_FORMATS)(
		'authenticates bundled SugarCube %s with its independently expected profiles',
		(version, readProfileId, restartProfileId, expectedSha256) => {
			const properties = loadBundledProperties(version);
			const digest = createHash('sha256')
				.update(properties.source, 'utf8')
				.digest('hex');
			const entry = SUGARCUBE_COMPATIBILITY.find(
				candidate => candidate.version === version
			);

			expect(properties).toMatchObject({name: 'SugarCube', version});
			if (!entry) {
				throw new Error(`Missing compatibility entry for ${version}.`);
			}
			expect(entry).toEqual({
				adapterId: `sugarcube-${version}`,
				readProfileId,
				restartProfileId,
				sourceSha256: expectedSha256,
				url: `story-formats/sugarcube-${version}/format.js`,
				version
			});
			expect(digest).toBe(expectedSha256);

			const publishedSource = properties.source.replace(
				'{{STORY_DATA}}',
				`<tw-storydata format="SugarCube" format-version="${version}"></tw-storydata>`
			);
			const instrumented = instrumentPreviewHtml(
				publishedSource,
				`artifact-${version}`,
				{
					admission: {
						adapterId: entry.adapterId,
						format: 'SugarCube',
						kind: 'builtin-sha256',
						sourceSha256: expectedSha256,
						version: entry.version
					}
				}
			);

			expect(instrumented.sugarCubeRestartEligible).toBe(true);
			expect(instrumented.html).toContain(
				'window.__twineRsPreviewSugarCubeStart(Engine,Config)'
			);
		}
	);

	it('keeps the test inventory separate and complete', () => {
		expect(EXPECTED_FORMATS.map(([version]) => version)).toEqual(
			SUGARCUBE_COMPATIBILITY.map(entry => entry.version)
		);
	});
});

describe('SugarCube preview admission', () => {
	const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(
		globalThis,
		'crypto'
	);

	beforeAll(() => {
		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: webcrypto
		});
	});

	afterAll(() => {
		if (originalCryptoDescriptor) {
			Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
		} else {
			delete (globalThis as {crypto?: Crypto}).crypto;
		}
	});

	it.each(EXPECTED_FORMATS)(
		'admits canonical bundled SugarCube %s source and structural tuple',
		async version => {
			const format = formatRecord(version);
			const snapshot = snapshotPreviewStoryFormat(
				[format],
				format,
				format.properties
			);

			await expect(
				previewFormatAdmissionForBuild(snapshot, storyData(version))
			).resolves.toMatchObject({
				adapterId: `sugarcube-${version}`,
				kind: 'builtin-sha256',
				version
			});
		}
	);

	it.each([
		[
			'modified source',
			(format: LoadedStoryFormat) => ({
				format,
				formats: [format],
				properties: {
					...format.properties,
					source: `${format.properties.source} `
				},
				html: storyData('2.31.0')
			})
		],
		[
			'ambiguous built-in',
			(format: LoadedStoryFormat) => ({
				format,
				formats: [format, {...format, id: 'duplicate'}],
				properties: format.properties,
				html: storyData('2.31.0')
			})
		],
		[
			'user-added format',
			(format: LoadedStoryFormat) => {
				const changed = {...format, userAdded: true};
				return {
					format: changed,
					formats: [changed],
					properties: changed.properties,
					html: storyData('2.31.0')
				};
			}
		],
		[
			'wrong loaded version',
			(format: LoadedStoryFormat) => ({
				format,
				formats: [format],
				properties: {...format.properties, version: '2.31.1'},
				html: storyData('2.31.0')
			})
		],
		[
			'wrong runtime tuple',
			(format: LoadedStoryFormat) => ({
				format,
				formats: [format],
				properties: format.properties,
				html: storyData('2.31.1')
			})
		]
	] as const)('rejects a %s', async (_label, arrange) => {
		const arranged = arrange(formatRecord('2.31.0'));
		const snapshot = snapshotPreviewStoryFormat(
			arranged.formats as StoryFormat[],
			arranged.format,
			arranged.properties
		);

		await expect(
			previewFormatAdmissionForBuild(snapshot, arranged.html)
		).resolves.toEqual({kind: 'none'});
	});

	it('rejects unbundled SugarCube versions', async () => {
		const properties = {
			...loadBundledProperties('2.37.3'),
			version: '2.37.2'
		};
		const format = formatRecord('2.37.2', properties);
		const snapshot = snapshotPreviewStoryFormat([format], format, properties);

		await expect(
			previewFormatAdmissionForBuild(snapshot, storyData('2.37.2'))
		).resolves.toEqual({kind: 'none'});
	});

	it('uses one immutable source snapshot across delayed hashing and build input', async () => {
		const properties = loadBundledProperties('2.37.3');
		const format = formatRecord('2.37.3', properties);
		const snapshot = snapshotPreviewStoryFormat([format], format, properties);
		const cryptoDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			'crypto'
		);
		let release!: () => void;
		const gate = new Promise<void>(resolveGate => {
			release = resolveGate;
		});
		const digest = jest.fn(async (_algorithm: string, input: BufferSource) => {
			await gate;
			const bytes = new Uint8Array(
				input instanceof ArrayBuffer
					? input
					: input.buffer.slice(
							input.byteOffset,
							input.byteOffset + input.byteLength
						)
			);
			return Uint8Array.from(createHash('sha256').update(bytes).digest())
				.buffer;
		});

		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: {subtle: {digest}}
		});
		try {
			const admission = previewFormatAdmissionForBuild(
				snapshot,
				storyData('2.37.3')
			);

			properties.name = 'Mutated';
			properties.source = 'mutated source';
			properties.version = '0.0.0';
			format.name = 'Mutated';
			format.url = 'mutated';
			format.version = '0.0.0';
			release();

			await expect(admission).resolves.toMatchObject({
				adapterId: 'sugarcube-2.37.3',
				kind: 'builtin-sha256'
			});
			expect(snapshot.buildProperties).toMatchObject({
				name: 'SugarCube',
				version: '2.37.3'
			});
			expect(snapshot.buildProperties.source).not.toBe('mutated source');
		} finally {
			if (cryptoDescriptor) {
				Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
			} else {
				delete (globalThis as {crypto?: Crypto}).crypto;
			}
		}
	});

	it('falls back to generic when hashing fails', async () => {
		const format = formatRecord('2.31.0');
		const snapshot = snapshotPreviewStoryFormat(
			[format],
			format,
			format.properties
		);
		const cryptoDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			'crypto'
		);

		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: {
				subtle: {
					digest: jest.fn(async () => Promise.reject(new Error('failed')))
				}
			}
		});
		try {
			await expect(
				previewFormatAdmissionForBuild(snapshot, storyData('2.31.0'))
			).resolves.toEqual({kind: 'none'});
		} finally {
			if (cryptoDescriptor) {
				Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
			} else {
				delete (globalThis as {crypto?: Crypto}).crypto;
			}
		}
	});
});

describe('SugarCube preview serialization and structure boundaries', () => {
	it('canonicalizes only the exact matrix-agreed admission shape', () => {
		const entry = SUGARCUBE_COMPATIBILITY[0];
		const canonical = {
			adapterId: entry.adapterId,
			format: 'SugarCube',
			kind: 'builtin-sha256',
			sourceSha256: entry.sourceSha256,
			version: entry.version
		};

		expect(canonicalPreviewFormatAdmission(undefined)).toEqual({kind: 'none'});
		expect(canonicalPreviewFormatAdmission(canonical)).toEqual(canonical);
		expect(
			canonicalPreviewFormatAdmission({...canonical, unexpected: true})
		).toBeUndefined();
		expect(
			canonicalPreviewFormatAdmission({
				...canonical,
				sourceSha256: 'A'.repeat(64)
			})
		).toBeUndefined();
		expect(
			canonicalPreviewFormatAdmission({...canonical, version: '2.31.1'})
		).toBeUndefined();
		expect(
			canonicalPreviewFormatAdmission({kind: 'none', extra: true})
		).toBeUndefined();
	});

	it('accepts one effective story-data tuple while ignoring tag-like text', () => {
		const html = `<html><head>
			<script>const fake = '<tw-storydata format="SugarCube" format-version="0">';</script>
			<style>/* <tw-storydata format="SugarCube" format-version="0"> */</style>
			<!-- <tw-storydata format="SugarCube" format-version="0"> -->
		</head><body>
			<tw-storydata format="SugarCube" format-version="2.37.3">
				<tw-passagedata>&lt;tw-storydata format="SugarCube" format-version="0"&gt;</tw-passagedata>
			</tw-storydata>
		</body></html>`;

		expect(structuralPreviewFormatTuple(html)).toEqual({
			format: 'SugarCube',
			version: '2.37.3'
		});
	});

	it('binds exact admission to one matching structural tuple', () => {
		const compatibility = SUGARCUBE_COMPATIBILITY[0];
		const admission = {
			adapterId: compatibility.adapterId,
			format: 'SugarCube' as const,
			kind: 'builtin-sha256' as const,
			sourceSha256: compatibility.sourceSha256,
			version: compatibility.version
		};

		expect(
			previewFormatAdmissionForHtml(admission, storyData(compatibility.version))
		).toBe(admission);
		expect(
			previewFormatAdmissionForHtml(admission, storyData('2.37.3'))
		).toEqual({kind: 'none'});
		expect(
			previewFormatAdmissionForHtml(
				admission,
				`${storyData(compatibility.version)}${storyData(compatibility.version)}`
			)
		).toEqual({kind: 'none'});
	});

	it('enforces the structural tuple without DOMParser in Electron main', () => {
		const domParserDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			'DOMParser'
		);

		Object.defineProperty(globalThis, 'DOMParser', {
			configurable: true,
			value: undefined
		});
		try {
			const tuple =
				'<tw-storydata format="SugarCube" format-version="2.31.0"></tw-storydata>';

			expect(structuralPreviewFormatTuple(storyData('2.31.0'))).toEqual({
				format: 'SugarCube',
				version: '2.31.0'
			});
			expect(
				structuralPreviewFormatTuple(`<!DOCTYPE html><html>${tuple}</html>`)
			).toEqual({format: 'SugarCube', version: '2.31.0'});
			expect(
				structuralPreviewFormatTuple(
					`${storyData('2.31.0')}${storyData('2.31.0')}`
				)
			).toBeUndefined();
			for (const container of [
				'math',
				'noscript',
				'select',
				'svg',
				'template'
			]) {
				expect(
					structuralPreviewFormatTuple(
						`<html><body><${container}>${tuple}</${container}></body></html>`
					)
				).toBeUndefined();
			}
			for (const unsupportedMarkup of [
				`<!DOCTYPE html><html><frameset>${tuple}</frameset></html>`,
				`<svg><![CDATA[${tuple}]]></svg>`,
				`<math><![CDATA[${tuple}]]></math>`,
				`<?ignored ${tuple} ?>`,
				`<!ignored ${tuple}>`,
				`</ignored ${tuple}>>`
			]) {
				expect(structuralPreviewFormatTuple(unsupportedMarkup)).toBeUndefined();
			}
			expect(
				structuralPreviewFormatTuple(
					`<html><body>${tuple}<template>${tuple}</template><noscript>${tuple}</noscript></body></html>`
				)
			).toEqual({format: 'SugarCube', version: '2.31.0'});

			const compatibility = SUGARCUBE_COMPATIBILITY[0];
			const publishedInertSource = loadBundledProperties(
				'2.31.0'
			).source.replace('{{STORY_DATA}}', `<template>${tuple}</template>`);
			const instrumented = instrumentPreviewHtml(
				publishedInertSource,
				'inert-main-session',
				{
					admission: {
						adapterId: compatibility.adapterId,
						format: 'SugarCube',
						kind: 'builtin-sha256',
						sourceSha256: compatibility.sourceSha256,
						version: compatibility.version
					}
				}
			);

			expect(instrumented).toMatchObject({
				admission: {kind: 'none'},
				sugarCubeRestartEligible: false
			});
			expect(instrumented.html).toContain(
				'var FIXED_SUGARCUBE_ADAPTER = undefined'
			);
		} finally {
			if (domParserDescriptor) {
				Object.defineProperty(globalThis, 'DOMParser', domParserDescriptor);
			} else {
				delete (globalThis as {DOMParser?: typeof DOMParser}).DOMParser;
			}
		}
	});

	it.each([
		['zero', '<html><body></body></html>'],
		[
			'duplicate',
			`${storyData('2.31.0')}<tw-storydata format="SugarCube" format-version="2.31.0"></tw-storydata>`
		],
		['missing format', '<tw-storydata format-version="2.31.0"></tw-storydata>'],
		['missing version', '<tw-storydata format="SugarCube"></tw-storydata>']
	])('rejects %s effective story-data structures', (_label, html) => {
		expect(structuralPreviewFormatTuple(html)).toBeUndefined();
	});
});
