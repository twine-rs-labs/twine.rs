import {
	createStoryPreviewPassageLookup,
	initialStoryPreviewRuntimeModel,
	instrumentPreviewHtml,
	normalizeStoryPreviewBridgeMessage,
	reduceStoryPreviewRuntime,
	resolveRuntimePassage,
	serializeStoryPreviewRuntimeLog,
	STORY_PREVIEW_BRIDGE_LIMITS,
	STORY_PREVIEW_BRIDGE_SOURCE,
	STORY_PREVIEW_RUNTIME_LOG_LIMIT
} from '../story-preview-contract';
import {runtimeLogTone} from '../story-preview-debug';
import {
	STORY_PREVIEW_COMMAND_PROTOCOL_VERSION,
	isStoryPreviewDebuggerAdapterId,
	selectStoryPreviewDebuggerAdapter,
	STORY_PREVIEW_DEBUGGER_ADAPTER_REGISTRATIONS,
	STORY_PREVIEW_DEBUGGER_CAPTURE_COLLECTIONS,
	STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION
} from '../story-preview-debugger-protocol';

function lastPostedState(postMessage: jest.SpyInstance) {
	return postMessage.mock.calls
		.map(([message]) => message)
		.filter(message => message?.type === 'state')
		.at(-1);
}

function posted(postMessage: jest.SpyInstance, type: string) {
	return postMessage.mock.calls
		.map(([message]) => message)
		.filter(message => message?.type === type);
}

function installInstrumentedDebugger(
	format: string,
	formatVersion: string,
	sessionId: string
) {
	document.body.innerHTML = `<tw-storydata format="${format}" format-version="${formatVersion}"></tw-storydata>`;
	const script = /<script>([\s\S]*?)<\/script>/.exec(
		instrumentPreviewHtml('<html><head></head><body></body></html>', sessionId)
	)?.[1];
	expect(script).toBeDefined();
	window.eval(script!);
	document.dispatchEvent(new Event('DOMContentLoaded'));
}

function installBundledSugarCubeState({
	history,
	passage,
	temporary,
	variables
}: {
	history: unknown[];
	passage: string;
	temporary: Record<string, unknown>;
	variables: Record<string, unknown>;
}) {
	(window as any).__twineRsSugarCubeFixture = {
		history,
		passage,
		temporary,
		variables
	};
	window.eval(
		'(function(){var fixture=window.__twineRsSugarCubeFixture;var _history=fixture.history;var _temporary=fixture.temporary;var _active={title:fixture.passage,variables:fixture.variables};window.SugarCube={State:Object.freeze(Object.defineProperties({}, {history:{get:function(){return _history}},passage:{get:function(){return _active.title}},temporary:{get:function(){return _temporary}},variables:{get:function(){return _active.variables}}}))};})()'
	);
}

function debuggerSnapshotTextLength(message: Record<string, any>) {
	const passageLength = (passage: Record<string, unknown> | undefined) =>
		['id', 'localId', 'name', 'rawName', 'source'].reduce(
			(total, key) =>
				total +
				(typeof passage?.[key] === 'string'
					? (passage[key] as string).length
					: 0),
			0
		);
	const variableLength = (variables: Record<string, string>[] | undefined) =>
		variables?.reduce(
			(total, variable) =>
				total +
				variable.name.length +
				variable.type.length +
				variable.preview.length,
			0
		) ?? 0;

	return (
		passageLength(message.currentPassage) +
		variableLength(message.storyVariables) +
		variableLength(message.temporaryVariables) +
		(message.visitedPassages?.reduce(
			(total: number, passage: Record<string, unknown>) =>
				total + passageLength(passage),
			0
		) ?? 0)
	);
}

