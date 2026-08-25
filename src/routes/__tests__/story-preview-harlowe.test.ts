import {createHash, webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
	MessageChannel as NodeMessageChannel,
	MessagePort as NodeMessagePort
} from 'node:worker_threads';
import {extractStoryFormatProperties} from '../../electron/main-process/story-format-source';
import type {
	StoryFormat,
	StoryFormatProperties
} from '../../store/story-formats/story-formats.types';
import {
	instrumentPreviewHtml,
	STORY_PREVIEW_COMMAND_SOURCE
} from '../story-preview-contract';
import {
	canonicalPreviewFormatAdmission,
	previewFormatAdmissionForBuild,
	snapshotPreviewStoryFormat
} from '../story-preview-format';
import {
	HARLOWE_3_3_9_COMPATIBILITY,
	HARLOWE_3_3_9_STATE_PROFILE
} from '../story-preview-harlowe';

type LoadedStoryFormat = Extract<StoryFormat, {loadState: 'loaded'}>;

function loadBundledHarloweProperties(): StoryFormatProperties {
	return extractStoryFormatProperties(
		readFileSync(
			resolve(
				__dirname,
				'../../../public/story-formats/harlowe-3.3.9/format.js'
			),
			'utf8'
		)
	);
}

function formatRecord(
	properties = loadBundledHarloweProperties()
): LoadedStoryFormat {
	return {
		id: 'harlowe-3.3.9',
		loadState: 'loaded',
		name: 'Harlowe',
		properties,
		url: HARLOWE_3_3_9_COMPATIBILITY.url,
		userAdded: false,
		version: '3.3.9'
	};
}

function storyData(extraBeforeAuthor = '') {
	return `<tw-storydata name="Probe" startnode="1" creator="Twine" creator-version="2.10.0" format="Harlowe" format-version="3.3.9" ifid="00000000-0000-4000-8000-000000000001" options="" tags="" zoom="1" hidden><style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css"></style>${extraBeforeAuthor}<script role="script" id="twine-user-script" type="text/twine-javascript">window.authorScriptRan = true;</script><tw-passagedata pid="1" name="Start" tags="" position="100,100" size="100,100">Start</tw-passagedata></tw-storydata>`;
}

function publishedHtmlWithStoryData(
	data: string,
	properties = loadBundledHarloweProperties()
) {
	return properties.source
		.replace(/{{STORY_NAME}}/g, 'Probe')
		.replace(/{{STORY_DATA}}/g, data);
}

function publishedHtml(properties = loadBundledHarloweProperties()) {
	return publishedHtmlWithStoryData(storyData(), properties);
}

function exactAdmission() {
	return {
		adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
		format: 'Harlowe' as const,
		kind: 'builtin-sha256' as const,
		sourceSha256: HARLOWE_3_3_9_COMPATIBILITY.sourceSha256,
		version: HARLOWE_3_3_9_COMPATIBILITY.version
	};
}

function installExactHarloweBridge(sessionId: string) {
	const result = instrumentPreviewHtml(publishedHtml(), sessionId, {
		admission: exactAdmission(),
		enableHarloweSessionStorageFallback: true
	});
	const source = /<head[^>]*>\s*<script>([\s\S]*?)<\/script>/i.exec(
		result.html
	)?.[1];
	const frame = document.createElement('iframe');

	expect(source).toBeDefined();
	document.body.append(frame);
	Object.defineProperty(frame.contentWindow, 'MessagePort', {
		configurable: true,
		value: NodeMessagePort
	});
	frame.contentDocument!.body.innerHTML =
		'<tw-storydata format="Harlowe" format-version="3.3.9"></tw-storydata>';
	(frame.contentWindow as unknown as {eval(source: string): unknown}).eval(
		source!
	);
	const remove = frame.remove.bind(frame);

	frame.remove = () => {
		const connection = harloweReadinessConnections.get(frame);

		connection?.hostPort.close();
		connection?.runtimePort.close();
		harloweReadinessConnections.delete(frame);
		remove();
	};

	return frame;
}

const HARLOWE_BOOTSTRAP_CHALLENGE = 'c'.repeat(64);

interface HarloweReadinessConnection {
	hostPort: NodeMessagePort;
	messages: Array<Record<string, unknown>>;
	runtimePort: NodeMessagePort;
}

const harloweReadinessConnections = new WeakMap<
	HTMLIFrameElement,
	HarloweReadinessConnection
>();

function harloweReadinessMessages(connection: HarloweReadinessConnection) {
	return connection.messages.filter(
		message => message.type === 'debugger-bootstrap-ready'
	);
}

async function waitForHarloweReadinessCount(
	connection: HarloweReadinessConnection,
	count: number
) {
	const deadline = Date.now() + 1000;

	while (
		harloweReadinessMessages(connection).length < count &&
		Date.now() < deadline
	) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
	expect(harloweReadinessMessages(connection)).toHaveLength(count);
}

async function settleHarloweReadinessPort() {
	await new Promise(resolve => setTimeout(resolve, 0));
	await new Promise(resolve => setTimeout(resolve, 0));
}

function issueHarloweBootstrapChallenge(
	frame: HTMLIFrameElement,
	sessionId: string,
	bootstrapChallenge = HARLOWE_BOOTSTRAP_CHALLENGE
) {
	const runtime = frame.contentWindow!;
	let connection = harloweReadinessConnections.get(frame);

	if (!connection) {
		const channel = new NodeMessageChannel();
		const messages: Array<Record<string, unknown>> = [];

		channel.port1.on('message', message => messages.push(message));
		channel.port1.unref();
		channel.port2.unref();
		connection = {
			hostPort: channel.port1,
			messages,
			runtimePort: channel.port2
		};
		harloweReadinessConnections.set(frame, connection);
		const RuntimeMessageEvent = (
			runtime as unknown as {MessageEvent: typeof MessageEvent}
		).MessageEvent;

		runtime.dispatchEvent(
			new RuntimeMessageEvent('message', {
				data: {
					adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
					protocolVersion: 1,
					sessionId,
					source: STORY_PREVIEW_COMMAND_SOURCE,
					type: 'debugger-bootstrap-port'
				},
				ports: [channel.port2 as unknown as MessagePort],
				source: window
			})
		);
	}

	connection.hostPort.postMessage({
		adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
		bootstrapChallenge,
		protocolVersion: 1,
		sessionId,
		source: STORY_PREVIEW_COMMAND_SOURCE,
		type: 'debugger-bootstrap-challenge'
	});
	return connection;
}

const EXACT_STATE_OBJECT_SOURCE =
	'{get passage(){return d.passage},get variables(){return i.variables},get pastLength(){return p},get timeline(){return u},on:function(e,t){if(e in l)return"function"!=typeof t||l[e].includes(t)||l[e].push(t),a;y.impossible("State.on","invalid event name")}}';
const EXACT_STATE_DEFINITION = `var State=Object.freeze(${EXACT_STATE_OBJECT_SOURCE});`;
const EXACT_STATE_FIXTURE_SOURCE = `
(function(){
	var d={passage:"Start"};
	var l={forward:[],back:[],load:[],forgetUndos:[]};
	var i={variables:{gold:1}};
	var u=[{passage:"Start"}];
	var p=0;
	var a={};
	var y={impossible:function(){}};
	var n=function(){};
	${EXACT_STATE_DEFINITION}
	var S={set:[],delete:[]};
	var c=Object.freeze({on:function(e,t){if(e in S)return"function"!=typeof t||S[e].includes(t)||S[e].push(t),c;n("VarRef.on","invalid event name")}});
	window.__harloweFixture={State:State,VarRef:c,listeners:l,varRefListeners:S,failPassageRead:function(){Object.defineProperty(d,"passage",{configurable:true,get:function(){throw new Error("blocked passage")}})},setPassage:function(value){Object.defineProperty(d,"passage",{configurable:true,enumerable:true,value:value,writable:true})},setVariable:function(value){i.variables.gold=value;S.set.forEach(function(listener){listener()})},setVariables:function(value){i.variables=value;S.set.forEach(function(listener){listener()})},setNestedVariable:function(){i.variables.nested.value+=1;S.set.forEach(function(listener){listener()})},deleteVariable:function(name){delete i.variables[name];S.delete.forEach(function(listener){listener()})},setTimeline:function(value){u=value},setPastLength:function(value){p=value},emit:function(event){l[event].forEach(function(listener){listener()})}};
}());`;

