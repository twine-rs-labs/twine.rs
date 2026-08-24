import {expect, Frame, Page, test} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
	instrumentPreviewHtml,
	normalizeStoryPreviewBridgeMessage,
	STORY_PREVIEW_BRIDGE_LIMITS,
	type StoryPreviewBridgeMessage
} from '../src/routes/story-preview-contract';
import type {StoryPreviewDebuggerCapability} from '../src/routes/story-preview-debugger-protocol';

const appUrl = 'http://127.0.0.1:5173';

test.skip(
	({browserName}) => browserName !== 'chromium',
	'Bundled runtime debugger conformance is anchored in Chromium.'
);

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
	passageText = 'Ready'
) {
	const name = `Runtime Debugger ${formatId}`;
	const storyData = [
		`<tw-storydata name="${name}" startnode="1" creator="twine.rs"`,
		` creator-version="0.2.0" format="${format}"`,
		` format-version="${formatVersion}"`,
		' ifid="11111111-2222-4333-8444-555555555555"',
		' options="" tags="" zoom="1" hidden>',
		'<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css"></style>',
		'<script role="script" id="twine-user-script" type="text/twine-javascript"></script>',
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
	const html = instrumentPreviewHtml(
		publishedStory(formatId, format, formatVersion, passageText),
		sessionId,
		{enableHarloweSessionStorageFallback: true}
	);

	await page.goto(appUrl);
	await page.evaluate(() => {
		localStorage.clear();
		sessionStorage.clear();
	});
	await page.setContent('<iframe id="runtime-debugger-story"></iframe>');
	await page.evaluate(() => {
		const target = window as typeof window & {
			__runtimeDebuggerMessages: StoryPreviewBridgeMessage[];
		};
		target.__runtimeDebuggerMessages = [];
		window.addEventListener('message', event => {
			target.__runtimeDebuggerMessages.push(event.data);
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
	page
}) => {
	test.setTimeout(90_000);
	const cases = [
		{
			adapterId: 'sugarcube-2.37.3',
			capabilities: [
				'currentPassage',
				'storyVariables',
				'temporaryVariables',
				'visitedPassages'
			] as StoryPreviewDebuggerCapability[],
			format: 'SugarCube',
			formatVersion: '2.37.3',
			passageText: '<<set $alpha = 1>><<set _temp = 2>>Ready'
		},
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
			capabilities: ['currentPassage'] as StoryPreviewDebuggerCapability[],
			format: 'Harlowe',
			formatVersion: '3.3.9'
		}
	];

	for (const item of cases) {
		await mountStory(page, {
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
		expect(Object.keys(snapshot?.sections ?? {})).toEqual(item.capabilities);
		if (item.adapterId === 'sugarcube-2.37.3') {
			expect(snapshot).toMatchObject({
				storyVariables: [{name: 'alpha', preview: '1', type: 'number'}],
				temporaryVariables: [{name: 'temp', preview: '2', type: 'number'}],
				visitedPassages: [{name: 'Start'}]
			});
		}
	}
});

test('bundled exact adapters restart cleanly and remount the same artifact', async ({
	page
}) => {
	test.setTimeout(120_000);
	const cases = [
		{
			adapterId: 'sugarcube-2.37.3',
			format: 'SugarCube',
			formatVersion: '2.37.3',
			passageText: '<<set $initial = 1>>Ready'
		},
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

			if (adapterId === 'sugarcube-2.37.3') {
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

		if (item.adapterId === 'sugarcube-2.37.3') {
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
			item.adapterId === 'sugarcube-2.37.3' ||
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
	expect(normalizeStoryPreviewBridgeMessage(snapshot)).toBeDefined();
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