describe('instrumented runtime passage detection', () => {
	it('captures Chapbook 2.3.1 current passage from early trail events', () => {
		jest.useFakeTimers();
		document.body.innerHTML = `
			<tw-storydata format="Chapbook" format-version="2.3.1"></tw-storydata>
			<div id="page"><article>Start</article></div>
		`;
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const script = /<script>([\s\S]*?)<\/script>/.exec(
			instrumentPreviewHtml(
				'<html><head></head><body></body></html>',
				'chapbook-trail'
			)
		)?.[1];

		try {
			expect(script).toBeDefined();
			window.eval(script!);
			window.dispatchEvent(
				new window.CustomEvent('state-change', {
					detail: {name: 'trail', value: ['Start']}
				})
			);
			jest.advanceTimersByTime(50);
			document.dispatchEvent(new Event('DOMContentLoaded'));
			expect(lastPostedState(postMessage)?.currentPassage).toEqual({
				name: 'Start',
				source: 'Chapbook state-change'
			});

			window.dispatchEvent(
				new window.CustomEvent('state-change', {
					detail: {name: 'trail', value: ['Start', 'Next']}
				})
			);
			jest.advanceTimersByTime(50);
			expect(lastPostedState(postMessage)?.currentPassage).toEqual({
				name: 'Next',
				source: 'Chapbook state-change'
			});
		} finally {
			jest.clearAllTimers();
			jest.useRealTimers();
			postMessage.mockRestore();
		}
	});

	it('gates Chapbook trail capture exactly and rejects accessor-backed or malformed updates', () => {
		jest.useFakeTimers();
		document.body.innerHTML =
			'<tw-storydata format="Chapbook" format-version="2.3.1"></tw-storydata>';
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);

		try {
			installInstrumentedDebugger('Chapbook', '2.3.1', 'chapbook-descriptors');
			const storyData = document.querySelector('tw-storydata')!;
			storyData.setAttribute('startnode', '1');
			storyData.innerHTML =
				'<tw-passagedata pid="1" name="Start">Start</tw-passagedata>';
			window.dispatchEvent(
				new window.CustomEvent('state-change', {
					detail: {name: 'trail', value: ['Start']}
				})
			);
			jest.advanceTimersByTime(50);
			expect(lastPostedState(postMessage)?.currentPassage).toMatchObject({
				name: 'Start'
			});

			storyData.setAttribute('format-version', '2.3.0');
			window.dispatchEvent(
				new window.CustomEvent('state-change', {
					detail: {name: 'trail', value: ['Wrong version']}
				})
			);
			jest.advanceTimersByTime(50);
			(window as any).__twineRsPreviewDebug.captureState();
			expect(lastPostedState(postMessage)?.currentPassage).toEqual({
				localId: '1',
				name: 'Start',
				source: 'storydata startnode'
			});

			storyData.setAttribute('format-version', '2.3.1');
			window.dispatchEvent(
				new window.CustomEvent('state-change', {
					detail: {name: 'trail', value: ['Start', 'Next']}
				})
			);
			jest.advanceTimersByTime(50);
			expect(lastPostedState(postMessage)?.currentPassage).toMatchObject({
				name: 'Next'
			});

			const nativeDetailEvent = new window.CustomEvent('state-change', {
				detail: {name: 'trail', value: ['Start', 'Native detail']}
			});
			const detailGetter = jest.fn(() => {
				throw new Error('story-controlled detail getter');
			});
			Object.defineProperty(nativeDetailEvent, 'detail', {
				configurable: true,
				get: detailGetter
			});
			window.dispatchEvent(nativeDetailEvent);
			jest.advanceTimersByTime(50);
			expect(detailGetter).not.toHaveBeenCalled();
			expect(lastPostedState(postMessage)?.currentPassage).toMatchObject({
				name: 'Native detail'
			});

			const inheritedNameDetail = Object.assign(
				Object.create({name: 'trail'}),
				{value: ['Start', 'Inherited name']}
			);
			const stateCountBeforeInheritedName = posted(postMessage, 'state').length;
			window.dispatchEvent(
				new window.CustomEvent('state-change', {detail: inheritedNameDetail})
			);
			jest.advanceTimersByTime(50);
			expect(posted(postMessage, 'state')).toHaveLength(
				stateCountBeforeInheritedName
			);
			expect(
				posted(postMessage, 'state').map(
					message => message.currentPassage?.name
				)
			).not.toContain('Inherited name');

			const accessorNameDetail = {value: ['Start', 'Accessor name']};
			const nameGetter = jest.fn(() => 'trail');
			Object.defineProperty(accessorNameDetail, 'name', {
				enumerable: true,
				get: nameGetter
			});
			const stateCountBeforeAccessorName = posted(postMessage, 'state').length;
			window.dispatchEvent(
				new window.CustomEvent('state-change', {detail: accessorNameDetail})
			);
			jest.advanceTimersByTime(50);
			expect(nameGetter).not.toHaveBeenCalled();
			expect(posted(postMessage, 'state')).toHaveLength(
				stateCountBeforeAccessorName
			);
			expect(
				posted(postMessage, 'state').map(
					message => message.currentPassage?.name
				)
			).not.toContain('Accessor name');

			const trail = ['Start', 'Next'];
			const getter = jest.fn(() => 'forged');
			Object.defineProperty(trail, '1', {enumerable: true, get: getter});
			window.dispatchEvent(
				new window.CustomEvent('state-change', {
					detail: {name: 'trail', value: trail}
				})
			);
			jest.advanceTimersByTime(50);
			expect(getter).not.toHaveBeenCalled();
			expect(lastPostedState(postMessage)?.currentPassage).toBeUndefined();

			window.dispatchEvent(
				new window.CustomEvent('state-change', {
					detail: {name: 'trail', value: ['Start', 'Recovered']}
				})
			);
			jest.advanceTimersByTime(50);
			expect(lastPostedState(postMessage)?.currentPassage).toMatchObject({
				name: 'Recovered'
			});

			const revoked = Proxy.revocable([], {});
			revoked.revoke();
			window.dispatchEvent(
				new window.CustomEvent('state-change', {
					detail: {name: 'trail', value: revoked.proxy}
				})
			);
			jest.advanceTimersByTime(50);
			expect(lastPostedState(postMessage)?.currentPassage).toBeUndefined();

			window.dispatchEvent(
				new window.CustomEvent('state-change', {
					detail: {name: 'trail', value: ['Start', 'Before value getter']}
				})
			);
			jest.advanceTimersByTime(50);
			expect(lastPostedState(postMessage)?.currentPassage).toMatchObject({
				name: 'Before value getter'
			});

			const accessorValueDetail = {name: 'trail'};
			const valueGetter = jest.fn(() => ['Start', 'Accessor value']);
			Object.defineProperty(accessorValueDetail, 'value', {
				enumerable: true,
				get: valueGetter
			});
			window.dispatchEvent(
				new window.CustomEvent('state-change', {detail: accessorValueDetail})
			);
			jest.advanceTimersByTime(50);
			expect(valueGetter).not.toHaveBeenCalled();
			expect(lastPostedState(postMessage)?.currentPassage).toBeUndefined();
			expect(
				posted(postMessage, 'state').map(
					message => message.currentPassage?.name
				)
			).not.toContain('Accessor value');
		} finally {
			jest.clearAllTimers();
			jest.useRealTimers();
			postMessage.mockRestore();
		}
	});

	it('keeps recapturing after a provisional start node until SugarCube exposes live state', () => {
		jest.useFakeTimers();
		document.body.innerHTML = `
			<tw-storydata format="SugarCube" startnode="1">
				<tw-passagedata pid="1" name="Start">Start</tw-passagedata>
			</tw-storydata>
		`;
		delete (window as any).SugarCube;
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const instrumented = instrumentPreviewHtml(
			'<html><head></head><body></body></html>',
			'late-sugarcube-session'
		);
		const script = /<script>([\s\S]*?)<\/script>/.exec(instrumented)?.[1];

		try {
			expect(script).toBeDefined();
			window.eval(script!);
			document.dispatchEvent(new Event('DOMContentLoaded'));
			expect(lastPostedState(postMessage)?.currentPassage).toEqual({
				localId: '1',
				name: 'Start',
				source: 'storydata startnode'
			});

			document.body.insertAdjacentHTML(
				'beforeend',
				'<div id="passages"><div class="passage">Rendered</div></div>'
			);
			(window as any).__twineRsPreviewDebug.captureState();
			expect(lastPostedState(postMessage)?.currentPassage).toBeUndefined();

			installBundledSugarCubeState({
				history: [],
				passage: 'Start',
				temporary: {},
				variables: {}
			});
			jest.advanceTimersByTime(250);

			expect(lastPostedState(postMessage)?.currentPassage).toEqual({
				name: 'Start',
				source: 'SugarCube State'
			});
			expect(jest.getTimerCount()).toBe(0);
		} finally {
			jest.clearAllTimers();
			jest.useRealTimers();
			delete (window as any).SugarCube;
			delete (window as any).__twineRsSugarCubeFixture;
			postMessage.mockRestore();
		}
	});

	it('recaptures passage identity when the runtime initializes after the startup sample', () => {
		jest.useFakeTimers();
		document.body.innerHTML = '<div class="passage"></div>';
		delete (window as any).State;
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const instrumented = instrumentPreviewHtml(
			'<html><head></head><body></body></html>',
			'late-runtime-session'
		);
		const script = /<script>([\s\S]*?)<\/script>/.exec(instrumented)?.[1];

		try {
			expect(script).toBeDefined();
			window.eval(script!);
			document.dispatchEvent(new Event('DOMContentLoaded'));
			expect(lastPostedState(postMessage)?.currentPassage).toBeUndefined();

			(window as any).State = {passage: 'Start'};
			jest.advanceTimersByTime(250);

			expect(lastPostedState(postMessage)?.currentPassage).toEqual({
				name: 'Start',
				source: 'runtime'
			});
			expect(jest.getTimerCount()).toBe(0);
		} finally {
			jest.clearAllTimers();
			jest.useRealTimers();
			delete (window as any).State;
			postMessage.mockRestore();
		}
	});

	it('stops startup recapture when passage identity remains unavailable', () => {
		jest.useFakeTimers();
		document.body.innerHTML = '<div class="passage"></div>';
		delete (window as any).State;
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const instrumented = instrumentPreviewHtml(
			'<html><head></head><body></body></html>',
			'unknown-runtime-session'
		);
		const script = /<script>([\s\S]*?)<\/script>/.exec(instrumented)?.[1];

		try {
			expect(script).toBeDefined();
			window.eval(script!);
			document.dispatchEvent(new Event('DOMContentLoaded'));
			jest.advanceTimersByTime(60_000);
			const captureCount = postMessage.mock.calls.filter(
				([message]) => message?.type === 'state'
			).length;

			expect(captureCount).toBeGreaterThan(1);
			expect(jest.getTimerCount()).toBe(0);
			jest.advanceTimersByTime(60_000);
			expect(
				postMessage.mock.calls.filter(([message]) => message?.type === 'state')
			).toHaveLength(captureCount);
		} finally {
			jest.clearAllTimers();
			jest.useRealTimers();
			postMessage.mockRestore();
		}
	});

	it('uses bounded Harlowe session identity and never guesses from rendered text', () => {
		document.body.innerHTML = `
			<tw-storydata format="Harlowe" startnode="1">
				<tw-passagedata pid="1" name="Start">''Hello''</tw-passagedata>
				<tw-passagedata pid="2" name="Second">Hello</tw-passagedata>
			</tw-storydata>
			<tw-story><tw-passage><strong>Hello</strong></tw-passage></tw-story>
		`;
		sessionStorage.clear();
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const instrumented = instrumentPreviewHtml(
			'<html><head></head><body><tw-storydata format="Harlowe"></tw-storydata></body></html>',
			'session-1'
		);
		const script = /<script>([\s\S]*?)<\/script>/.exec(instrumented)?.[1];

		expect(script).toBeDefined();
		window.eval(script!);
		(window as any).__twineRsPreviewDebug.captureState();
		expect(lastPostedState(postMessage)?.currentPassage).toBeUndefined();

		sessionStorage.setItem(
			'Saved Session',
			JSON.stringify([{passage: 'Start'}, 'Second'])
		);
		(window as any).__twineRsPreviewDebug.captureState();
		expect(lastPostedState(postMessage)?.currentPassage).toEqual({
			name: 'Second',
			source: 'Harlowe session'
		});

		sessionStorage.setItem('Saved Session', 'x'.repeat(1024 * 1024 + 1));
		(window as any).__twineRsPreviewDebug.captureState();
		expect(lastPostedState(postMessage)?.currentPassage).toBeUndefined();

		postMessage.mockRestore();
		sessionStorage.clear();
	});

	it('supplies Harlowe session telemetry when sandbox storage is blocked', () => {
		document.body.innerHTML = `
				<tw-storydata format="Harlowe" startnode="1">
					<tw-passagedata pid="1" name="Start">Start</tw-passagedata>
					<tw-passagedata pid="2" name="Second">Second</tw-passagedata>
				</tw-storydata>
				<tw-story><tw-passage tags="">Second</tw-passage></tw-story>
			`;
		const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(
			window,
			'sessionStorage'
		);
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);

		expect(sessionStorageDescriptor).toBeDefined();
		Object.defineProperty(window, 'sessionStorage', {
			configurable: true,
			get() {
				throw new DOMException(
					'The document is sandboxed and lacks the allow-same-origin flag.',
					'SecurityError'
				);
			}
		});

		try {
			const instrumented = instrumentPreviewHtml(
				'<html><head></head><body><tw-storydata format="Harlowe"></tw-storydata></body></html>',
				'sandboxed-session',
				{enableHarloweSessionStorageFallback: true}
			);
			const script = /<script>([\s\S]*?)<\/script>/.exec(instrumented)?.[1];

			expect(script).toBeDefined();
			window.eval(script!);
			expect(window.sessionStorage.length).toBe(0);

			window.sessionStorage.setItem(
				'Saved Session',
				JSON.stringify(['Start', 'Second'])
			);
			(window as any).__twineRsPreviewDebug.captureState();

			expect(lastPostedState(postMessage)?.currentPassage).toEqual({
				name: 'Second',
				source: 'Harlowe session'
			});
		} finally {
			postMessage.mockRestore();
			Object.defineProperty(window, 'sessionStorage', {
				...sessionStorageDescriptor
			});
		}
	});
});

