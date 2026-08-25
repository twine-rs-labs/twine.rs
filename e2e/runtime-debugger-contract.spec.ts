import {expect, Frame, Page, test} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {
	instrumentPreviewHtml,
	normalizeStoryPreviewBridgeMessage,
	STORY_PREVIEW_BRIDGE_LIMITS,
	type StoryPreviewBridgeMessage
} from '../src/routes/story-preview-contract';
import type {StoryPreviewDebuggerCapability} from '../src/routes/story-preview-debugger-protocol';
import {
	NO_PREVIEW_FORMAT_ADMISSION,
	type PreviewFormatAdmission
} from '../src/routes/story-preview-format';
import {HARLOWE_3_3_9_COMPATIBILITY} from '../src/routes/story-preview-harlowe';
import {SUGARCUBE_COMPATIBILITY} from '../src/routes/story-preview-sugarcube';

const appUrl = 'http://127.0.0.1:5173';

const CROSS_BROWSER_SUGARCUBE_VERSIONS = new Set([
	'2.31.0',
	'2.32.0',
	'2.33.1',
	'2.35.0',
	'2.36.0',
	'2.37.3'
]);

function admissionForFormat(
	format: string,
	formatVersion: string
): PreviewFormatAdmission {
	const entry = SUGARCUBE_COMPATIBILITY.find(
		candidate => format === 'SugarCube' && candidate.version === formatVersion
	);

	if (entry) {
		return {
			adapterId: entry.adapterId,
			format: 'SugarCube',
			kind: 'builtin-sha256',
			sourceSha256: entry.sourceSha256,
			version: entry.version
		};
	}
	if (
		format === 'Harlowe' &&
		formatVersion === HARLOWE_3_3_9_COMPATIBILITY.version
	) {
		return {
			adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
			format: 'Harlowe',
			kind: 'builtin-sha256',
			sourceSha256: HARLOWE_3_3_9_COMPATIBILITY.sourceSha256,
			version: HARLOWE_3_3_9_COMPATIBILITY.version
		};
	}

	return NO_PREVIEW_FORMAT_ADMISSION;
}

function formatSource(id: string) {
	const raw = readFileSync(
		path.join(process.cwd(), 'public', 'story-formats', id, 'format.js'),
		'utf8'
	);
	let properties: {source?: unknown} | undefined;

	new Function('window', raw)({
		storyFormat(value: {source?: unknown}) {
			properties = value;
		}
	});

	if (typeof properties?.source !== 'string') {
		throw new Error(`Bundled story format ${id} has no source.`);
	}

	return properties.source;
}