describe('bundled Harlowe 3.3.9 exact debugger profile', () => {
	it('machine-checks the decoded source digest and executable State profile', () => {
		const properties = loadBundledHarloweProperties();
		const digest = createHash('sha256')
			.update(properties.source, 'utf8')
			.digest('hex');

		expect(properties).toMatchObject({name: 'Harlowe', version: '3.3.9'});
		expect(digest).toBe(HARLOWE_3_3_9_COMPATIBILITY.sourceSha256);
		expect(HARLOWE_3_3_9_STATE_PROFILE).toEqual({
			capabilityDependencies: {
				currentPassage: ['state.passage', 'state.on'],
				storyVariables: ['state.variables', 'varRef.on'],
				visitedPassages: ['state.timeline', 'state.pastLength']
			},
			events: {capture: ['forward', 'back', 'load', 'forgetUndos']},
			moduleName: 'state',
			on: {
				configurable: false,
				enumerable: true,
				source:
					'function(e,t){if(e in l)return"function"!=typeof t||l[e].includes(t)||l[e].push(t),a;y.impossible("State.on","invalid event name")}',
				writable: false
			},
			passage: {
				configurable: false,
				enumerable: true,
				getterSource: 'get passage(){return d.passage}',
				setter: false
			},
			pastLength: {
				configurable: false,
				enumerable: true,
				getterSource: 'get pastLength(){return p}',
				setter: false
			},
			stateFrozen: true,
			timeline: {
				configurable: false,
				enumerable: true,
				getterSource: 'get timeline(){return u}',
				setter: false
			},
			varRef: {
				moduleName: 'internaltypes/varref',
				on: {
					configurable: false,
					enumerable: true,
					source:
						'function(e,t){if(e in S)return"function"!=typeof t||S[e].includes(t)||S[e].push(t),c;n("VarRef.on","invalid event name")}',
					writable: false
				},
				stateFrozen: true
			},
			variables: {
				configurable: false,
				enumerable: true,
				getterSource: 'get variables(){return i.variables}',
				setter: false
			}
		});
	});

	describe('preview admission', () => {
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

		it('admits only the canonical built-in source and generated tuple', async () => {
			const format = formatRecord();
			const snapshot = snapshotPreviewStoryFormat(
				[format],
				format,
				format.properties
			);

			await expect(
				previewFormatAdmissionForBuild(
					snapshot,
					publishedHtml(format.properties)
				)
			).resolves.toEqual(exactAdmission());
			expect(canonicalPreviewFormatAdmission(exactAdmission())).toEqual(
				exactAdmission()
			);
			expect(
				canonicalPreviewFormatAdmission({
					...exactAdmission(),
					unexpected: true
				})
			).toBeUndefined();
		});

		it.each([
			[
				'modified source',
				(format: LoadedStoryFormat) => ({
					format,
					formats: [format],
					html: publishedHtml(format.properties),
					properties: {
						...format.properties,
						source: `${format.properties.source} `
					}
				})
			],
			[
				'ambiguous built-in',
				(format: LoadedStoryFormat) => ({
					format,
					formats: [format, {...format, id: 'duplicate'}],
					html: publishedHtml(format.properties),
					properties: format.properties
				})
			],
			[
				'user-added record',
				(format: LoadedStoryFormat) => {
					const changed = {...format, userAdded: true};
					return {
						format: changed,
						formats: [changed],
						html: publishedHtml(format.properties),
						properties: format.properties
					};
				}
			],
			[
				'wrong URL',
				(format: LoadedStoryFormat) => {
					const changed = {
						...format,
						url: 'story-formats/harlowe-custom/format.js'
					};
					return {
						format: changed,
						formats: [changed],
						html: publishedHtml(format.properties),
						properties: format.properties
					};
				}
			],
			[
				'wrong name',
				(format: LoadedStoryFormat) => {
					const changed = {...format, name: 'Harlowe Custom'};
					return {
						format: changed,
						formats: [changed],
						html: publishedHtml(format.properties),
						properties: format.properties
					};
				}
			],
			[
				'wrong version',
				(format: LoadedStoryFormat) => {
					const changed = {...format, version: '3.3.8'};
					return {
						format: changed,
						formats: [changed],
						html: publishedHtml(format.properties),
						properties: format.properties
					};
				}
			],
			[
				'wrong loaded name',
				(format: LoadedStoryFormat) => ({
					format,
					formats: [format],
					html: publishedHtml(format.properties),
					properties: {...format.properties, name: 'Harlowe Custom'}
				})
			],
			[
				'wrong loaded version',
				(format: LoadedStoryFormat) => ({
					format,
					formats: [format],
					html: publishedHtml(format.properties),
					properties: {...format.properties, version: '3.3.8'}
				})
			],
			[
				'wrong generated tuple',
				(format: LoadedStoryFormat) => ({
					format,
					formats: [format],
					html: publishedHtml(format.properties).replace(
						'format-version="3.3.9"',
						'format-version="3.3.8"'
					),
					properties: format.properties
				})
			],
			[
				'missing generated tuple',
				(format: LoadedStoryFormat) => ({
					format,
					formats: [format],
					html: publishedHtml(format.properties).replace(
						'<tw-storydata ',
						'<tw-storydatx '
					),
					properties: format.properties
				})
			],
			[
				'duplicate generated tuple',
				(format: LoadedStoryFormat) => ({
					format,
					formats: [format],
					html: publishedHtml(format.properties).replace(
						'</body>',
						'<tw-storydata format="Harlowe" format-version="3.3.9"></tw-storydata></body>'
					),
					properties: format.properties
				})
			]
		] as const)('rejects %s', async (_label, arrange) => {
			const arranged = arrange(formatRecord());
			const snapshot = snapshotPreviewStoryFormat(
				arranged.formats as StoryFormat[],
				arranged.format,
				arranged.properties
			);

			await expect(
				previewFormatAdmissionForBuild(snapshot, arranged.html)
			).resolves.toEqual({kind: 'none'});
		});
	});

	it('inserts one inert bootstrap immediately before the author script', () => {
		const result = instrumentPreviewHtml(publishedHtml(), 'harlowe-exact', {
			admission: exactAdmission(),
			enableHarloweSessionStorageFallback: true
		});
		const parsed = new DOMParser().parseFromString(result.html, 'text/html');
		const story = parsed.querySelector('tw-storydata')!;
		const roles = Array.from(story.querySelectorAll('script[role="script"]'));
		const bootstrap = parsed.querySelector(
			'script#twine-rs-harlowe-debugger-bootstrap'
		)!;
		const author = parsed.querySelector('script#twine-user-script')!;

		expect(result.admission).toEqual(exactAdmission());
		expect(roles).toEqual([bootstrap, author]);
		expect(bootstrap.parentElement).toBe(story);
		expect(author.previousElementSibling).toBe(bootstrap);
		expect(bootstrap.getAttribute('type')).toBe('text/twine-javascript');
		expect(bootstrap.textContent).toContain(
			'state=require("state");varRef=require("internaltypes/varref");'
		);
		expect(bootstrap.textContent).toContain(
			'try{window.__twineRsPreviewHarloweBootstrap(state,varRef);}'
		);
		expect(result.html).toContain('"captureHandler":"harlowe-state"');
	});

	it('performs the same structural admission in the Electron no-DOMParser path', () => {
		const domParserDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			'DOMParser'
		);

		try {
			Object.defineProperty(globalThis, 'DOMParser', {
				configurable: true,
				value: undefined
			});
			const result = instrumentPreviewHtml(
				publishedHtml(),
				'harlowe-electron-exact',
				{
					admission: exactAdmission(),
					enableHarloweSessionStorageFallback: true
				}
			);

			expect(result.admission).toEqual(exactAdmission());
			expect(
				result.html.match(/id="twine-rs-harlowe-debugger-bootstrap"/g)
			).toHaveLength(1);
			expect(result.html).toContain('"captureHandler":"harlowe-state"');
		} finally {
			if (domParserDescriptor) {
				Object.defineProperty(globalThis, 'DOMParser', domParserDescriptor);
			} else {
				delete (globalThis as {DOMParser?: typeof DOMParser}).DOMParser;
			}
		}
	});

	it.each([
		[
			'missing author script',
			storyData().replace(
				/<script role="script" id="twine-user-script"[\s\S]*?<\/script>/,
				''
			)
		],
		[
			'duplicate author script',
			storyData().replace(
				'</tw-storydata>',
				'<script role="script" id="twine-user-script" type="text/twine-javascript"></script></tw-storydata>'
			)
		],
		[
			'nested author script',
			storyData().replace(
				/(<script role="script" id="twine-user-script"[\s\S]*?<\/script>)/,
				'<div>$1</div>'
			)
		],
		[
			'pre-existing debugger bootstrap',
			storyData(
				'<script id="twine-rs-harlowe-debugger-bootstrap" role="script" type="text/twine-javascript"></script>'
			)
		]
	] as const)('refuses structurally unsafe %s input', (_label, data) => {
		const result = instrumentPreviewHtml(
			publishedHtmlWithStoryData(data),
			`harlowe-structural-${_label}`,
			{admission: exactAdmission()}
		);

		expect(result.admission).toEqual({kind: 'none'});
		if (_label !== 'pre-existing debugger bootstrap') {
			expect(result.html).not.toContain(
				'id="twine-rs-harlowe-debugger-bootstrap"'
			);
		}
		expect(result.html).toContain('var FIXED_READ_ADAPTER = undefined');
	});

	it('ignores inert and non-role script decoys when locating the author script', () => {
		const data = storyData(
			'<template><div role="script" id="inert-decoy">window.inert = true;</div></template><script id="non-role-decoy" type="text/javascript"></script>'
		);
		const result = instrumentPreviewHtml(
			publishedHtmlWithStoryData(data),
			'harlowe-inert-decoys',
			{admission: exactAdmission()}
		);

		expect(result.admission).toEqual(exactAdmission());
		expect(result.html).toContain('id="inert-decoy"');
		expect(result.html).toContain('id="non-role-decoy"');
		expect(
			result.html.match(/id="twine-rs-harlowe-debugger-bootstrap"/g)
		).toHaveLength(1);
	});

	it.each(
		[
			['direct', '<div role="script">window.inert = true;</div>'],
			[
				'nested',
				'<section><div role="script">window.inert = true;</div></section>'
			]
		].flatMap(([label, descendant]) => [
			[`${label} with DOMParser`, descendant, true],
			[`${label} without DOMParser`, descendant, false]
		])
	)(
		'ignores role-like noscript descendant %s',
		(_label, descendant, useDom) => {
			const nativeDOMParser = globalThis.DOMParser;
			const source = publishedHtmlWithStoryData(
				storyData(`<noscript>${descendant}</noscript>`)
			);

			try {
				if (!useDom) {
					Object.defineProperty(globalThis, 'DOMParser', {
						configurable: true,
						value: undefined
					});
				}
				const result = instrumentPreviewHtml(
					source,
					`harlowe-noscript-descendant-${useDom}`,
					{admission: exactAdmission()}
				);

				expect(result.admission).toEqual(exactAdmission());
				expect(result.html).toContain(
					'<div role="script">window.inert = true;</div>'
				);
				expect(
					result.html.match(/id="twine-rs-harlowe-debugger-bootstrap"/g)
				).toHaveLength(1);
			} finally {
				Object.defineProperty(globalThis, 'DOMParser', {
					configurable: true,
					value: nativeDOMParser
				});
			}
		}
	);

	it.each(
		[
			[
				'SVG direct noscript',
				'<svg><noscript><div role="script">window.foreign = true;</div></noscript></svg>'
			],
			[
				'SVG nested noscript',
				'<svg><g><noscript><section><div role="script">window.foreign = true;</div></section></noscript></g></svg>'
			],
			[
				'MathML direct noscript',
				'<math><noscript><div role="script">window.foreign = true;</div></noscript></math>'
			],
			[
				'MathML nested noscript',
				'<math><mrow><noscript><section><div role="script">window.foreign = true;</div></section></noscript></mrow></math>'
			],
			[
				'SVG raw-text sibling',
				'<svg><title><div role="script">window.foreign = true;</div></title></svg>'
			],
			[
				'SVG foreign template adoption',
				'<svg><noscript><template><div role="script">window.inert = true;</div></template><div role="script">window.foreign = true;</div></noscript></svg>'
			]
		].flatMap(([label, extra]) => [
			[`${label} with DOMParser`, extra, true],
			[`${label} without DOMParser`, extra, false]
		])
	)('rejects foreign-content role adoption %s', (_label, extra, useDom) => {
		const source = publishedHtmlWithStoryData(storyData(extra as string));
		const sessionId = `harlowe-foreign-role-${_label}`;
		const nativeDOMParser = globalThis.DOMParser;

		try {
			if (!useDom) {
				Object.defineProperty(globalThis, 'DOMParser', {
					configurable: true,
					value: undefined
				});
			}
			const result = instrumentPreviewHtml(source, sessionId, {
				admission: exactAdmission(),
				enableHarloweSessionStorageFallback: true
			});
			const generic = instrumentPreviewHtml(source, sessionId, {
				admission: {kind: 'none'},
				enableHarloweSessionStorageFallback: true
			});

			expect(result.admission).toEqual({kind: 'none'});
			expect(result.html).toBe(generic.html);
			expect(result.html).not.toContain(
				'id="twine-rs-harlowe-debugger-bootstrap"'
			);
		} finally {
			Object.defineProperty(globalThis, 'DOMParser', {
				configurable: true,
				value: nativeDOMParser
			});
		}
	});

	it.each(
		[
			['direct div', '<div role="script">window.direct = true;</div>'],
			[
				'nested span',
				'<section><span role="script">window.nested = true;</span></section>'
			],
			['SVG element', '<svg><g role="script">window.svg = true;</g></svg>'],
			[
				'MathML element',
				'<math><mrow role="script">window.math = true;</mrow></math>'
			],
			[
				'template element',
				'<template role="script">window.live = true;</template>'
			],
			[
				'noscript element',
				'<noscript role="script">window.live = true;</noscript>'
			]
		].flatMap(([label, extra]) => [
			[`${label} with DOMParser`, extra, true],
			[`${label} without DOMParser`, extra, false]
		])
	)('rejects effective non-script role element %s', (_label, extra, useDom) => {
		const source = publishedHtmlWithStoryData(storyData(extra as string));
		const sessionId = `harlowe-role-element-${_label}`;
		const nativeDOMParser = globalThis.DOMParser;

		try {
			if (!useDom) {
				Object.defineProperty(globalThis, 'DOMParser', {
					configurable: true,
					value: undefined
				});
			}
			const result = instrumentPreviewHtml(source, sessionId, {
				admission: exactAdmission(),
				enableHarloweSessionStorageFallback: true
			});
			const generic = instrumentPreviewHtml(source, sessionId, {
				admission: {kind: 'none'},
				enableHarloweSessionStorageFallback: true
			});

			expect(result.admission).toEqual({kind: 'none'});
			expect(result.html).toBe(generic.html);
			expect(result.html).not.toContain(
				'id="twine-rs-harlowe-debugger-bootstrap"'
			);
		} finally {
			Object.defineProperty(globalThis, 'DOMParser', {
				configurable: true,
				value: nativeDOMParser
			});
		}
	});

	it('preserves exact admission for selector-nonmatching role values', () => {
		const source = publishedHtmlWithStoryData(
			storyData(
				'<div role="SCRIPT">case decoy</div><span role=" script ">whitespace decoy</span>'
			)
		);
		const result = instrumentPreviewHtml(source, 'harlowe-role-decoys', {
			admission: exactAdmission()
		});

		expect(result.admission).toEqual(exactAdmission());
		expect(result.html).toContain('id="twine-rs-harlowe-debugger-bootstrap"');
	});

	it('discards all staged bytes when final structural validation fails', () => {
		const nativeDOMParser = globalThis.DOMParser;
		const source = publishedHtml();
		const sessionId = 'harlowe-forced-post-failure';
		class RejectFinalHarloweDOMParser {
			parseFromString(html: string, type: DOMParserSupportedType) {
				const parsed = new nativeDOMParser().parseFromString(html, type);

				if (
					html.includes('twine-rs-harlowe-debugger-bootstrap') &&
					html.includes('var SOURCE =')
				) {
					parsed
						.querySelector('#twine-rs-harlowe-debugger-bootstrap')
						?.remove();
				}
				return parsed;
			}
		}

		try {
			Object.defineProperty(globalThis, 'DOMParser', {
				configurable: true,
				value: RejectFinalHarloweDOMParser
			});
			const result = instrumentPreviewHtml(source, sessionId, {
				admission: exactAdmission(),
				enableHarloweSessionStorageFallback: true
			});
			Object.defineProperty(globalThis, 'DOMParser', {
				configurable: true,
				value: nativeDOMParser
			});
			const generic = instrumentPreviewHtml(source, sessionId, {
				admission: {kind: 'none'},
				enableHarloweSessionStorageFallback: true
			});

			expect(result.admission).toEqual({kind: 'none'});
			expect(result.html).toBe(generic.html);
			expect(result.html).not.toContain(
				'id="twine-rs-harlowe-debugger-bootstrap"'
			);
		} finally {
			Object.defineProperty(globalThis, 'DOMParser', {
				configurable: true,
				value: nativeDOMParser
			});
		}
	});

	it('attests the exact State surface once and captures event-driven passages', async () => {
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const frame = installExactHarloweBridge('harlowe-attested');
		const runtime = frame.contentWindow as Window & {
			eval(source: string): unknown;
			__harloweFixture: {
				State: object;
				VarRef: object;
				listeners: Record<string, Array<() => void>>;
				varRefListeners: Record<string, Array<() => void>>;
				setPassage(value: string): void;
				setVariable(value: number): void;
				setVariables(value: object): void;
				setNestedVariable(): void;
				deleteVariable(name: string): void;
				setTimeline(value: Array<{passage: string}>): void;
				setPastLength(value: number): void;
				emit(event: string): void;
			};
			__twineRsPreviewDebug: {captureState(): void};
			__twineRsPreviewHarloweBootstrap(state: object, varRef?: object): void;
		};

		try {
			runtime.eval(EXACT_STATE_FIXTURE_SOURCE);
			const storyChallengeListener = jest.fn();

			runtime.addEventListener('message', storyChallengeListener);
			const readinessConnection = issueHarloweBootstrapChallenge(
				frame,
				'harlowe-attested'
			);
			expect(storyChallengeListener).not.toHaveBeenCalled();
			const callbackDescriptor = Object.getOwnPropertyDescriptor(
				runtime,
				'__twineRsPreviewHarloweBootstrap'
			);

			expect(callbackDescriptor).toMatchObject({
				configurable: false,
				enumerable: false,
				writable: false
			});
			expect(
				runtime.eval(
					'Function.prototype.toString.call(window.__harloweFixture.VarRef.on)'
				)
			).toBe(HARLOWE_3_3_9_STATE_PROFILE.varRef.on.source);
			runtime.__twineRsPreviewHarloweBootstrap(
				runtime.__harloweFixture.State,
				runtime.__harloweFixture.VarRef
			);
			runtime.__twineRsPreviewHarloweBootstrap(
				runtime.__harloweFixture.State,
				runtime.__harloweFixture.VarRef
			);
			await waitForHarloweReadinessCount(readinessConnection, 1);
			expect(harloweReadinessMessages(readinessConnection)[0]).toMatchObject({
				bootstrapChallenge: HARLOWE_BOOTSTRAP_CHALLENGE
			});
			const loadedDocumentChallenge = 'd'.repeat(64);

			issueHarloweBootstrapChallenge(
				frame,
				'harlowe-attested',
				loadedDocumentChallenge
			);
			await waitForHarloweReadinessCount(readinessConnection, 2);
			expect(
				harloweReadinessMessages(readinessConnection).at(-1)
			).toMatchObject({
				bootstrapChallenge: loadedDocumentChallenge
			});
			issueHarloweBootstrapChallenge(
				frame,
				'harlowe-attested',
				loadedDocumentChallenge
			);
			await settleHarloweReadinessPort();
			expect(harloweReadinessMessages(readinessConnection)).toHaveLength(2);
			expect(runtime.__harloweFixture.listeners.forward).toHaveLength(1);
			expect(runtime.__harloweFixture.varRefListeners.set).toHaveLength(1);
			expect(runtime.__harloweFixture.varRefListeners.delete).toHaveLength(1);

			runtime.__twineRsPreviewDebug.captureState();
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'debugger-snapshot')
					.at(-1)
			).toMatchObject({
				adapterId: 'harlowe-3.3.9',
				currentPassage: {name: 'Start', source: 'Harlowe State'},
				sections: {
					currentPassage: {state: 'complete'},
					storyVariables: {state: 'complete'},
					visitedPassages: {state: 'complete'}
				},
				storyVariables: [{name: 'gold', preview: '1', type: 'number'}],
				visitedPassages: [{name: 'Start'}]
			});

			runtime.__harloweFixture.setVariable(2);
			await new Promise<void>(resolve => runtime.setTimeout(resolve, 75));
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'debugger-snapshot')
					.at(-1)
			).toMatchObject({storyVariables: [{name: 'gold', preview: '2'}]});
			runtime.__harloweFixture.setVariables({
				nested: {value: 1},
				removed: true
			});
			await new Promise<void>(resolve => runtime.setTimeout(resolve, 75));
			const beforeNestedMutation = postMessage.mock.calls.filter(
				([message]) => message?.type === 'debugger-snapshot'
			).length;

			runtime.__harloweFixture.setNestedVariable();
			await new Promise<void>(resolve => runtime.setTimeout(resolve, 75));
			expect(
				postMessage.mock.calls.filter(
					([message]) => message?.type === 'debugger-snapshot'
				).length
			).toBeGreaterThan(beforeNestedMutation);
			const beforeDelete = postMessage.mock.calls.filter(
				([message]) => message?.type === 'debugger-snapshot'
			).length;

			runtime.__harloweFixture.deleteVariable('removed');
			await new Promise<void>(resolve => runtime.setTimeout(resolve, 75));
			expect(
				postMessage.mock.calls.filter(
					([message]) => message?.type === 'debugger-snapshot'
				).length
			).toBeGreaterThan(beforeDelete);
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'debugger-snapshot')
					.at(-1)?.storyVariables
			).toEqual([{name: 'nested', preview: '[object]', type: 'object'}]);

			runtime.__harloweFixture.setTimeline([
				{passage: 'Start'},
				{passage: 'Next'},
				{passage: 'Redo'}
			]);
			runtime.__harloweFixture.setPastLength(1);
			runtime.__twineRsPreviewDebug.captureState();
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'debugger-snapshot')
					.at(-1)
			).toMatchObject({visitedPassages: [{name: 'Start'}, {name: 'Next'}]});
			runtime.__harloweFixture.setPastLength(0);
			runtime.__harloweFixture.emit('back');
			await new Promise<void>(resolve => runtime.setTimeout(resolve, 75));
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'debugger-snapshot')
					.at(-1)
			).toMatchObject({visitedPassages: [{name: 'Start'}]});
			runtime.__harloweFixture.setPastLength(1);
			runtime.__harloweFixture.emit('forward');
			await new Promise<void>(resolve => runtime.setTimeout(resolve, 75));
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'debugger-snapshot')
					.at(-1)
			).toMatchObject({visitedPassages: [{name: 'Start'}, {name: 'Next'}]});

			runtime.__harloweFixture.setTimeline([{passage: 'Next'}]);
			runtime.__harloweFixture.setPastLength(0);
			runtime.__harloweFixture.listeners.forgetUndos[0]();
			await new Promise<void>(resolve => runtime.setTimeout(resolve, 75));
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'debugger-snapshot')
					.at(-1)
			).toMatchObject({visitedPassages: [{name: 'Next'}]});

			runtime.__harloweFixture.emit('load');
			runtime.__harloweFixture.setVariables({loaded: true});
			runtime.__harloweFixture.setTimeline([{passage: 'Loaded'}]);
			runtime.__harloweFixture.setPastLength(0);
			await new Promise<void>(resolve => runtime.setTimeout(resolve, 275));
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'debugger-snapshot')
					.at(-1)
			).toMatchObject({
				storyVariables: [{name: 'loaded'}],
				visitedPassages: [{name: 'Loaded'}]
			});

			runtime.sessionStorage.setItem(
				'Saved Session',
				JSON.stringify([{passage: 'Start'}])
			);
			runtime.__harloweFixture.setPassage('Next');
			runtime.__harloweFixture.listeners.forward[0]();
			await new Promise<void>(resolve => runtime.setTimeout(resolve, 75));
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'state')
					.at(-1)
			).toMatchObject({
				currentPassage: {name: 'Next', source: 'Harlowe State'}
			});
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'debugger-snapshot')
					.at(-1)
			).toMatchObject({currentPassage: {name: 'Next'}});

			runtime.__harloweFixture.setPassage('Redirected');
			runtime.__harloweFixture.setTimeline([{passage: 'Redirected'}]);
			runtime.__harloweFixture.setPastLength(0);
			runtime.document.body.append(runtime.document.createElement('tw-hook'));
			await new Promise<void>(resolve => runtime.setTimeout(resolve, 75));
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'debugger-snapshot')
					.at(-1)
			).toMatchObject({
				currentPassage: {name: 'Redirected'},
				storyVariables: [{name: 'loaded'}],
				visitedPassages: [{name: 'Redirected'}]
			});
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'debugger-snapshot')
					.at(-1)?.visitedPassages
			).toHaveLength(1);
		} finally {
			frame.remove();
			postMessage.mockRestore();
		}
	});

	it('captures exact Harlowe state that settles after a sustained load burst', async () => {
		const sessionId = 'harlowe-late-load-settle';
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const frame = installExactHarloweBridge(sessionId);
		const runtime = frame.contentWindow as Window & {
			eval(source: string): unknown;
			__harloweFixture: {
				State: object;
				VarRef: object;
				emit(event: string): void;
				setPassage(value: string): void;
				setPastLength(value: number): void;
				setTimeline(value: Array<{passage: string}>): void;
			};
			__twineRsPreviewDebug: {captureState(): void};
			__twineRsPreviewHarloweBootstrap(state: object, varRef?: object): void;
		};
		const snapshots = () =>
			postMessage.mock.calls
				.map(([message]) => message)
				.filter(
					message =>
						message?.type === 'debugger-snapshot' &&
						message.sessionId === sessionId
				);

		try {
			runtime.eval(EXACT_STATE_FIXTURE_SOURCE);
			const readinessConnection = issueHarloweBootstrapChallenge(
				frame,
				sessionId
			);

			runtime.__twineRsPreviewHarloweBootstrap(
				runtime.__harloweFixture.State,
				runtime.__harloweFixture.VarRef
			);
			await waitForHarloweReadinessCount(readinessConnection, 1);
			runtime.__harloweFixture.setPassage('Before late settle');
			runtime.__harloweFixture.setTimeline([{passage: 'Before late settle'}]);
			runtime.__harloweFixture.setPastLength(0);
			runtime.__twineRsPreviewDebug.captureState();

			for (let index = 0; index < 7; index += 1) {
				runtime.__harloweFixture.emit('load');
				if (index < 6) {
					await new Promise<void>(resolve => runtime.setTimeout(resolve, 40));
				}
			}
			await new Promise<void>(resolve => runtime.setTimeout(resolve, 75));
			runtime.__harloweFixture.setPassage('Late settled');
			runtime.__harloweFixture.setTimeline([{passage: 'Late settled'}]);
			runtime.__harloweFixture.setPastLength(0);
			expect(snapshots().at(-1)).toMatchObject({
				currentPassage: {name: 'Before late settle'}
			});

			await new Promise<void>(resolve => runtime.setTimeout(resolve, 200));
			expect(snapshots().at(-1)).toMatchObject({
				currentPassage: {name: 'Late settled'},
				visitedPassages: [{name: 'Late settled'}]
			});
		} finally {
			frame.remove();
			postMessage.mockRestore();
		}
	});

	it('publishes exact passage identity before pending timers and preserves the last valid host identity', async () => {
		const sessionId = 'harlowe-immediate-passage';
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const frame = installExactHarloweBridge(sessionId);
		const runtime = frame.contentWindow as Window & {
			eval(source: string): unknown;
			__harloweFixture: {
				State: object;
				VarRef: object;
				emit(event: string): void;
				failPassageRead(): void;
				setPassage(value: string): void;
				setVariable(value: number): void;
			};
			__twineRsPreviewDebug: {captureState(): void};
			__twineRsPreviewHarloweBootstrap(state: object, varRef: object): void;
		};
		const messages = (type: string) =>
			postMessage.mock.calls
				.map(([message]) => message)
				.filter(
					message => message?.type === type && message.sessionId === sessionId
				);

		try {
			runtime.eval(EXACT_STATE_FIXTURE_SOURCE);
			const snapshotsBeforeBootstrap = messages('debugger-snapshot').length;

			runtime.__twineRsPreviewHarloweBootstrap(
				runtime.__harloweFixture.State,
				runtime.__harloweFixture.VarRef
			);
			expect(messages('state').at(-1)).toMatchObject({
				currentPassage: {name: 'Start', source: 'Harlowe State'}
			});
			expect(messages('debugger-snapshot')).toHaveLength(
				snapshotsBeforeBootstrap
			);

			runtime.sessionStorage.setItem(
				'Saved Session',
				JSON.stringify([{passage: 'Start'}])
			);
			runtime.__harloweFixture.setVariable(2);
			runtime.document.body.click();
			const snapshotsBeforeForward = messages('debugger-snapshot').length;

			runtime.__harloweFixture.setPassage('Next');
			runtime.__harloweFixture.emit('forward');
			expect(messages('state').at(-1)).toMatchObject({
				currentPassage: {name: 'Next', source: 'Harlowe State'}
			});
			const nextStatesAfterForward = messages('state').filter(
				message => message.currentPassage?.name === 'Next'
			).length;

			runtime.document.body.append(runtime.document.createElement('tw-hook'));
			await Promise.resolve();
			expect(
				messages('state').filter(
					message => message.currentPassage?.name === 'Next'
				)
			).toHaveLength(nextStatesAfterForward + 1);
			runtime.document.body.append(runtime.document.createElement('tw-hook'));
			await Promise.resolve();
			expect(
				messages('state').filter(
					message => message.currentPassage?.name === 'Next'
				)
			).toHaveLength(nextStatesAfterForward + 1);
			expect(messages('debugger-snapshot')).toHaveLength(
				snapshotsBeforeForward
			);

			runtime.__harloweFixture.failPassageRead();
			runtime.__twineRsPreviewDebug.captureState();
			expect(messages('state').at(-1)).toMatchObject({
				currentPassage: {name: 'Next', source: 'Harlowe State'}
			});
			expect(messages('debugger-snapshot').at(-1)).toMatchObject({
				sections: {currentPassage: {state: 'unavailable'}}
			});
			expect(messages('debugger-snapshot').at(-1)).not.toHaveProperty(
				'currentPassage'
			);
		} finally {
			frame.remove();
			postMessage.mockRestore();
		}
	});

	it('republishes exact passage identity from a DOM mutation without waiting for a timer', async () => {
		const sessionId = 'harlowe-mutation-passage';
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const frame = installExactHarloweBridge(sessionId);
		const runtime = frame.contentWindow as Window & {
			eval(source: string): unknown;
			__harloweFixture: {
				State: object;
				VarRef: object;
				setPassage(value: string): void;
			};
			__twineRsPreviewHarloweBootstrap(state: object, varRef: object): void;
		};
		const messages = (type: string) =>
			postMessage.mock.calls
				.map(([message]) => message)
				.filter(
					message => message?.type === type && message.sessionId === sessionId
				);

		try {
			runtime.eval(EXACT_STATE_FIXTURE_SOURCE);
			runtime.__twineRsPreviewHarloweBootstrap(
				runtime.__harloweFixture.State,
				runtime.__harloweFixture.VarRef
			);
			runtime.sessionStorage.setItem(
				'Saved Session',
				JSON.stringify([{passage: 'Start'}])
			);
			const snapshotsBeforeMutation = messages('debugger-snapshot').length;

			runtime.__harloweFixture.setPassage('Next');
			runtime.document.body.append(runtime.document.createElement('tw-hook'));
			await Promise.resolve();

			expect(messages('state').at(-1)).toMatchObject({
				currentPassage: {name: 'Next', source: 'Harlowe State'}
			});
			expect(messages('debugger-snapshot')).toHaveLength(
				snapshotsBeforeMutation
			);
		} finally {
			frame.remove();
			postMessage.mockRestore();
		}
	});

	it('defers load passage publication until Harlowe assigns the restored passage', async () => {
		const sessionId = 'harlowe-deferred-load-passage';
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const frame = installExactHarloweBridge(sessionId);
		const runtime = frame.contentWindow as Window & {
			eval(source: string): unknown;
			__harloweFixture: {
				State: object;
				VarRef: object;
				emit(event: string): void;
				setPassage(value: string): void;
			};
			__twineRsPreviewHarloweBootstrap(state: object, varRef: object): void;
		};
		const messages = (type: string) =>
			postMessage.mock.calls
				.map(([message]) => message)
				.filter(
					message => message?.type === type && message.sessionId === sessionId
				);

		try {
			runtime.eval(EXACT_STATE_FIXTURE_SOURCE);
			runtime.__twineRsPreviewHarloweBootstrap(
				runtime.__harloweFixture.State,
				runtime.__harloweFixture.VarRef
			);
			expect(messages('state').at(-1)).toMatchObject({
				currentPassage: {name: 'Start', source: 'Harlowe State'}
			});
			const stateCountBeforeLoad = messages('state').length;

			runtime.__harloweFixture.emit('load');
			expect(messages('state')).toHaveLength(stateCountBeforeLoad);

			runtime.__harloweFixture.setPassage('Loaded');
			await new Promise<void>(resolve => runtime.setTimeout(resolve, 75));
			expect(messages('state').at(-1)).toMatchObject({
				currentPassage: {name: 'Loaded', source: 'Harlowe State'}
			});
			expect(messages('debugger-snapshot').at(-1)).toMatchObject({
				currentPassage: {name: 'Loaded', source: 'Harlowe State'}
			});
		} finally {
			frame.remove();
			postMessage.mockRestore();
		}
	});

	it('consumes the callback when the inert bootstrap cannot require State', async () => {
		const result = instrumentPreviewHtml(
			publishedHtml(),
			'harlowe-require-failure',
			{
				admission: exactAdmission(),
				enableHarloweSessionStorageFallback: true
			}
		);
		const bootstrapSource = new DOMParser()
			.parseFromString(result.html, 'text/html')
			.querySelector<HTMLScriptElement>(
				'#twine-rs-harlowe-debugger-bootstrap'
			)?.textContent;
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const frame = installExactHarloweBridge('harlowe-require-failure');
		const runtime = frame.contentWindow as Window & {
			eval(source: string): unknown;
			require(moduleName: string): unknown;
			__harloweFixture: {State: object};
			__twineRsPreviewHarloweBootstrap(state: object): void;
		};

		try {
			expect(bootstrapSource).toBeDefined();
			const readinessConnection = issueHarloweBootstrapChallenge(
				frame,
				'harlowe-require-failure'
			);
			runtime.require = () => {
				throw new Error('module unavailable');
			};
			runtime.eval(bootstrapSource!);
			runtime.eval(EXACT_STATE_FIXTURE_SOURCE);
			runtime.__twineRsPreviewHarloweBootstrap(runtime.__harloweFixture.State);
			await settleHarloweReadinessPort();
			expect(harloweReadinessMessages(readinessConnection)).toHaveLength(0);
		} finally {
			frame.remove();
			postMessage.mockRestore();
		}
	});

	it('keeps State readiness and history when VarRef attestation drifts', () => {
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const frame = installExactHarloweBridge('harlowe-varref-drift');
		const runtime = frame.contentWindow as Window & {
			eval(source: string): unknown;
			__harloweFixture: {State: object; VarRef: object};
			__twineRsPreviewDebug: {captureState(): void};
			__twineRsPreviewHarloweBootstrap(state: object, varRef: object): void;
		};

		try {
			runtime.eval(
				EXACT_STATE_FIXTURE_SOURCE.replace(
					'n("VarRef.on","invalid event name")',
					'n("VarRef.on","drifted")'
				)
			);
			runtime.__twineRsPreviewHarloweBootstrap(
				runtime.__harloweFixture.State,
				runtime.__harloweFixture.VarRef
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'debugger-snapshot')
					.at(-1)
			).toMatchObject({
				currentPassage: {name: 'Start'},
				sections: {
					storyVariables: {state: 'unavailable'},
					visitedPassages: {state: 'complete'}
				},
				visitedPassages: [{name: 'Start'}]
			});
		} finally {
			frame.remove();
			postMessage.mockRestore();
		}
	});

	it.each([
		[
			'variables',
			'get variables(){return i.variables}',
			'get variables(){return i.driftedVariables}',
			{
				sections: {
					storyVariables: {state: 'unavailable'},
					visitedPassages: {state: 'complete'}
				},
				visitedPassages: [{name: 'Start'}]
			}
		],
		[
			'timeline',
			'get timeline(){return u}',
			'get timeline(){return i.driftedTimeline}',
			{
				sections: {
					storyVariables: {state: 'complete'},
					visitedPassages: {state: 'unavailable'}
				},
				storyVariables: [{name: 'gold'}]
			}
		],
		[
			'pastLength',
			'get pastLength(){return p}',
			'get pastLength(){return p+0}',
			{
				sections: {
					storyVariables: {state: 'complete'},
					visitedPassages: {state: 'unavailable'}
				},
				storyVariables: [{name: 'gold'}]
			}
		]
	] as const)(
		'isolates %s getter drift from State readiness and sibling capabilities',
		(_label, exactSource, driftedSource, expected) => {
			const postMessage = jest
				.spyOn(window, 'postMessage')
				.mockImplementation(() => undefined);
			const frame = installExactHarloweBridge(`harlowe-${_label}-drift`);
			const runtime = frame.contentWindow as Window & {
				eval(source: string): unknown;
				__harloweFixture: {State: object; VarRef: object};
				__twineRsPreviewDebug: {captureState(): void};
				__twineRsPreviewHarloweBootstrap(state: object, varRef: object): void;
			};

			try {
				runtime.eval(
					EXACT_STATE_FIXTURE_SOURCE.replace(exactSource, driftedSource)
				);
				runtime.__twineRsPreviewHarloweBootstrap(
					runtime.__harloweFixture.State,
					runtime.__harloweFixture.VarRef
				);
				runtime.__twineRsPreviewDebug.captureState();
				expect(
					postMessage.mock.calls
						.map(([message]) => message)
						.filter(message => message?.type === 'debugger-snapshot')
						.at(-1)
				).toMatchObject({
					currentPassage: {name: 'Start'},
					...expected,
					sections: {
						currentPassage: {state: 'complete'},
						...expected.sections
					}
				});
			} finally {
				frame.remove();
				postMessage.mockRestore();
			}
		}
	);

	it('bounds Harlowe variable and timeline snapshots and recovers after hostile data', () => {
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const frame = installExactHarloweBridge('harlowe-bounds');
		const runtime = frame.contentWindow as Window & {
			eval(source: string): unknown;
			__harloweFixture: {State: object; VarRef: object};
			__twineRsPreviewDebug: {captureState(): void};
			__twineRsPreviewHarloweBootstrap(state: object, varRef: object): void;
		};
		const snapshot = () =>
			postMessage.mock.calls
				.map(([message]) => message)
				.filter(message => message?.type === 'debugger-snapshot')
				.at(-1);

		try {
			runtime.eval(EXACT_STATE_FIXTURE_SOURCE);
			runtime.__twineRsPreviewHarloweBootstrap(
				runtime.__harloweFixture.State,
				runtime.__harloweFixture.VarRef
			);

			runtime.eval(
				'window.__harloweFixture.setVariables(Object.assign(Object.create({inherited:1}),{own:1,TwineScript_ObjectName:"metadata"}));'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({storyVariables: [{name: 'own'}]});
			runtime.eval(
				'var accessor={safe:1};Object.defineProperty(accessor,"blocked",{enumerable:true,get:function(){throw new Error("read")}});window.__harloweFixture.setVariables(accessor);'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				storyVariables: [{name: 'safe'}],
				sections: {
					storyVariables: {state: 'truncated', reasons: ['uninspectable']}
				}
			});
			runtime.eval(
				'window.__harloweFixture.setVariables(new Proxy({},{ownKeys:function(){throw new Error("blocked")}}));'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				currentPassage: {name: 'Start'},
				sections: {storyVariables: {state: 'unavailable'}}
			});
			runtime.eval(
				'var budget={};for(var index=0;index<100;index+=1)budget["b"+index]="x".repeat(200);window.__harloweFixture.setVariables(budget);'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				sections: {
					storyVariables: {state: 'truncated', reasons: ['text-budget']}
				}
			});

			runtime.eval(
				'var many={};for(var index=0;index<101;index+=1)many["v"+index]=index;window.__harloweFixture.setVariables(many);'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				sections: {
					storyVariables: {state: 'truncated', reasons: ['item-limit']}
				}
			});
			runtime.eval(
				'var huge={};for(var index=0;index<10000;index+=1)huge["h"+index]=index;var descriptorReads=0;window.__harloweDescriptorReads=function(){return descriptorReads};window.__harloweFixture.setVariables(new Proxy(huge,{getOwnPropertyDescriptor:function(target,key){descriptorReads+=1;return Object.getOwnPropertyDescriptor(target,key)}}));'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				sections: {
					storyVariables: {state: 'truncated', reasons: ['item-limit']}
				}
			});
			expect(runtime.eval('window.__harloweDescriptorReads()')).toBe(100);
			runtime.eval(
				'var prototypeOwnKeys=0;var hostilePrototype=new Proxy({inherited:1},{ownKeys:function(){prototypeOwnKeys+=1;throw new Error("prototype traversed")}});var inheritedDescriptorReads=0;var inheritedRoot=Object.create(hostilePrototype);inheritedRoot.own=1;Object.preventExtensions(inheritedRoot);window.__harloweInheritedRootExtensible=function(){return Object.isExtensible(inheritedRoot)};window.__harlowePrototypeOwnKeys=function(){return prototypeOwnKeys};window.__harloweInheritedDescriptorReads=function(){return inheritedDescriptorReads};window.__harloweFixture.setVariables(new Proxy(inheritedRoot,{getOwnPropertyDescriptor:function(target,key){inheritedDescriptorReads+=1;return Object.getOwnPropertyDescriptor(target,key)}}));'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				storyVariables: [{name: 'own'}],
				sections: {storyVariables: {state: 'complete'}}
			});
			expect(runtime.eval('window.__harloweInheritedDescriptorReads()')).toBe(
				1
			);
			expect(runtime.eval('window.__harloweInheritedRootExtensible()')).toBe(
				false
			);
			expect(runtime.eval('window.__harlowePrototypeOwnKeys()')).toBe(0);
			runtime.eval(
				'var metadataStorm={};for(var index=0;index<10000;index+=1)metadataStorm["TwineScript_"+index]=index;metadataStorm.normal=1;var metadataDescriptorReads=0;var metadataOwnKeysCalls=0;window.__harloweMetadataDescriptorReads=function(){return metadataDescriptorReads};window.__harloweMetadataOwnKeysCalls=function(){return metadataOwnKeysCalls};window.__harloweFixture.setVariables(new Proxy(metadataStorm,{ownKeys:function(target){metadataOwnKeysCalls+=1;return Reflect.ownKeys(target)},getOwnPropertyDescriptor:function(target,key){metadataDescriptorReads+=1;return Object.getOwnPropertyDescriptor(target,key)}}));'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				sections: {
					storyVariables: {state: 'truncated', reasons: ['item-limit']}
				},
				storyVariables: []
			});
			expect(runtime.eval('window.__harloweMetadataDescriptorReads()')).toBe(
				100
			);
			expect(runtime.eval('window.__harloweMetadataOwnKeysCalls()')).toBe(1);
			runtime.eval(
				'window.__harloweFixture.setTimeline(new Array(1));window.__harloweFixture.setPastLength(0);'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				sections: {visitedPassages: {state: 'unavailable'}}
			});
			runtime.eval(
				'window.__harloweFixture.setTimeline([{passage:"Valid"}]);window.__harloweFixture.setPastLength(9);'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				sections: {visitedPassages: {state: 'unavailable'}}
			});
			runtime.eval(
				'window.__harloweFixture.setTimeline(new Proxy([],{getOwnPropertyDescriptor:function(){throw new Error("blocked")}}));window.__harloweFixture.setPastLength(0);'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				currentPassage: {name: 'Start'},
				sections: {visitedPassages: {state: 'unavailable'}}
			});
			runtime.eval(
				'var timelineIndexGetterCalls=0;var indexAccessor=[];Object.defineProperty(indexAccessor,"0",{enumerable:true,get:function(){timelineIndexGetterCalls+=1;return {passage:"blocked"}}});window.__harloweTimelineIndexGetterCalls=function(){return timelineIndexGetterCalls};window.__harloweFixture.setTimeline(indexAccessor);window.__harloweFixture.setPastLength(0);'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				sections: {visitedPassages: {state: 'unavailable'}}
			});
			expect(runtime.eval('window.__harloweTimelineIndexGetterCalls()')).toBe(
				0
			);
			runtime.eval(
				'var timelineIndexDescriptorReads=0;window.__harloweTimelineIndexDescriptorReads=function(){return timelineIndexDescriptorReads};window.__harloweFixture.setTimeline(new Proxy([{passage:"blocked"}],{getOwnPropertyDescriptor:function(target,key){if(key==="0"){timelineIndexDescriptorReads+=1;throw new Error("blocked index")};return Object.getOwnPropertyDescriptor(target,key)}}));window.__harloweFixture.setPastLength(0);'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				sections: {visitedPassages: {state: 'unavailable'}}
			});
			expect(
				runtime.eval('window.__harloweTimelineIndexDescriptorReads()')
			).toBe(1);
			runtime.eval(
				'var passageGetterCalls=0;var accessorMoment={};Object.defineProperty(accessorMoment,"passage",{enumerable:true,get:function(){passageGetterCalls+=1;return "blocked"}});window.__harlowePassageGetterCalls=function(){return passageGetterCalls};window.__harloweFixture.setTimeline([accessorMoment]);window.__harloweFixture.setPastLength(0);'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				sections: {visitedPassages: {state: 'unavailable'}}
			});
			expect(runtime.eval('window.__harlowePassageGetterCalls()')).toBe(0);
			runtime.eval(
				'var passageDescriptorReads=0;window.__harlowePassageDescriptorReads=function(){return passageDescriptorReads};var hostileMoment=new Proxy({passage:"blocked"},{getOwnPropertyDescriptor:function(target,key){if(key==="passage"){passageDescriptorReads+=1;throw new Error("blocked passage")};return Object.getOwnPropertyDescriptor(target,key)}});window.__harloweFixture.setTimeline([hostileMoment]);window.__harloweFixture.setPastLength(0);'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				sections: {visitedPassages: {state: 'unavailable'}}
			});
			expect(runtime.eval('window.__harlowePassageDescriptorReads()')).toBe(1);

			runtime.eval(
				'var moments=[];for(var index=0;index<201;index+=1)moments.push({passage:"P"+index});window.__harloweFixture.setTimeline(moments);window.__harloweFixture.setPastLength(200);'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				sections: {
					visitedPassages: {state: 'truncated', reasons: ['item-limit']}
				}
			});
			expect(snapshot()?.visitedPassages).toHaveLength(200);
			expect(snapshot()?.visitedPassages?.[0]).toMatchObject({name: 'P1'});

			runtime.eval(
				'window.__harloweFixture.setTimeline([{passage:"x".repeat(2048)}]);window.__harloweFixture.setPastLength(0);'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				sections: {
					visitedPassages: {state: 'truncated', reasons: ['field-limit']}
				}
			});
			runtime.eval(
				'var textMoments=[];for(var index=0;index<20;index+=1)textMoments.push({passage:"P"+index+"x".repeat(1000)});window.__harloweFixture.setTimeline(textMoments);window.__harloweFixture.setPastLength(19);'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				sections: {
					visitedPassages: {state: 'truncated', reasons: ['text-budget']}
				}
			});

			runtime.eval(
				'window.__harloweFixture.setTimeline([{passage:"Recovered"}]);window.__harloweFixture.setPastLength(0);window.__harloweFixture.setVariables({ok:true});'
			);
			runtime.__twineRsPreviewDebug.captureState();
			expect(snapshot()).toMatchObject({
				sections: {
					storyVariables: {state: 'complete'},
					visitedPassages: {state: 'complete'}
				},
				storyVariables: [{name: 'ok'}],
				visitedPassages: [{name: 'Recovered'}]
			});
		} finally {
			frame.remove();
			postMessage.mockRestore();
		}
	});

	it('treats empty startup passage as ready and captures the first forward passage', async () => {
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const frame = installExactHarloweBridge('harlowe-empty-startup');
		const runtime = frame.contentWindow as Window & {
			eval(source: string): unknown;
			__harloweFixture: {
				State: object;
				VarRef: object;
				listeners: Record<string, Array<() => void>>;
				setPassage(value: string): void;
				setTimeline(value: Array<{passage: string}>): void;
				setPastLength(value: number): void;
			};
			__twineRsPreviewDebug: {captureState(): void};
			__twineRsPreviewHarloweBootstrap(state: object, varRef: object): void;
		};

		try {
			runtime.eval(
				EXACT_STATE_FIXTURE_SOURCE.replace(
					'var d={passage:"Start"};',
					'var d={passage:""};'
				)
					.replace('var u=[{passage:"Start"}];', 'var u=[];')
					.replace('var p=0;', 'var p=-1;')
			);
			runtime.__twineRsPreviewHarloweBootstrap(
				runtime.__harloweFixture.State,
				runtime.__harloweFixture.VarRef
			);
			const readinessConnection = issueHarloweBootstrapChallenge(
				frame,
				'harlowe-empty-startup'
			);
			await waitForHarloweReadinessCount(readinessConnection, 1);
			runtime.__twineRsPreviewDebug.captureState();
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'debugger-snapshot')
					.at(-1)
			).toMatchObject({
				sections: {
					currentPassage: {state: 'unavailable'},
					storyVariables: {state: 'complete'},
					visitedPassages: {state: 'unavailable'}
				},
				storyVariables: [{name: 'gold'}]
			});

			runtime.__harloweFixture.setPassage('Start');
			runtime.__harloweFixture.setTimeline([{passage: 'Start'}]);
			runtime.__harloweFixture.setPastLength(0);
			runtime.__harloweFixture.listeners.forward[0]();
			await new Promise<void>(resolve => runtime.setTimeout(resolve, 75));
			expect(
				postMessage.mock.calls
					.map(([message]) => message)
					.filter(message => message?.type === 'debugger-snapshot')
					.at(-1)
			).toMatchObject({
				currentPassage: {name: 'Start'},
				sections: {
					currentPassage: {state: 'complete'},
					storyVariables: {state: 'complete'},
					visitedPassages: {state: 'complete'}
				},
				storyVariables: [{name: 'gold'}],
				visitedPassages: [{name: 'Start'}]
			});
		} finally {
			frame.remove();
			postMessage.mockRestore();
		}
	});

	it.each([
		[
			'unfrozen State',
			EXACT_STATE_FIXTURE_SOURCE.replace(
				'var State=Object.freeze({',
				'var State=({'
			)
		],
		[
			'altered passage getter',
			EXACT_STATE_FIXTURE_SOURCE.replace(
				'get passage(){return d.passage}',
				'get passage(){return d.other}'
			)
		],
		[
			'altered State.on source',
			EXACT_STATE_FIXTURE_SOURCE.replace(
				'y.impossible("State.on","invalid event name")',
				'y.impossible("State.on","changed")'
			)
		],
		[
			'accessor-backed State.on',
			EXACT_STATE_FIXTURE_SOURCE.replace(
				'on:function(e,t){if(e in l)return"function"!=typeof t||l[e].includes(t)||l[e].push(t),a;y.impossible("State.on","invalid event name")}',
				'get on(){return function(e,t){if(e in l)return"function"!=typeof t||l[e].includes(t)||l[e].push(t),a;y.impossible("State.on","invalid event name")}}'
			)
		],
		[
			'wrong passage descriptor flags',
			EXACT_STATE_FIXTURE_SOURCE.replace(
				EXACT_STATE_DEFINITION,
				`var State=${EXACT_STATE_OBJECT_SOURCE};var passageGetter=Object.getOwnPropertyDescriptor(State,"passage").get;Object.defineProperty(State,"passage",{configurable:false,enumerable:false,get:passageGetter});Object.freeze(State);`
			)
		],
		[
			'non-enumerable State.on',
			EXACT_STATE_FIXTURE_SOURCE.replace(
				EXACT_STATE_DEFINITION,
				`var State=${EXACT_STATE_OBJECT_SOURCE};var stateOn=State.on;Object.defineProperty(State,"on",{configurable:true,enumerable:false,value:stateOn,writable:true});Object.freeze(State);`
			)
		],
		[
			'configurable State.on',
			EXACT_STATE_FIXTURE_SOURCE.replace(
				EXACT_STATE_DEFINITION,
				`var State=${EXACT_STATE_OBJECT_SOURCE};var stateOn=State.on;Object.defineProperty(State,"on",{configurable:true,enumerable:true,value:stateOn,writable:false});`
			)
		],
		[
			'writable State.on',
			EXACT_STATE_FIXTURE_SOURCE.replace(
				EXACT_STATE_DEFINITION,
				`var State=${EXACT_STATE_OBJECT_SOURCE};var stateOn=State.on;Object.defineProperty(State,"on",{configurable:false,enumerable:true,value:stateOn,writable:true});`
			)
		],
		[
			'hostile State proxy',
			EXACT_STATE_FIXTURE_SOURCE.replace(
				EXACT_STATE_DEFINITION,
				`var target=Object.freeze(${EXACT_STATE_OBJECT_SOURCE});var State=new Proxy(target,{getOwnPropertyDescriptor:function(){throw new Error("blocked")}});`
			)
		],
		[
			'listener registration failure',
			EXACT_STATE_FIXTURE_SOURCE.replace(
				'var l={forward:[],back:[],load:[],forgetUndos:[]};',
				'var l={back:[],load:[]};Object.defineProperty(l,"forward",{get:function(){throw new Error("blocked")}});'
			)
		]
	] as const)(
		'fails closed for %s and consumes callback replay',
		async (_label, stateSource) => {
			const postMessage = jest
				.spyOn(window, 'postMessage')
				.mockImplementation(() => undefined);
			const frame = installExactHarloweBridge(`harlowe-refused-${_label}`);
			const runtime = frame.contentWindow as Window & {
				eval(source: string): unknown;
				__harloweFixture: {State: object};
				__twineRsPreviewHarloweBootstrap(state: object): void;
			};

			try {
				const readinessConnection = issueHarloweBootstrapChallenge(
					frame,
					`harlowe-refused-${_label}`
				);
				runtime.eval(stateSource);
				runtime.__twineRsPreviewHarloweBootstrap(
					runtime.__harloweFixture.State
				);
				runtime.eval(EXACT_STATE_FIXTURE_SOURCE);
				runtime.__twineRsPreviewHarloweBootstrap(
					runtime.__harloweFixture.State
				);
				await settleHarloweReadinessPort();
				expect(harloweReadinessMessages(readinessConnection)).toHaveLength(0);
			} finally {
				frame.remove();
				postMessage.mockRestore();
			}
		}
	);

	it('discards exact staging when another role script is present', () => {
		const properties = loadBundledHarloweProperties();
		const html = properties.source
			.replace(/{{STORY_NAME}}/g, 'Probe')
			.replace(
				/{{STORY_DATA}}/g,
				storyData(
					'<script role="script" id="another" type="text/twine-javascript">window.other = true;</script>'
				)
			);
		const result = instrumentPreviewHtml(html, 'harlowe-refused', {
			admission: exactAdmission(),
			enableHarloweSessionStorageFallback: true
		});

		expect(result.admission).toEqual({kind: 'none'});
		expect(result.html).not.toContain(
			'id="twine-rs-harlowe-debugger-bootstrap"'
		);
		expect(result.html).toContain('id="another"');
		expect(result.html).toContain('var FIXED_READ_ADAPTER = undefined');
	});
});