describe('normalizeStoryPreviewBridgeMessage()', () => {
	it('serializes retained runtime logs in input order with canonical levels and escaping', () => {
		expect(
			serializeStoryPreviewRuntimeLog([
				{id: 'a', level: 'log', message: '  <x>\\"\r\n\t  ', time: 0},
				{id: 'b', level: 'info', message: 'same', time: 0},
				{id: 'c', level: 'warn', message: 'warning', time: 0},
				{id: 'd', level: 'error', message: 'error', time: 0}
			])
		).toBe(
			'[1970-01-01T00:00:00.000Z] LOG: "  <x>\\\\\\"\\r\\n\\t  "\n[1970-01-01T00:00:00.000Z] INFO: "same"\n[1970-01-01T00:00:00.000Z] WARNING: "warning"\n[1970-01-01T00:00:00.000Z] ERROR: "error"'
		);
		expect(serializeStoryPreviewRuntimeLog([])).toBe('');
	});

	it('rejects out-of-domain runtime log serialization inputs', () => {
		expect(() =>
			serializeStoryPreviewRuntimeLog(
				Array.from({length: 13}, (_, index) => ({
					id: String(index),
					level: 'log' as const,
					message: '',
					time: index
				}))
			)
		).toThrow();
		expect(() =>
			serializeStoryPreviewRuntimeLog([
				{id: 'x', level: 'log', message: 'x', time: -1}
			])
		).toThrow();
		for (const time of [NaN, Infinity, 8.64e15 + 1]) {
			expect(() =>
				serializeStoryPreviewRuntimeLog([
					{id: 'x', level: 'log', message: 'x', time}
				])
			).toThrow();
		}
		expect(
			serializeStoryPreviewRuntimeLog([
				{id: 'max', level: 'log', message: '', time: 8.64e15}
			])
		).toContain('+275760-09-13T00:00:00.000Z');
		expect(() =>
			serializeStoryPreviewRuntimeLog([
				{id: 'x', level: 'unknown' as any, message: 'x', time: 0}
			])
		).toThrow();
		expect(() =>
			serializeStoryPreviewRuntimeLog([
				{
					id: 'x',
					level: 'log',
					message: 'x'.repeat(
						STORY_PREVIEW_BRIDGE_LIMITS.totalLogTextLength + 1
					),
					time: 0
				}
			])
		).toThrow();
	});

	it('keeps the maximum valid serialized buffer below the Electron IPC ceiling', () => {
		const text = serializeStoryPreviewRuntimeLog(
			Array.from({length: 12}, (_, index) => ({
				id: String(index),
				level: 'log' as const,
				message: '\0'.repeat(STORY_PREVIEW_BRIDGE_LIMITS.totalLogTextLength),
				time: index
			}))
		);
		expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(4 * 1024 * 1024);
	});

	it('counts inserted console argument separators against the message budget', () => {
		const args = Array.from({length: 16}, () => 'x'.repeat(2048));
		expect(
			normalizeStoryPreviewBridgeMessage({
				args,
				level: 'log',
				sessionId: 'session-1',
				source: STORY_PREVIEW_BRIDGE_SOURCE,
				time: 0,
				type: 'console'
			})
		).toBeUndefined();
	});

	it('accepts the maximum Date timestamp and rejects a later bridge timestamp', () => {
		const message = {
			args: [],
			level: 'log',
			sessionId: 'session-1',
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			type: 'console'
		};
		expect(
			normalizeStoryPreviewBridgeMessage({...message, time: 8.64e15})
		).toBeDefined();
		expect(
			normalizeStoryPreviewBridgeMessage({...message, time: 8.64e15 + 1})
		).toBeUndefined();
	});
	it('copies valid console messages into the bounded contract', () => {
		const args = ['hello', 'preview'];
		const normalized = normalizeStoryPreviewBridgeMessage({
			args,
			level: 'warn',
			sessionId: 'session-1',
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			time: 10,
			type: 'console'
		});

		expect(normalized).toEqual({
			args,
			level: 'warn',
			sessionId: 'session-1',
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			time: 10,
			type: 'console'
		});
		expect(normalized?.args).not.toBe(args);
	});

	it.each([
		['a non-object', 'message'],
		[
			'an oversized session ID',
			{
				args: [],
				level: 'log',
				sessionId: 's'.repeat(STORY_PREVIEW_BRIDGE_LIMITS.sessionIdLength + 1),
				source: STORY_PREVIEW_BRIDGE_SOURCE,
				type: 'console'
			}
		],
		[
			'an oversized log argument',
			{
				args: ['a'.repeat(STORY_PREVIEW_BRIDGE_LIMITS.logArgumentLength + 1)],
				level: 'log',
				sessionId: 'session-1',
				source: STORY_PREVIEW_BRIDGE_SOURCE,
				type: 'console'
			}
		],
		[
			'a malformed viewport',
			{
				sessionId: 'session-1',
				source: STORY_PREVIEW_BRIDGE_SOURCE,
				type: 'state',
				viewport: {height: 'large', width: 800}
			}
		]
	])('rejects %s', (_label, message) => {
		expect(normalizeStoryPreviewBridgeMessage(message)).toBeUndefined();
	});
});