function escapePassageText(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function publishedStory(
	formatId: string,
	format: string,
	formatVersion: string,
	passageText = 'Ready',
	extraBeforeAuthor = ''
) {
	const name = `Runtime Debugger ${formatId}`;
	const authorScript =
		format === 'Harlowe'
			? 'var debuggerState=require("state"),debuggerSection=require("section").create();debuggerSection.stack=[{tempVariables:Object.create(require("internaltypes/varscope"))}];window.__runtimeDebuggerHarloweDeserialise=function(source){return debuggerState.deserialise(debuggerSection,source);};'
			: '';
	const storyData = [
		`<tw-storydata name="${name}" startnode="1" creator="twine.rs"`,
		` creator-version="0.2.0" format="${format}"`,
		` format-version="${formatVersion}"`,
		' ifid="11111111-2222-4333-8444-555555555555"',
		' options="" tags="" zoom="1" hidden>',
		'<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css"></style>',
		extraBeforeAuthor,
		`<script role="script" id="twine-user-script" type="text/twine-javascript">${authorScript}</script>`,
		'<tw-passagedata pid="1" name="Start" tags="" position="0,0" size="100,100">',
		escapePassageText(passageText),
		'</tw-passagedata></tw-storydata>'
	].join('');

	return formatSource(formatId)
		.replace(/{{STORY_NAME}}/g, name)
		.replace(/{{STORY_DATA}}/g, storyData);
}

async function messages(page: Page) {
	return page.evaluate(
		() =>
			(
				window as typeof window & {
					__runtimeDebuggerMessages: StoryPreviewBridgeMessage[];
				}
			).__runtimeDebuggerMessages
	);
}

async function mountStory(
	page: Page,
	{
		format,
		formatId,
		formatVersion,
		passageText,
		sessionId
	}: {
		format: string;
		formatId: string;
		formatVersion: string;
		passageText?: string;
		sessionId: string;
	}
): Promise<Frame> {
	const originalDOMParser = globalThis.DOMParser;
	Object.defineProperty(globalThis, 'DOMParser', {
		configurable: true,
		value: new JSDOM('').window.DOMParser
	});
	let html: string;

	try {
		html = instrumentPreviewHtml(
			publishedStory(formatId, format, formatVersion, passageText),
			sessionId,
			{
				admission: admissionForFormat(format, formatVersion),
				enableHarloweSessionStorageFallback: true
			}
		).html;
	} finally {
		if (originalDOMParser) {
			Object.defineProperty(globalThis, 'DOMParser', {
				configurable: true,
				value: originalDOMParser
			});
		} else {
			delete (globalThis as {DOMParser?: typeof DOMParser}).DOMParser;
		}
	}

	await page.goto(appUrl);
	await page.evaluate(() => {
		localStorage.clear();
		sessionStorage.clear();
	});
	await page.setContent('<iframe id="runtime-debugger-story"></iframe>');
	await page.evaluate(() => {
		const target = window as typeof window & {
			__runtimeDebuggerChannels: MessagePort[];
			__runtimeDebuggerMessages: StoryPreviewBridgeMessage[];
		};
		const nativePostMessage = window.postMessage;
		const nativeReflectApply = Reflect.apply;
		target.__runtimeDebuggerChannels = [];
		target.__runtimeDebuggerMessages = [];
		window.addEventListener('message', event => {
			target.__runtimeDebuggerMessages.push(event.data);
			if (
				event.data?.source === 'twine.rs.preview.bridge' &&
				event.data?.type === 'debugger-bootstrap-arm' &&
				event.source
			) {
				const bytes = new Uint8Array(32);

				crypto.getRandomValues(bytes);
				const bootstrapChallenge = Array.from(bytes, value =>
					value.toString(16).padStart(2, '0')
				).join('');
				const channel = new MessageChannel();

				target.__runtimeDebuggerChannels.push(channel.port1);
				channel.port1.addEventListener('message', portEvent => {
					target.__runtimeDebuggerMessages.push(portEvent.data);
				});
				channel.port1.start();
				nativeReflectApply(nativePostMessage, event.source, [
					{
						adapterId: event.data.adapterId,
						protocolVersion: event.data.protocolVersion,
						sessionId: event.data.sessionId,
						source: 'twine.rs.preview.host-command',
						type: 'debugger-bootstrap-port'
					},
					'*',
					[channel.port2]
				]);
				channel.port1.postMessage({
					adapterId: event.data.adapterId,
					bootstrapChallenge,
					protocolVersion: event.data.protocolVersion,
					sessionId: event.data.sessionId,
					source: 'twine.rs.preview.host-command',
					type: 'debugger-bootstrap-challenge'
				});
			}
		});
	});
	await page.locator('#runtime-debugger-story').evaluate((element, srcDoc) => {
		(element as HTMLIFrameElement).srcdoc = srcDoc;
	}, html);
	await expect
		.poll(async () =>
			(await messages(page)).some(({type}) => type === 'debugger-hello')
		)
		.toBe(true);

	const frame = page.frames().find(candidate => candidate !== page.mainFrame());

	if (!frame) {
		throw new Error('Instrumented story frame did not load.');
	}

	return frame;
}

test('foreign-content tree adoption is excluded from exact Harlowe admission', async ({
	browserName,
	page
}) => {
	test.skip(browserName !== 'chromium', 'Chromium parser contract probe.');
	const fixtures = [
		'<svg><noscript><div role="script" id="foreign-svg">SVG</div></noscript></svg>',
		'<math><noscript><section><div role="script" id="foreign-math">MathML</div></section></noscript></math>'
	];
	const domParserDescriptor = Object.getOwnPropertyDescriptor(
		globalThis,
		'DOMParser'
	);

	try {
		Object.defineProperty(globalThis, 'DOMParser', {
			configurable: true,
			value: undefined
		});
		for (const [index, fixture] of fixtures.entries()) {
			const source = publishedStory(
				'harlowe-3.3.9',
				'Harlowe',
				'3.3.9',
				'Ready',
				fixture
			);
			const sessionId = `foreign-harlowe-${index}`;
			const exact = instrumentPreviewHtml(source, sessionId, {
				admission: admissionForFormat('Harlowe', '3.3.9'),
				enableHarloweSessionStorageFallback: true
			});
			const generic = instrumentPreviewHtml(source, sessionId, {
				admission: NO_PREVIEW_FORMAT_ADMISSION,
				enableHarloweSessionStorageFallback: true
			});

			expect(exact.admission).toEqual({kind: 'none'});
			expect(exact.html).toBe(generic.html);
			expect(exact.html).not.toContain(
				'id="twine-rs-harlowe-debugger-bootstrap"'
			);
		}
	} finally {
		if (domParserDescriptor) {
			Object.defineProperty(globalThis, 'DOMParser', domParserDescriptor);
		} else {
			delete (globalThis as {DOMParser?: typeof DOMParser}).DOMParser;
		}
	}

	await page.goto(appUrl);
	const adopted = await page.evaluate(() =>
		['svg', 'math'].map(kind => {
			const parsed = new DOMParser().parseFromString(
				`<tw-storydata><${kind}><noscript><section><div role="script" id="probe-${kind}">x</div></section></noscript></${kind}><script role="script" id="twine-user-script" type="text/twine-javascript"></script></tw-storydata>`,
				'text/html'
			);
			const probe = parsed.querySelector(`#probe-${kind}`);

			return {
				closestNoscript: Boolean(probe?.parentElement?.closest('noscript')),
				kind,
				namespace: probe?.namespaceURI,
				parent: probe?.parentElement?.tagName,
				roleCount: parsed.querySelectorAll('[role="script"]').length
			};
		})
	);

	expect(adopted).toEqual(
		['svg', 'math'].map(kind => ({
			closestNoscript: false,
			kind,
			namespace: 'http://www.w3.org/1999/xhtml',
			parent: 'TW-STORYDATA',
			roleCount: 2
		}))
	);
});

function observedSnapshot(
	items: StoryPreviewBridgeMessage[],
	capabilities: StoryPreviewDebuggerCapability[]
) {
	return items.findLast(
		message =>
			message.type === 'debugger-snapshot' &&
			capabilities.every(
				capability =>
					message.sections?.[capability] !== undefined &&
					message.sections[capability]?.state !== 'unavailable'
			)
	);
}

test('bundled adapters negotiate canonical descriptors and usable sections', async ({
	browserName,
	page
}) => {
	test.setTimeout(300_000);
	const cases = [
		...SUGARCUBE_COMPATIBILITY.filter(
			entry =>
				browserName === 'chromium' ||
				CROSS_BROWSER_SUGARCUBE_VERSIONS.has(entry.version)
		).map(entry => ({
			adapterId: entry.adapterId,
			capabilities: [
				'currentPassage',
				'storyVariables',
				'temporaryVariables',
				'visitedPassages'
			] as StoryPreviewDebuggerCapability[],
			format: 'SugarCube',
			formatVersion: entry.version,
			passageText: '<<set $alpha = 1>><<set _temp = 2>>Ready'
		})),
		{
			adapterId: 'snowman-1.5.0',
			capabilities: [
				'currentPassage',
				'storyVariables',
				'visitedPassages'
			] as StoryPreviewDebuggerCapability[],
			format: 'Snowman',
			formatVersion: '1.5.0'
		},
		{
			adapterId: 'snowman-2.1.1',
			capabilities: [
				'currentPassage',
				'storyVariables',
				'visitedPassages'
			] as StoryPreviewDebuggerCapability[],
			format: 'Snowman',
			formatVersion: '2.1.1'
		},
		{
			adapterId: 'chapbook-2.3.1',
			capabilities: ['currentPassage'] as StoryPreviewDebuggerCapability[],
			format: 'Chapbook',
			formatVersion: '2.3.1'
		},
		{
			adapterId: 'harlowe-3.3.9',
			capabilities: [
				'currentPassage',
				'storyVariables',
				'visitedPassages'
			] as StoryPreviewDebuggerCapability[],
			format: 'Harlowe',
			formatVersion: '3.3.9',
			passageText: '(set:$alpha to 1)Ready'
		}
	];

	for (const item of cases) {
		const frame = await mountStory(page, {
			...item,
			formatId: item.adapterId,
			sessionId: `adapter-${item.adapterId}`
		});
		await expect
			.poll(async () =>
				observedSnapshot(await messages(page), item.capabilities)
			)
			.toBeTruthy();

		const captured = await messages(page);
		const hello = captured.findLast(({type}) => type === 'debugger-hello');
		const snapshot = observedSnapshot(captured, item.capabilities);

		expect(hello).toMatchObject({
			adapterId: item.adapterId,
			capabilities: item.capabilities,
			format: item.format,
			formatVersion: item.formatVersion,
			protocolVersion: 1
		});
		if (item.format === 'Harlowe') {
			expect(hello?.reliability).toBe('exact-version');
			expect(captured).toEqual(
				expect.arrayContaining([
					expect.objectContaining({type: 'debugger-bootstrap-arm'}),
					expect.objectContaining({
						bootstrapChallenge: expect.stringMatching(/^[0-9a-f]{64}$/),
						type: 'debugger-bootstrap-ready'
					})
				])
			);
		}
		expect(Object.keys(snapshot?.sections ?? {})).toEqual(item.capabilities);
		if (item.format === 'SugarCube') {
			expect(snapshot).toMatchObject({
				storyVariables: [{name: 'alpha', preview: '1', type: 'number'}],
				temporaryVariables: [{name: 'temp', preview: '2', type: 'number'}],
				visitedPassages: [{name: 'Start'}]
			});
		}
		if (item.format === 'Harlowe') {
			expect(snapshot).toMatchObject({
				storyVariables: [{name: 'alpha', preview: '1', type: 'number'}],
				visitedPassages: [{name: 'Start'}]
			});
			const deserialised = await frame.evaluate(() => {
				const runtime = window as typeof window & {
					__runtimeDebuggerHarloweDeserialise(source: string): true | Error;
				};
				const savedSession = sessionStorage.getItem('Saved Session');

				if (!savedSession) {
					throw new Error('Harlowe did not save its startup session.');
				}
				const turns = JSON.parse(savedSession) as Array<{
					passage: string;
					variables: Record<string, unknown>;
				}>;
				const startupTurn = turns.at(-1);

				if (!startupTurn) {
					throw new Error('Harlowe saved no startup turn.');
				}

				// Harlowe save data stores variable values as Harlowe source text.
				// Repeated valid Start moments exercise the real deserialisation and
				// committed-history bound without inventing passages outside the story.
				const expandedTurns = Array.from({length: 201}, (_, index) => ({
					...startupTurn,
					variables: {
						...startupTurn.variables,
						alpha: index === 200 ? '7' : '1'
					}
				}));
				return runtime.__runtimeDebuggerHarloweDeserialise(
					JSON.stringify(expandedTurns)
				);
			});

			expect(deserialised).toBe(true);
			await expect
				.poll(async () => {
					const loaded = (await messages(page)).findLast(
						message =>
							message.type === 'debugger-snapshot' &&
							message.adapterId === 'harlowe-3.3.9'
					);

					return {
						firstVisited: loaded?.visitedPassages?.at(0)?.name,
						lastVisited: loaded?.visitedPassages?.at(-1)?.name,
						status: loaded?.sections?.visitedPassages,
						variable: loaded?.storyVariables?.find(
							variable => variable.name === 'alpha'
						)?.preview,
						visitedCount: loaded?.visitedPassages?.length
					};
				})
				.toEqual({
					firstVisited: 'Start',
					lastVisited: 'Start',
					status: {reasons: ['item-limit'], state: 'truncated'},
					variable: '7',
					visitedCount: 200
				});
		}
	}
});

test('bundled exact adapters restart cleanly and remount the same artifact', async ({
	browserName,
	page
}) => {
	test.setTimeout(360_000);
	const cases = [
		...SUGARCUBE_COMPATIBILITY.filter(
			entry =>
				browserName === 'chromium' ||
				CROSS_BROWSER_SUGARCUBE_VERSIONS.has(entry.version)
		).map(entry => ({
			adapterId: entry.adapterId,
			format: 'SugarCube',
			formatVersion: entry.version,
			passageText: '<<set $initial = 1>>Ready'
		})),
		{
			adapterId: 'snowman-1.5.0',
			format: 'Snowman',
			formatVersion: '1.5.0'
		},
		{
			adapterId: 'snowman-2.1.1',
			format: 'Snowman',
			formatVersion: '2.1.1'
		},
		{
			adapterId: 'chapbook-2.3.1',
			format: 'Chapbook',
			formatVersion: '2.3.1'
		},
		{
			adapterId: 'harlowe-3.3.9',
			format: 'Harlowe',
			formatVersion: '3.3.9'
		}
	];

	for (const item of cases) {
		const sessionId = `restart-${item.adapterId}`;
		let frame = await mountStory(page, {
			...item,
			formatId: item.adapterId,
			sessionId
		});
		await expect
			.poll(async () =>
				(await messages(page)).some(
					message =>
						message.type === 'debugger-command-hello' &&
						message.adapterId === item.adapterId
				)
			)
			.toBe(true);

		await frame.evaluate(adapterId => {
			const runtime = window as typeof window & {
				SugarCube?: {State: {variables: Record<string, unknown>}};
				engine?: {state: {set(name: string, value: unknown): void}};
				story?: {history: number[]; state: Record<string, unknown>};
				__restartEventCount?: number;
			};

			if (adapterId.startsWith('sugarcube-')) {
				runtime.SugarCube!.State.variables.transient = 42;
				runtime.__restartEventCount = 0;
				document.addEventListener(':enginerestart', () => {
					runtime.__restartEventCount! += 1;
				});
				Function.prototype.toString = () => 'tampered';
			} else if (adapterId.startsWith('snowman-')) {
				runtime.story!.state.transient = 42;
				runtime.story!.history.push(99);
				location.hash = 'saved-continuation';
				String.prototype.slice = () => {
					throw new Error('tampered slice');
				};
			} else if (adapterId === 'chapbook-2.3.1') {
				runtime.engine!.state.set('transient', 42);
				Function.prototype.toString = () => 'tampered';
			} else {
				sessionStorage.setItem('Saved Session', 'stale continuation');
				try {
					Object.defineProperty(sessionStorage, 'removeItem', {
						value: () => {
							throw new Error('tampered storage');
						}
					});
				} catch {
					// The browser fallback is intentionally frozen by the bridge.
				}
			}
		}, item.adapterId);

		const requestId = `request-${item.adapterId}`;
		const marker = `twine-rs-restart:${sessionId}:${requestId}`;
		await page.locator('#runtime-debugger-story').evaluate(
			(element, request) => {
				const iframe = element as HTMLIFrameElement;

				iframe.name = request.marker;
				iframe.contentWindow!.postMessage(request.message, '*');
			},
			{
				marker,
				message: {
					adapterId: item.adapterId,
					command: 'restart',
					protocolVersion: 1,
					requestId,
					sessionId,
					source: 'twine.rs.preview.host-command'
				}
			}
		);
		await expect
			.poll(
				async () =>
					(await messages(page)).findLast(
						message =>
							message.type === 'debugger-command-result' &&
							message.requestId === requestId
					)?.status,
				{message: `${item.adapterId} should apply restart`}
			)
			.toBe('applied');

		if (item.adapterId.startsWith('sugarcube-')) {
			expect(
				await frame.evaluate(
					() =>
						(window as typeof window & {__restartEventCount: number})
							.__restartEventCount
				)
			).toBe(1);
		} else if (item.adapterId === 'chapbook-2.3.1') {
			expect(
				await frame.evaluate(() =>
					(
						window as typeof window & {
							engine: {state: {get(name: string): unknown}};
						}
					).engine.state.get('transient')
				)
			).toBeUndefined();
		} else {
			expect(
				await frame.evaluate(() => sessionStorage.getItem('Saved Session'))
			).toBeNull();
		}

		const helloCount = (await messages(page)).filter(
			message => message.type === 'debugger-hello'
		).length;
		await page.locator('#runtime-debugger-story').evaluate(element => {
			const iframe = element as HTMLIFrameElement;
			const artifact = iframe.srcdoc;

			iframe.srcdoc = '';
			iframe.srcdoc = artifact;
		});
		await expect
			.poll(
				async () =>
					(await messages(page)).filter(
						message => message.type === 'debugger-hello'
					).length
			)
			.toBeGreaterThan(helloCount);
		frame = page.frames().find(candidate => candidate !== page.mainFrame())!;

		if (
			item.adapterId.startsWith('sugarcube-') ||
			item.adapterId.startsWith('snowman-')
		) {
			await expect
				.poll(async () => {
					const snapshot = (await messages(page)).findLast(
						message =>
							message.type === 'debugger-snapshot' &&
							message.adapterId === item.adapterId
					);

					return snapshot?.storyVariables?.some(
						variable => variable.name === 'transient'
					);
				})
				.toBe(false);
		}
		expect(frame).toBeTruthy();
	}
});

test('bundled Chapbook capture leaves hostile live state untouched', async ({
	page
}) => {
	const frame = await mountStory(page, {
		format: 'Chapbook',
		formatId: 'chapbook-2.3.1',
		formatVersion: '2.3.1',
		sessionId: 'chapbook-hostile-state'
	});
	const before = (await messages(page)).filter(
		({type}) => type === 'debugger-snapshot'
	).length;

	await frame.evaluate(() => {
		const runtime = window as typeof window & {
			__runtimeDebuggerPoisonCount: number;
			__twineRsPreviewDebug: {captureState(): void};
			engine: {state: {set(name: string, value: unknown): void}};
		};
		const value: Record<string, unknown> = {};
		runtime.engine.state.set('debuggerPoison', value);
		value.huge = 'x'.repeat(1_000_000);
		value.cycle = value;
		runtime.__runtimeDebuggerPoisonCount = 0;
		const poison = () => {
			runtime.__runtimeDebuggerPoisonCount += 1;
			throw new Error('Debugger inspection executed story code.');
		};
		Object.defineProperty(value, 'accessor', {
			enumerable: true,
			get: poison
		});
		Object.defineProperty(value, 'toJSON', {value: poison});
		runtime.__twineRsPreviewDebug.captureState();
	});
	await expect
		.poll(
			async () =>
				(await messages(page)).filter(({type}) => type === 'debugger-snapshot')
					.length
		)
		.toBeGreaterThan(before);

	const count = await frame.evaluate(
		() =>
			(window as typeof window & {__runtimeDebuggerPoisonCount: number})
				.__runtimeDebuggerPoisonCount
	);
	const captured = await messages(page);
	const snapshot = captured.findLast(({type}) => type === 'debugger-snapshot');

	expect(count).toBe(0);
	expect(snapshot).toMatchObject({
		adapterId: 'chapbook-2.3.1',
		sections: {currentPassage: {state: 'complete'}}
	});
	expect(snapshot).not.toHaveProperty('storyVariables');
	expect(snapshot).not.toHaveProperty('visitedPassages');
	expect(captured.some(({type}) => type === 'state')).toBe(true);
});

test('bundled Snowman bounds escaped previews and retains the newest 200 history entries', async ({
	page
}) => {
	const frame = await mountStory(page, {
		format: 'Snowman',
		formatId: 'snowman-2.1.1',
		formatVersion: '2.1.1',
		sessionId: 'snowman-history'
	});

	await frame.evaluate(() => {
		const runtime = window as typeof window & {
			__twineRsPreviewDebug: {captureState(): void};
			passage: {id: number; name: string};
			story: {history: number[]; state: Record<string, unknown>};
		};
		runtime.story.history = Array.from({length: 205}, (_, index) => index + 1);
		runtime.story.state.escaped = '\0'.repeat(512);
		runtime.passage = {id: 205, name: 'Current'};
		runtime.__twineRsPreviewDebug.captureState();
	});
	await expect
		.poll(async () => {
			const snapshot = (await messages(page)).findLast(
				({type}) => type === 'debugger-snapshot'
			);
			return snapshot?.visitedPassages?.length;
		})
		.toBe(200);

	const snapshot = (await messages(page)).findLast(
		({type}) => type === 'debugger-snapshot'
	);

	expect(snapshot?.currentPassage).toMatchObject({
		localId: '205',
		name: 'Current'
	});
	expect(snapshot?.sections?.visitedPassages).toEqual({
		reasons: ['item-limit'],
		state: 'truncated'
	});
	expect(snapshot?.sections?.storyVariables).toEqual({
		reasons: ['field-limit'],
		state: 'truncated'
	});
	expect(
		snapshot?.storyVariables?.find(({name}) => name === 'escaped')?.preview
	).toHaveLength(STORY_PREVIEW_BRIDGE_LIMITS.debuggerPreviewLength);
	expect(snapshot?.visitedPassages).toHaveLength(200);
	expect(snapshot?.visitedPassages?.[0]).toMatchObject({localId: '6'});
	expect(snapshot?.visitedPassages?.at(-1)).toMatchObject({localId: '205'});
	expect(
		normalizeStoryPreviewBridgeMessage(snapshot, {
			admission: NO_PREVIEW_FORMAT_ADMISSION,
			bridgeSessionId: 'snowman-history',
			generation: 0,
			sugarCubeRestartEligible: false
		})
	).toBeDefined();
});

test('renders captured variable whitespace exactly while wrapping in a narrow inspector', async ({
	page
}) => {
	const spacedValue = `  ${Array.from(
		{length: 32},
		(_, index) => `token-${index}`
	).join('  ')}  `;
	const expectedPreview = JSON.stringify(spacedValue);

	await mountStory(page, {
		format: 'SugarCube',
		formatId: 'sugarcube-2.37.3',
		formatVersion: '2.37.3',
		passageText: `<<set $spaced = ${JSON.stringify(spacedValue)}>>Ready`,
		sessionId: 'sugarcube-whitespace'
	});
	await expect
		.poll(async () => {
			const snapshot = (await messages(page)).findLast(
				({type}) => type === 'debugger-snapshot'
			);

			return snapshot?.storyVariables?.find(({name}) => name === 'spaced')
				?.preview;
		})
		.toBe(expectedPreview);

	const snapshot = (await messages(page)).findLast(
		({type}) => type === 'debugger-snapshot'
	);
	const capturedPreview = snapshot?.storyVariables?.find(
		({name}) => name === 'spaced'
	)?.preview;

	expect(capturedPreview).toBe(expectedPreview);
	await page.addStyleTag({
		path: path.join(process.cwd(), 'src', 'routes', 'story-preview-frame.css')
	});
	await page.evaluate(preview => {
		const variables = document.createElement('ul');
		const row = document.createElement('li');
		const value = document.createElement('code');

		variables.className = 'story-preview-route__debugger-variables';
		variables.style.width = '240px';
		value.className = 'story-preview-route__debugger-variable-preview';
		value.textContent = preview ?? '';
		row.append(value);
		variables.append(row);
		document.body.append(variables);
	}, capturedPreview);
	const preview = page.locator(
		'.story-preview-route__debugger-variable-preview'
	);
	const rendered = await preview.evaluate(element => {
		const range = document.createRange();

		range.selectNodeContents(element);
		return {
			innerText: (element as HTMLElement).innerText,
			lineFragments: range.getClientRects().length,
			whiteSpace: getComputedStyle(element).whiteSpace
		};
	});

	expect(rendered.innerText).toBe(expectedPreview);
	expect(rendered.whiteSpace).toBe('break-spaces');
	expect(rendered.lineFragments).toBeGreaterThan(1);
});