describe('runtime debugger protocol', () => {
	it('rewrites only the verified SugarCube 2.37.3 startup call site', () => {
		const startup =
			'Engine.runUserInit(),UIBar.start(),Engine.start(),DebugBar.start()';
		const nativeRestart =
			'restart:{value:function(){LoadScreen.show(),window.scroll(0,0),State.reset(),triggerEvent(":enginerestart"),window.location.reload()}}';
		const exactHtml = `<html><head></head><body><tw-storydata format="SugarCube" format-version="2.37.3"></tw-storydata><script>${startup};const EngineApi={${nativeRestart}};</script></body></html>`;
		const instrumented = instrumentPreviewHtml(exactHtml, 'restart-session');

		expect(instrumented).toContain('var ENABLE_SUGARCUBE_RESTART = true');
		expect(instrumented).toContain(
			'Engine.runUserInit(),UIBar.start(),window.__twineRsPreviewSugarCubeStart(Engine,Config),DebugBar.start()'
		);
		expect(instrumented).not.toContain(startup);

		for (const unsupported of [
			exactHtml.replace('2.37.3', '2.37.4'),
			exactHtml.replace(startup, `${startup};${startup}`),
			exactHtml.replace(nativeRestart, '')
		]) {
			const result = instrumentPreviewHtml(unsupported, 'restart-session');

			expect(result).toContain('var ENABLE_SUGARCUBE_RESTART = false');
			expect(result).not.toContain(
				'__twineRsPreviewSugarCubeStart(Engine,Config)'
			);
		}
	});

	it('negotiates Restart only after a matching debugger hello', () => {
		const lookup = createStoryPreviewPassageLookup([]);
		const hello = normalizeStoryPreviewBridgeMessage({
			adapterId: 'harlowe-3.3.9',
			capabilities: ['currentPassage'],
			format: 'Harlowe',
			formatVersion: '3.3.9',
			protocolVersion: STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION,
			reliability: 'best-effort',
			sessionId: 'session-1',
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			type: 'debugger-hello'
		})!;
		const commandHello = normalizeStoryPreviewBridgeMessage({
			adapterId: 'harlowe-3.3.9',
			commandCapabilities: ['restart'],
			protocolVersion: STORY_PREVIEW_COMMAND_PROTOCOL_VERSION,
			sessionId: 'session-1',
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			type: 'debugger-command-hello'
		})!;
		expect(commandHello).toBeDefined();
		expect(
			normalizeStoryPreviewBridgeMessage({
				...commandHello,
				adapterId: 'generic'
			})
		).toBeUndefined();

		let model = initialStoryPreviewRuntimeModel(true);
		model = reduceStoryPreviewRuntime(model, {
			message: commandHello,
			now: 1,
			passages: lookup,
			type: 'message'
		});
		expect(model.debugger.commands).toBeUndefined();
		model = reduceStoryPreviewRuntime(model, {
			message: hello,
			now: 2,
			passages: lookup,
			type: 'message'
		});
		model = reduceStoryPreviewRuntime(model, {
			message: commandHello,
			now: 3,
			passages: lookup,
			type: 'message'
		});
		expect(model.debugger.commands).toEqual({
			adapterId: 'harlowe-3.3.9',
			capabilities: ['restart'],
			protocolVersion: STORY_PREVIEW_COMMAND_PROTOCOL_VERSION
		});
	});

	it('normalizes only bounded correlated Restart results', () => {
		const result = {
			adapterId: 'snowman-2.1.1',
			command: 'restart',
			protocolVersion: STORY_PREVIEW_COMMAND_PROTOCOL_VERSION,
			requestId: 'request-1',
			sessionId: 'session-1',
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			status: 'applied',
			type: 'debugger-command-result'
		};

		expect(normalizeStoryPreviewBridgeMessage(result)).toMatchObject(result);
		expect(
			normalizeStoryPreviewBridgeMessage({...result, status: 'success'})
		).toBeUndefined();
		expect(
			normalizeStoryPreviewBridgeMessage({
				...result,
				requestId: 'x'.repeat(
					STORY_PREVIEW_BRIDGE_LIMITS.commandRequestIdLength + 1
				)
			})
		).toBeUndefined();
	});

	it.each([
		['SugarCube', '2.37.3', 'sugarcube-2.37.3'],
		['Snowman', '1.5.0', 'snowman-1.5.0'],
		['Snowman', '2.1.1', 'snowman-2.1.1'],
		['Chapbook', '2.3.1', 'chapbook-2.3.1'],
		['Harlowe', '3.3.9', 'harlowe-3.3.9'],
		['SugarCube', '2.37.2', 'generic']
	])('selects %s %s exactly', (format, version, id) => {
		expect(selectStoryPreviewDebuggerAdapter(format, version).id).toBe(id);
	});

	it('keeps current-only format inspection best-effort and rejects prototype adapter IDs', () => {
		expect(
			selectStoryPreviewDebuggerAdapter('Harlowe', '3.3.9').reliability
		).toBe('best-effort');
		expect(
			selectStoryPreviewDebuggerAdapter('Chapbook', '2.3.1').reliability
		).toBe('best-effort');
		expect(isStoryPreviewDebuggerAdapterId('toString')).toBe(false);
		expect(isStoryPreviewDebuggerAdapterId('__proto__')).toBe(false);
	});

	it('derives every advertised collection capability from its capture handler', () => {
		for (const registration of Object.values(
			STORY_PREVIEW_DEBUGGER_ADAPTER_REGISTRATIONS
		)) {
			expect(registration.capabilities).toEqual([
				'currentPassage',
				...STORY_PREVIEW_DEBUGGER_CAPTURE_COLLECTIONS[
					registration.captureHandler
				]
			]);
		}
		expect(
			STORY_PREVIEW_DEBUGGER_ADAPTER_REGISTRATIONS['chapbook-2.3.1']
				.capabilities
		).toEqual(['currentPassage']);
	});

	it.each(Object.values(STORY_PREVIEW_DEBUGGER_ADAPTER_REGISTRATIONS))(
		'keeps $id registration and capture implementation conformant',
		registration => {
			const postMessage = jest
				.spyOn(window, 'postMessage')
				.mockImplementation(() => undefined);
			delete (window as any).SugarCube;
			delete (window as any).passage;
			delete (window as any).story;

			try {
				installInstrumentedDebugger(
					registration.format,
					registration.formatVersion,
					`conformance-${registration.id}`
				);
				(window as any).passage = {id: 1, name: 'Start'};

				if (registration.captureHandler === 'sugarcube') {
					installBundledSugarCubeState({
						history: ['Start'],
						passage: 'Start',
						temporary: {temp: true},
						variables: {score: 1}
					});
				} else if (registration.captureHandler === 'snowman') {
					(window as any).story = {
						history: [1],
						state: {score: 1}
					};
				}

				(window as any).__twineRsPreviewDebug.captureState();
				const hello = posted(postMessage, 'debugger-hello').at(-1);
				const commandHello = posted(postMessage, 'debugger-command-hello').at(
					-1
				);
				const snapshot = posted(postMessage, 'debugger-snapshot').at(-1);

				expect(hello).toMatchObject({
					adapterId: registration.id,
					capabilities: registration.capabilities,
					format: registration.format,
					formatVersion: registration.formatVersion,
					reliability: registration.reliability
				});
				if (registration.id === 'sugarcube-2.37.3') {
					expect(commandHello).toBeUndefined();
				} else {
					expect(commandHello).toMatchObject({
						adapterId: registration.id,
						commandCapabilities: ['restart'],
						protocolVersion: STORY_PREVIEW_COMMAND_PROTOCOL_VERSION
					});
				}
				expect(Object.keys(snapshot.sections)).toEqual(
					registration.capabilities
				);
				for (const capability of registration.capabilities) {
					expect(snapshot.sections[capability].state).not.toBe('unavailable');
					expect(snapshot[capability]).toBeDefined();
				}
			} finally {
				delete (window as any).SugarCube;
				delete (window as any).__twineRsSugarCubeFixture;
				delete (window as any).passage;
				delete (window as any).story;
				postMessage.mockRestore();
			}
		}
	);

	it('accepts only the canonical descriptor for format metadata', () => {
		const envelope = {
			protocolVersion: 1,
			sessionId: 'canonical-session',
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			type: 'debugger-hello' as const
		};
		const sugarCubeHello = {
			...envelope,
			adapterId: 'sugarcube-2.37.3',
			capabilities: [
				'currentPassage',
				'storyVariables',
				'temporaryVariables',
				'visitedPassages'
			],
			format: 'SugarCube',
			formatVersion: '2.37.3',
			reliability: 'exact-version'
		};

		expect(normalizeStoryPreviewBridgeMessage(sugarCubeHello)).toBeDefined();
		expect(
			normalizeStoryPreviewBridgeMessage({
				...sugarCubeHello,
				adapterId: 'generic',
				capabilities: ['currentPassage'],
				reliability: 'best-effort'
			})
		).toBeUndefined();
		expect(
			normalizeStoryPreviewBridgeMessage({
				...sugarCubeHello,
				capabilities: [
					'currentPassage',
					'temporaryVariables',
					'storyVariables',
					'visitedPassages'
				]
			})
		).toBeUndefined();
		expect(
			normalizeStoryPreviewBridgeMessage({
				...envelope,
				adapterId: 'generic',
				capabilities: ['currentPassage'],
				format: 'SugarCube',
				formatVersion: '2.37.2',
				reliability: 'best-effort'
			})
		).toMatchObject({
			adapterId: 'generic',
			format: 'SugarCube',
			formatVersion: '2.37.2'
		});

		const lookup = createStoryPreviewPassageLookup([]);
		const initial = initialStoryPreviewRuntimeModel(true);
		const poisoned = reduceStoryPreviewRuntime(initial, {
			message: {
				...sugarCubeHello,
				adapterId: 'generic',
				capabilities: ['currentPassage'],
				reliability: 'best-effort'
			} as any,
			now: 1,
			passages: lookup,
			type: 'message'
		});
		expect(poisoned).toBe(initial);
		const negotiated = reduceStoryPreviewRuntime(initial, {
			message: normalizeStoryPreviewBridgeMessage(sugarCubeHello)!,
			now: 2,
			passages: lookup,
			type: 'message'
		});
		expect(negotiated.debugger.hello?.id).toBe('sugarcube-2.37.3');
	});

	it('emits a bounded hello and snapshots late SugarCube state without invoking getters or toJSON', () => {
		document.body.innerHTML =
			'<tw-storydata format="SugarCube" format-version="2.37.3"></tw-storydata>';
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const getter = jest.fn(() => 'must not run');
		const toJSON = jest.fn(() => 'must not run');
		const variable: Record<string, unknown> = {cycle: undefined, value: 1};
		const variables: Record<string, unknown> = {
			complex: variable,
			hugeBigInt: 10n ** 100_000n
		};
		variable.cycle = variable;
		Object.defineProperty(variable, 'hidden', {get: getter});
		Object.defineProperty(variable, 'toJSON', {value: toJSON});
		Object.defineProperty(variables, 'danger', {
			enumerable: true,
			get: getter
		});
		delete (window as any).SugarCube;

		try {
			const script = /<script>([\s\S]*?)<\/script>/.exec(
				instrumentPreviewHtml(
					'<html><head></head><body></body></html>',
					'debugger'
				)
			)?.[1];
			expect(script).toBeDefined();
			window.eval(script!);
			document.dispatchEvent(new Event('DOMContentLoaded'));
			expect(posted(postMessage, 'debugger-hello')).toMatchObject([
				{adapterId: 'sugarcube-2.37.3', protocolVersion: 1}
			]);

			installBundledSugarCubeState({
				history: ['Start'],
				passage: 'Start',
				temporary: {temp: true},
				variables
			});
			(window as any).__twineRsPreviewDebug.captureState();
			const snapshot = posted(postMessage, 'debugger-snapshot').at(-1);
			expect(snapshot).toMatchObject({
				adapterId: 'sugarcube-2.37.3',
				currentPassage: {name: 'Start'},
				sections: {
					currentPassage: {state: 'complete'},
					storyVariables: {
						reasons: ['uninspectable'],
						state: 'truncated'
					},
					temporaryVariables: {state: 'complete'},
					visitedPassages: {state: 'complete'}
				},
				storyVariables: [
					{
						name: 'complex',
						type: 'object',
						preview: '[object]'
					},
					{
						name: 'hugeBigInt',
						type: 'bigint',
						preview: '[bigint]'
					}
				],
				temporaryVariables: [{name: 'temp', type: 'boolean', preview: 'true'}],
				visitedPassages: [{name: 'Start'}]
			});
			expect(debuggerSnapshotTextLength(snapshot)).toBeLessThanOrEqual(
				STORY_PREVIEW_BRIDGE_LIMITS.debuggerTotalTextLength
			);
			expect(normalizeStoryPreviewBridgeMessage(snapshot)).toBeDefined();
			expect(getter).not.toHaveBeenCalled();
			expect(toJSON).not.toHaveBeenCalled();
		} finally {
			delete (window as any).SugarCube;
			delete (window as any).__twineRsSugarCubeFixture;
			postMessage.mockRestore();
		}
	});

	it('bounds string previews after JSON escaping', () => {
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const escapedValue = '\0'.repeat(512);
		delete (window as any).SugarCube;

		try {
			installInstrumentedDebugger(
				'SugarCube',
				'2.37.3',
				'escaped-string-preview'
			);
			installBundledSugarCubeState({
				history: ['Start'],
				passage: 'Start',
				temporary: {},
				variables: {escaped: escapedValue}
			});
			(window as any).__twineRsPreviewDebug.captureState();

			const snapshot = posted(postMessage, 'debugger-snapshot').at(-1);
			const hello = normalizeStoryPreviewBridgeMessage(
				posted(postMessage, 'debugger-hello').at(-1)
			);
			const normalizedSnapshot = normalizeStoryPreviewBridgeMessage(snapshot);
			const encodedPreview = JSON.stringify(escapedValue);
			expect(encodedPreview.length).toBeGreaterThan(
				STORY_PREVIEW_BRIDGE_LIMITS.debuggerPreviewLength
			);
			expect(snapshot.storyVariables).toEqual([
				{
					name: 'escaped',
					preview: encodedPreview.slice(
						0,
						STORY_PREVIEW_BRIDGE_LIMITS.debuggerPreviewLength
					),
					type: 'string'
				}
			]);
			expect(snapshot.storyVariables[0].preview).toHaveLength(
				STORY_PREVIEW_BRIDGE_LIMITS.debuggerPreviewLength
			);
			expect(snapshot.sections.storyVariables).toEqual({
				reasons: ['field-limit'],
				state: 'truncated'
			});
			expect(debuggerSnapshotTextLength(snapshot)).toBeLessThanOrEqual(
				STORY_PREVIEW_BRIDGE_LIMITS.debuggerTotalTextLength
			);
			expect(hello).toBeDefined();
			expect(normalizedSnapshot).toBeDefined();

			const lookup = createStoryPreviewPassageLookup([]);
			const negotiated = reduceStoryPreviewRuntime(
				initialStoryPreviewRuntimeModel(true),
				{message: hello!, now: 1, passages: lookup, type: 'message'}
			);
			const captured = reduceStoryPreviewRuntime(negotiated, {
				message: normalizedSnapshot!,
				now: 2,
				passages: lookup,
				type: 'message'
			});
			expect(
				captured.debugger.snapshot?.storyVariables?.[0].preview
			).toHaveLength(STORY_PREVIEW_BRIDGE_LIMITS.debuggerPreviewLength);
		} finally {
			delete (window as any).SugarCube;
			delete (window as any).__twineRsSugarCubeFixture;
			postMessage.mockRestore();
		}
	});

	it('rejects lookalike SugarCube accessors and never reads runtime accessors or object coercions', () => {
		document.body.innerHTML =
			'<tw-storydata format="SugarCube" format-version="2.37.3"></tw-storydata>';
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const getter = jest.fn(() => 'must not run');
		const toString = jest.fn(() => 'must not run');
		delete (window as any).passage;
		delete (window as any).State;
		delete (window as any).SugarCube;

		try {
			installInstrumentedDebugger(
				'SugarCube',
				'2.37.3',
				'forged-sugarcube-accessor'
			);
			const state = Object.freeze(
				Object.defineProperties(
					{},
					{
						history: {get: getter},
						passage: {get: getter},
						temporary: {get: getter},
						variables: {get: getter}
					}
				)
			);
			(window as any).SugarCube = {State: state};
			(window as any).State = Object.defineProperty({}, 'passage', {
				get: getter
			});
			(window as any).passage = Object.defineProperties(
				{},
				{
					id: {get: getter},
					name: {get: getter},
					pid: {value: {toString}},
					title: {get: getter}
				}
			);

			(window as any).__twineRsPreviewDebug.captureState();
			const snapshot = posted(postMessage, 'debugger-snapshot').at(-1);

			expect(snapshot).toMatchObject({
				sections: {
					currentPassage: {state: 'unavailable'},
					storyVariables: {state: 'unavailable'},
					temporaryVariables: {state: 'unavailable'},
					visitedPassages: {state: 'unavailable'}
				}
			});
			expect(getter).not.toHaveBeenCalled();
			expect(toString).not.toHaveBeenCalled();
		} finally {
			delete (window as any).passage;
			delete (window as any).State;
			delete (window as any).SugarCube;
			postMessage.mockRestore();
		}
	});

	it('retains the newest Snowman history IDs in chronological order', () => {
		document.body.innerHTML =
			'<tw-storydata format="Snowman" format-version="2.1.1"></tw-storydata>';
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		delete (window as any).passage;
		delete (window as any).story;

		try {
			const script = /<script>([\s\S]*?)<\/script>/.exec(
				instrumentPreviewHtml(
					'<html><head></head><body></body></html>',
					'debugger'
				)
			)?.[1];
			expect(script).toBeDefined();
			window.eval(script!);
			document.dispatchEvent(new Event('DOMContentLoaded'));

			(window as any).passage = {id: 205, name: 'Current'};
			(window as any).story = {
				history: Array.from({length: 205}, (_, index) => index + 1),
				state: {score: 4}
			};
			(window as any).__twineRsPreviewDebug.captureState();

			const snapshot = posted(postMessage, 'debugger-snapshot').at(-1);
			expect(snapshot).toMatchObject({
				adapterId: 'snowman-2.1.1',
				sections: {
					currentPassage: {state: 'complete'},
					storyVariables: {state: 'complete'},
					visitedPassages: {
						reasons: ['item-limit'],
						state: 'truncated'
					}
				},
				storyVariables: [{name: 'score', preview: '4', type: 'number'}]
			});
			expect(snapshot.visitedPassages).toHaveLength(200);
			expect(snapshot.visitedPassages[0]).toMatchObject({localId: '6'});
			expect(snapshot.visitedPassages.at(-1)).toMatchObject({localId: '205'});
		} finally {
			delete (window as any).passage;
			delete (window as any).story;
			postMessage.mockRestore();
		}
	});

	it('reads history entries only through data descriptors', () => {
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const getter = jest.fn(() => 2);
		const history = [1, 2, 3];
		Object.defineProperty(history, '1', {enumerable: true, get: getter});
		delete (window as any).passage;
		delete (window as any).story;

		try {
			installInstrumentedDebugger('Snowman', '2.1.1', 'history-descriptors');
			(window as any).passage = {id: 3, name: 'Third'};
			(window as any).story = {history, state: {score: 4}};
			(window as any).__twineRsPreviewDebug.captureState();

			const snapshot = posted(postMessage, 'debugger-snapshot').at(-1);
			expect(snapshot.visitedPassages).toEqual([
				expect.objectContaining({localId: '1'}),
				expect.objectContaining({localId: '3'})
			]);
			expect(snapshot.sections.visitedPassages).toEqual({
				reasons: ['uninspectable'],
				state: 'truncated'
			});
			expect(getter).not.toHaveBeenCalled();
		} finally {
			delete (window as any).passage;
			delete (window as any).story;
			postMessage.mockRestore();
		}
	});

	it('does not advertise or execute Chapbook state inspection without a bounded hook', () => {
		document.body.innerHTML =
			'<tw-storydata format="Chapbook" format-version="2.3.1"></tw-storydata>';
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const accessor = jest.fn(() => {
			throw new Error('must not run');
		});
		const toJSON = jest.fn(() => {
			throw new Error('must not run');
		});
		const value: Record<string, unknown> = {huge: 'x'.repeat(1_000_000)};
		value.cycle = value;
		Object.defineProperty(value, 'accessor', {
			enumerable: true,
			get: accessor
		});
		Object.defineProperty(value, 'toJSON', {value: toJSON});
		const get = jest.fn(() => {
			return value;
		});
		const varNames = jest.fn(() =>
			Array.from({length: 10_000}, (_, index) => `variable-${index}`)
		);
		const stateGetter = jest.fn(() => ({get, varNames}));
		delete (window as any).engine;

		try {
			const script = /<script>([\s\S]*?)<\/script>/.exec(
				instrumentPreviewHtml(
					'<html><head></head><body></body></html>',
					'debugger-chapbook'
				)
			)?.[1];
			expect(script).toBeDefined();
			window.eval(script!);
			document.dispatchEvent(new Event('DOMContentLoaded'));

			const engine = {};
			Object.defineProperty(engine, 'state', {
				enumerable: true,
				get: stateGetter
			});
			(window as any).engine = engine;
			(window as any).__twineRsPreviewDebug.captureState();

			const hello = posted(postMessage, 'debugger-hello').at(-1);
			const snapshot = posted(postMessage, 'debugger-snapshot').at(-1);
			expect(hello).toMatchObject({
				adapterId: 'chapbook-2.3.1',
				capabilities: ['currentPassage'],
				reliability: 'best-effort'
			});
			expect(snapshot).toMatchObject({
				adapterId: 'chapbook-2.3.1',
				sections: {currentPassage: {state: 'unavailable'}}
			});
			expect(snapshot).not.toHaveProperty('storyVariables');
			expect(snapshot).not.toHaveProperty('visitedPassages');
			expect(stateGetter).not.toHaveBeenCalled();
			expect(varNames).not.toHaveBeenCalled();
			expect(get).not.toHaveBeenCalled();
			expect(accessor).not.toHaveBeenCalled();
			expect(toJSON).not.toHaveBeenCalled();
			expect(lastPostedState(postMessage)).toBeDefined();
		} finally {
			delete (window as any).engine;
			postMessage.mockRestore();
		}
	});

	it('applies one source-side text budget across the entire snapshot', () => {
		document.body.innerHTML =
			'<tw-storydata format="SugarCube" format-version="2.37.3"></tw-storydata>';
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const variables = Object.fromEntries(
			Array.from({length: 100}, (_, index) => [
				`variable-${index}`,
				'x'.repeat(1000)
			])
		);
		const oversizedPassageName = 'Passage'.repeat(20_000);
		delete (window as any).SugarCube;

		try {
			const script = /<script>([\s\S]*?)<\/script>/.exec(
				instrumentPreviewHtml(
					'<html><head></head><body></body></html>',
					'debugger-budget'
				)
			)?.[1];
			expect(script).toBeDefined();
			window.eval(script!);
			document.dispatchEvent(new Event('DOMContentLoaded'));

			installBundledSugarCubeState({
				history: Array(200).fill(oversizedPassageName),
				passage: oversizedPassageName,
				temporary: variables,
				variables
			});
			(window as any).__twineRsPreviewDebug.captureState();
			const snapshot = posted(postMessage, 'debugger-snapshot').at(-1);

			expect(snapshot).toBeDefined();
			expect(snapshot.currentPassage.name).toHaveLength(
				STORY_PREVIEW_BRIDGE_LIMITS.passageFieldLength
			);
			expect(snapshot.sections).toEqual({
				currentPassage: {
					reasons: ['field-limit'],
					state: 'truncated'
				},
				storyVariables: {
					reasons: ['field-limit', 'text-budget'],
					state: 'truncated'
				},
				temporaryVariables: {
					reasons: ['field-limit', 'text-budget'],
					state: 'truncated'
				},
				visitedPassages: {
					reasons: ['field-limit', 'text-budget'],
					state: 'truncated'
				}
			});
			expect(debuggerSnapshotTextLength(snapshot)).toBeLessThanOrEqual(
				STORY_PREVIEW_BRIDGE_LIMITS.debuggerTotalTextLength
			);
			expect(normalizeStoryPreviewBridgeMessage(snapshot)).toBeDefined();
			expect(
				snapshot.storyVariables.length + snapshot.temporaryVariables.length
			).toBeLessThan(200);
		} finally {
			delete (window as any).SugarCube;
			delete (window as any).__twineRsSugarCubeFixture;
			postMessage.mockRestore();
		}
	});

	it('marks variable item-limit truncation at limit plus one', () => {
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const variables = Object.fromEntries(
			Array.from(
				{length: STORY_PREVIEW_BRIDGE_LIMITS.debuggerVariableCount + 1},
				(_, index) => [`variable-${index}`, index]
			)
		);
		delete (window as any).SugarCube;

		try {
			installInstrumentedDebugger('SugarCube', '2.37.3', 'variable-count');
			installBundledSugarCubeState({
				history: [],
				passage: 'Start',
				temporary: {},
				variables
			});
			(window as any).__twineRsPreviewDebug.captureState();

			const snapshot = posted(postMessage, 'debugger-snapshot').at(-1);
			expect(snapshot.storyVariables).toHaveLength(
				STORY_PREVIEW_BRIDGE_LIMITS.debuggerVariableCount
			);
			expect(snapshot.storyVariables.at(-1).name).toBe('variable-99');
			expect(snapshot.sections.storyVariables).toEqual({
				reasons: ['item-limit'],
				state: 'truncated'
			});
		} finally {
			delete (window as any).SugarCube;
			delete (window as any).__twineRsSugarCubeFixture;
			postMessage.mockRestore();
		}
	});

	it('continues after an over-budget value so later small variables remain visible', () => {
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const variables = Object.fromEntries([
			...Array.from({length: 30}, (_, index) => [
				`large-${index}`,
				'x'.repeat(1000)
			]),
			['tailSmall', 1]
		]);
		delete (window as any).SugarCube;

		try {
			installInstrumentedDebugger('SugarCube', '2.37.3', 'variable-budget');
			installBundledSugarCubeState({
				history: [],
				passage: 'Start',
				temporary: {},
				variables
			});
			(window as any).__twineRsPreviewDebug.captureState();

			const snapshot = posted(postMessage, 'debugger-snapshot').at(-1);
			expect(snapshot.storyVariables).toContainEqual({
				name: 'tailSmall',
				preview: '1',
				type: 'number'
			});
			expect(snapshot.storyVariables.length).toBeLessThan(31);
			expect(snapshot.sections.storyVariables).toEqual({
				reasons: ['field-limit', 'text-budget'],
				state: 'truncated'
			});
		} finally {
			delete (window as any).SugarCube;
			delete (window as any).__twineRsSugarCubeFixture;
			postMessage.mockRestore();
		}
	});

	it('requires truthful canonical section status for every advertised capability', () => {
		const genericSnapshot = {
			adapterId: 'generic',
			currentPassage: {name: 'Start'},
			protocolVersion: 1,
			sections: {currentPassage: {state: 'complete'}},
			sessionId: 'section-session',
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			type: 'debugger-snapshot'
		};
		expect(normalizeStoryPreviewBridgeMessage(genericSnapshot)).toBeDefined();
		expect(
			normalizeStoryPreviewBridgeMessage({
				...genericSnapshot,
				sections: {currentPassage: {state: 'unavailable'}}
			})
		).toBeUndefined();
		expect(
			normalizeStoryPreviewBridgeMessage({
				...genericSnapshot,
				currentPassage: undefined
			})
		).toBeUndefined();
		expect(
			normalizeStoryPreviewBridgeMessage({
				...genericSnapshot,
				sections: {
					currentPassage: {state: 'complete'},
					storyVariables: {state: 'complete'}
				},
				storyVariables: []
			})
		).toBeUndefined();
		expect(
			normalizeStoryPreviewBridgeMessage({
				...genericSnapshot,
				sections: {
					currentPassage: {reasons: [], state: 'truncated'}
				}
			})
		).toBeUndefined();
		expect(
			normalizeStoryPreviewBridgeMessage({
				...genericSnapshot,
				sections: {
					currentPassage: {
						reasons: ['text-budget', 'field-limit'],
						state: 'truncated'
					}
				}
			})
		).toBeUndefined();

		const incompleteSugarCubeSnapshot = {
			...genericSnapshot,
			adapterId: 'sugarcube-2.37.3',
			sections: {
				currentPassage: {state: 'complete'},
				storyVariables: {state: 'complete'},
				temporaryVariables: {state: 'complete'}
			},
			storyVariables: [],
			temporaryVariables: []
		};
		expect(
			normalizeStoryPreviewBridgeMessage(incompleteSugarCubeSnapshot)
		).toBeUndefined();
	});

	it('rejects malformed debugger messages and only accepts matching negotiated snapshots', () => {
		const hello = normalizeStoryPreviewBridgeMessage({
			adapterId: 'sugarcube-2.37.3',
			capabilities: [
				'currentPassage',
				'storyVariables',
				'temporaryVariables',
				'visitedPassages'
			],
			format: 'SugarCube',
			formatVersion: '2.37.3',
			protocolVersion: STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION,
			reliability: 'exact-version',
			sessionId: 'session-1',
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			type: 'debugger-hello'
		});
		const snapshot = normalizeStoryPreviewBridgeMessage({
			adapterId: 'sugarcube-2.37.3',
			currentPassage: {name: 'Second'},
			protocolVersion: 1,
			sections: {
				currentPassage: {state: 'complete'},
				storyVariables: {state: 'complete'},
				temporaryVariables: {state: 'complete'},
				visitedPassages: {state: 'complete'}
			},
			sessionId: 'session-1',
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			storyVariables: [],
			temporaryVariables: [],
			type: 'debugger-snapshot',
			visitedPassages: [{name: 'Start'}, {name: 'Second'}]
		});
		expect(hello).toBeDefined();
		expect(snapshot).toBeDefined();
		expect(
			normalizeStoryPreviewBridgeMessage({
				...hello,
				capabilities: [
					'currentPassage',
					'storyVariables',
					'temporaryVariables',
					'temporaryVariables'
				]
			})
		).toBeUndefined();
		expect(
			normalizeStoryPreviewBridgeMessage({
				adapterId: 'generic',
				capabilities: ['currentPassage'],
				protocolVersion: 1,
				reliability: 'best-effort',
				sessionId: 'session-1',
				source: STORY_PREVIEW_BRIDGE_SOURCE,
				type: 'debugger-hello'
			})
		).toMatchObject({format: '', formatVersion: ''});
		expect(
			normalizeStoryPreviewBridgeMessage({
				...snapshot,
				adapterId: 'unknown',
				protocolVersion: 2
			})
		).toBeUndefined();
		expect(
			normalizeStoryPreviewBridgeMessage({
				...snapshot,
				currentPassage: {
					name: 'p'.repeat(STORY_PREVIEW_BRIDGE_LIMITS.passageFieldLength)
				},
				storyVariables: Array.from({length: 16}, (_, index) => ({
					name: `variable-${index}`,
					preview: 'x'.repeat(2000),
					type: 'string'
				}))
			})
		).toBeUndefined();
		expect(
			normalizeStoryPreviewBridgeMessage({
				...snapshot,
				storyVariables: Array(
					STORY_PREVIEW_BRIDGE_LIMITS.debuggerVariableCount + 1
				).fill({
					name: 'x',
					preview: '',
					type: 'string'
				})
			})
		).toBeUndefined();

		const lookup = createStoryPreviewPassageLookup([
			{id: 'start', localId: '1', name: 'Start'},
			{id: 'second', localId: '2', name: 'Second'}
		]);
		let model = initialStoryPreviewRuntimeModel(true);
		model = reduceStoryPreviewRuntime(model, {
			message: snapshot!,
			now: 1,
			passages: lookup,
			type: 'message'
		});
		expect(model.debugger.snapshot).toBeUndefined();
		model = reduceStoryPreviewRuntime(model, {
			message: hello!,
			now: 2,
			passages: lookup,
			type: 'message'
		});
		const negotiated = model;
		const differentHello = normalizeStoryPreviewBridgeMessage({
			adapterId: 'generic',
			capabilities: ['currentPassage'],
			protocolVersion: 1,
			reliability: 'best-effort',
			sessionId: 'session-1',
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			type: 'debugger-hello'
		});
		model = reduceStoryPreviewRuntime(model, {
			message: differentHello!,
			now: 2,
			passages: lookup,
			type: 'message'
		});
		expect(model).toBe(negotiated);
		model = reduceStoryPreviewRuntime(model, {
			message: snapshot!,
			now: 3,
			passages: lookup,
			type: 'message'
		});
		expect(model.debugger.snapshot?.currentPassage?.id).toBe('second');
		expect(model.debugger.snapshot?.visitedPassages?.[0]?.id).toBe('start');
		expect(model.debugger.snapshot?.sections.visitedPassages).toEqual({
			state: 'complete'
		});
		const snapshotted = model;
		model = reduceStoryPreviewRuntime(model, {
			message: hello!,
			now: 4,
			passages: lookup,
			type: 'message'
		});
		expect(model).toBe(snapshotted);
		expect(model.debugger.snapshot?.currentPassage?.id).toBe('second');
		expect(
			reduceStoryPreviewRuntime(initialStoryPreviewRuntimeModel(false), {
				model,
				type: 'replace'
			}).debugger
		).toEqual(model.debugger);
		expect(
			reduceStoryPreviewRuntime(model, {hasContent: true, type: 'reset'})
		).toEqual(initialStoryPreviewRuntimeModel(true));
	});
});

describe('story preview runtime state', () => {
	const passages = [
		{id: 'start-id', localId: '1', name: 'Start'},
		{id: 'second-id', localId: '2', name: 'Second'}
	];
	const lookup = createStoryPreviewPassageLookup(passages);

	it.each([
		[{id: 'second-id'}, 'second-id'],
		[{localId: '2'}, 'second-id'],
		[{name: 'Second'}, 'second-id']
	])('resolves known passage references', (runtimePassage, expectedId) => {
		expect(resolveRuntimePassage(runtimePassage, lookup)?.id).toBe(expectedId);
	});

	it('preserves unknown display identities without promoting a stable passage ID', () => {
		expect(
			resolveRuntimePassage(
				{
					id: 'forged',
					name: ' ',
					rawName: ' Runtime title ',
					source: 'runtime'
				},
				lookup
			)
		).toEqual({
			id: undefined,
			localId: undefined,
			name: '',
			rawId: 'forged',
			rawName: ' Runtime title ',
			source: 'runtime'
		});
	});

	it('caps logs while preserving newest-first ordering and stable IDs', () => {
		let model = initialStoryPreviewRuntimeModel(true);

		for (let index = 0; index < STORY_PREVIEW_RUNTIME_LOG_LIMIT + 2; index++) {
			model = reduceStoryPreviewRuntime(model, {
				message: {
					args: [`log-${index}`],
					level: 'log',
					sessionId: 'session-1',
					source: STORY_PREVIEW_BRIDGE_SOURCE,
					time: 10,
					type: 'console'
				},
				now: 10,
				passages: lookup,
				type: 'message'
			});
		}

		expect(model.logs).toHaveLength(STORY_PREVIEW_RUNTIME_LOG_LIMIT);
		expect(model.logs[0]).toMatchObject({
			id: `10:${STORY_PREVIEW_RUNTIME_LOG_LIMIT + 1}`,
			message: `log-${STORY_PREVIEW_RUNTIME_LOG_LIMIT + 1}`
		});
		expect(model.logs.at(-1)?.message).toBe('log-2');
	});

	it('orders console levels and runtime failures with the correct error tone', () => {
		let model = initialStoryPreviewRuntimeModel(true);
		const messages = [
			{args: ['plain'], level: 'log', type: 'console'},
			{args: ['details'], level: 'info', type: 'console'},
			{args: ['warning'], level: 'warn', type: 'console'},
			{args: ['console failure'], level: 'error', type: 'console'},
			{
				level: 'error',
				message: 'Unhandled rejection: rejected',
				type: 'runtime-error'
			},
			{
				level: 'error',
				message: 'Runtime error: thrown',
				type: 'runtime-error'
			}
		] as const;

		for (const [index, message] of messages.entries()) {
			const normalized = normalizeStoryPreviewBridgeMessage({
				...message,
				sessionId: 'session-1',
				source: STORY_PREVIEW_BRIDGE_SOURCE,
				time: index + 1
			});

			expect(normalized).toBeDefined();
			model = reduceStoryPreviewRuntime(model, {
				message: normalized!,
				now: index + 1,
				passages: lookup,
				type: 'message'
			});
		}

		expect(model.logs.map(log => [log.level, log.message])).toEqual([
			['error', 'Runtime error: thrown'],
			['error', 'Unhandled rejection: rejected'],
			['error', 'console failure'],
			['warn', 'warning'],
			['info', 'details'],
			['log', 'plain']
		]);
		expect(runtimeLogTone(model.logs)).toBe('error');
	});

	it('resets runtime observation and logs for a replacement or reload', () => {
		const populated = reduceStoryPreviewRuntime(
			initialStoryPreviewRuntimeModel(true),
			{
				message: {
					args: ['log'],
					level: 'warn',
					sessionId: 'session-1',
					source: STORY_PREVIEW_BRIDGE_SOURCE,
					type: 'console'
				},
				now: 10,
				passages: lookup,
				type: 'message'
			}
		);

		expect(
			reduceStoryPreviewRuntime(populated, {
				hasContent: true,
				type: 'reset'
			})
		).toEqual(initialStoryPreviewRuntimeModel(true));
	});
});
