import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within
} from '@testing-library/react';
import * as React from 'react';
import {
	instrumentPreviewHtml,
	STORY_PREVIEW_BRIDGE_SOURCE,
	STORY_PREVIEW_VIEW_TRANSITION_GUARD_SOURCE,
	storyPreviewPassages
} from '../story-preview-debug';
import {StoryPreviewFrame} from '../story-preview-frame';
import {fakePassage, fakeStory} from '../../test-util';
import {
	SUGARCUBE_COMPATIBILITY,
	sugarCubeRestartProfileForAdapter
} from '../story-preview-sugarcube';
import {HARLOWE_3_3_9_COMPATIBILITY} from '../story-preview-harlowe';

jest.mock('../story-preview-debug', () => {
	const actual = jest.requireActual<typeof import('../story-preview-debug')>(
		'../story-preview-debug'
	);

	return {
		...actual,
		instrumentPreviewHtml: jest.fn(actual.instrumentPreviewHtml)
	};
});

const actualInstrumentPreviewHtml = jest.requireActual<
	typeof import('../story-preview-debug')
>('../story-preview-debug').instrumentPreviewHtml;

class SynchronousTestMessagePort extends EventTarget {
	closed = false;
	peer?: SynchronousTestMessagePort;

	close() {
		this.closed = true;
	}

	postMessage(message: unknown) {
		if (this.closed || !this.peer || this.peer.closed) return;
		this.peer.dispatchEvent(new MessageEvent('message', {data: message}));
	}

	start() {}
}

class SynchronousTestMessageChannel {
	port1: MessagePort;
	port2: MessagePort;

	constructor() {
		const port1 = new SynchronousTestMessagePort();
		const port2 = new SynchronousTestMessagePort();

		port1.peer = port2;
		port2.peer = port1;
		this.port1 = port1 as unknown as MessagePort;
		this.port2 = port2 as unknown as MessagePort;
	}
}

const nativeTestMessageChannel = globalThis.MessageChannel;
const nativeTestWindowPostMessage = window.postMessage;
let harloweDocumentPorts = new WeakMap<Window, MessagePort>();

beforeAll(() => {
	Object.defineProperty(globalThis, 'MessageChannel', {
		configurable: true,
		value: SynchronousTestMessageChannel,
		writable: true
	});
	Object.defineProperty(window, 'postMessage', {
		configurable: true,
		value: function (
			this: Window,
			message: unknown,
			targetOriginOrOptions?: string | WindowPostMessageOptions,
			transfer?: Transferable[]
		) {
			if (transfer?.length) {
				const event = new MessageEvent('message', {
					data: message,
					source: window
				});

				Object.defineProperty(event, 'ports', {value: transfer});
				this.dispatchEvent(event);
				return;
			}

			return Reflect.apply(nativeTestWindowPostMessage, this, [
				message,
				targetOriginOrOptions
			]);
		},
		writable: true
	});
});

afterAll(() => {
	Object.defineProperty(globalThis, 'MessageChannel', {
		configurable: true,
		value: nativeTestMessageChannel,
		writable: true
	});
	Object.defineProperty(window, 'postMessage', {
		configurable: true,
		value: nativeTestWindowPostMessage,
		writable: true
	});
});

beforeEach(() => {
	harloweDocumentPorts = new WeakMap();
	jest
		.mocked(instrumentPreviewHtml)
		.mockImplementation(actualInstrumentPreviewHtml);
});

function sugarCubeAdmission(version = '2.37.3') {
	const compatibility = SUGARCUBE_COMPATIBILITY.find(
		entry => entry.version === version
	)!;

	return {
		adapterId: compatibility.adapterId,
		format: 'SugarCube' as const,
		kind: 'builtin-sha256' as const,
		sourceSha256: compatibility.sourceSha256,
		version: compatibility.version
	};
}

function harloweAdmission() {
	return {
		adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
		format: 'Harlowe' as const,
		kind: 'builtin-sha256' as const,
		sourceSha256: HARLOWE_3_3_9_COMPATIBILITY.sourceSha256,
		version: HARLOWE_3_3_9_COMPATIBILITY.version
	};
}

function restartEligibleSugarCubeHtml(version = '2.37.3') {
	const admission = sugarCubeAdmission(version);
	const profile = sugarCubeRestartProfileForAdapter(admission.adapterId)!;

	return `<html><head></head><body><tw-storydata format="SugarCube" format-version="${version}"></tw-storydata><script id="script-sugarcube">${profile.startupFragment};const nativeRestart=${profile.engineRestartSource};</script></body></html>`;
}

function sessionIdFromFrame(title: string) {
	const srcDoc = screen.getByTitle(title).getAttribute('srcdoc') ?? '';
	const match = srcDoc.match(/var SESSION = "([^"]+)"/);

	if (!match) {
		throw new Error('Could not read preview bridge session ID.');
	}

	return match[1];
}

function postBridgeMessage(
	title: string,
	sessionId: string,
	data: Record<string, unknown>,
	source: MessageEventSource | null = (
		screen.getByTitle(title) as HTMLIFrameElement
	).contentWindow
) {
	act(() => {
		window.dispatchEvent(
			new MessageEvent('message', {
				data: {
					source: STORY_PREVIEW_BRIDGE_SOURCE,
					sessionId,
					time: 10,
					...data
				},
				source
			})
		);
	});
}

async function captureHarloweBootstrapChallenge(
	title: string,
	trigger: () => void
) {
	const bootstrapChallenge = captureHarloweBootstrapChallengeSynchronously(
		title,
		trigger
	);

	await waitFor(() => expect(bootstrapChallenge).toMatch(/^[0-9a-f]{64}$/));
	return bootstrapChallenge!;
}

function captureHarloweBootstrapChallengeSynchronously(
	title: string,
	trigger: () => void
) {
	const frame = screen.getByTitle(title) as HTMLIFrameElement;
	const frameWindow = frame.contentWindow!;
	let bootstrapChallenge: string | undefined;
	const captureChallenge = (event: MessageEvent) => {
		if (
			event.data?.source === 'twine.rs.preview.host-command' &&
			event.data?.type === 'debugger-bootstrap-challenge'
		) {
			bootstrapChallenge = event.data.bootstrapChallenge;
		}
	};
	const capturePort = (event: MessageEvent) => {
		if (
			event.data?.source !== 'twine.rs.preview.host-command' ||
			event.data?.type !== 'debugger-bootstrap-port' ||
			event.ports.length !== 1
		) {
			return;
		}
		const [port] = event.ports;

		harloweDocumentPorts.set(frameWindow, port);
		port.addEventListener('message', captureChallenge);
		port.start();
	};
	const existingPort = harloweDocumentPorts.get(frameWindow);

	existingPort?.addEventListener('message', captureChallenge);
	frameWindow.addEventListener('message', capturePort);
	trigger();
	existingPort?.removeEventListener('message', captureChallenge);
	frameWindow.removeEventListener('message', capturePort);
	harloweDocumentPorts
		.get(frameWindow)
		?.removeEventListener('message', captureChallenge);

	return bootstrapChallenge;
}

async function armHarloweBootstrap(title: string, sessionId: string) {
	return captureHarloweBootstrapChallenge(title, () => {
		postBridgeMessage(title, sessionId, {
			adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
			protocolVersion: 1,
			type: 'debugger-bootstrap-arm'
		});
	});
}

function postHarloweReadiness(
	title: string,
	sessionId: string,
	bootstrapChallenge: string,
	source?: MessageEventSource | null,
	wrapAct = true
) {
	const frameWindow = (screen.getByTitle(title) as HTMLIFrameElement)
		.contentWindow;
	const readinessSource = source === undefined ? frameWindow : source;
	const port =
		readinessSource === frameWindow && frameWindow
			? harloweDocumentPorts.get(frameWindow)
			: undefined;

	if (port) {
		const send = () => {
			port.postMessage({
				adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
				bootstrapChallenge,
				protocolVersion: 1,
				sessionId,
				source: STORY_PREVIEW_BRIDGE_SOURCE,
				time: 10,
				type: 'debugger-bootstrap-ready'
			});
		};

		if (wrapAct) act(send);
		else send();
		return;
	}

	postBridgeMessage(
		title,
		sessionId,
		{
			adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
			bootstrapChallenge,
			protocolVersion: 1,
			type: 'debugger-bootstrap-ready'
		},
		source
	);
}

function destroyHarloweDocumentPort(frame: HTMLIFrameElement) {
	const frameWindow = frame.contentWindow;

	if (!frameWindow) return undefined;
	const documentPort = harloweDocumentPorts.get(frameWindow);
	const parentPort = (
		documentPort as unknown as SynchronousTestMessagePort | undefined
	)?.peer;

	documentPort?.close();
	harloweDocumentPorts.delete(frameWindow);
	return (sessionId: string, bootstrapChallenge: string) => {
		act(() => {
			parentPort?.dispatchEvent(
				new MessageEvent('message', {
					data: {
						adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
						bootstrapChallenge,
						protocolVersion: 1,
						sessionId,
						source: STORY_PREVIEW_BRIDGE_SOURCE,
						time: 10,
						type: 'debugger-bootstrap-ready'
					}
				})
			);
		});
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(promiseResolve => {
		resolve = promiseResolve;
	});

	return {promise, resolve};
}

function negotiateSugarCubeRestart(
	title: string,
	sessionId: string,
	version = '2.37.3'
) {
	postBridgeMessage(title, sessionId, {
		adapterId: `sugarcube-${version}`,
		capabilities: [
			'currentPassage',
			'storyVariables',
			'temporaryVariables',
			'visitedPassages'
		],
		format: 'SugarCube',
		formatVersion: version,
		protocolVersion: 1,
		reliability: 'exact-version',
		type: 'debugger-hello'
	});
	postBridgeMessage(title, sessionId, {
		adapterId: `sugarcube-${version}`,
		commandCapabilities: ['restart'],
		protocolVersion: 1,
		type: 'debugger-command-hello'
	});
}

describe('instrumentPreviewHtml()', () => {
	it('injects the preview bridge into an HTML head', () => {
		const html =
			'<html><head><title>Story</title></head><body>Story</body></html>';
		const result = instrumentPreviewHtml(html, 'session-1');

		expect(result.html.indexOf('<script>')).toBeGreaterThan(
			result.html.indexOf('<head>')
		);
		expect(result.html.indexOf('<script>')).toBeLessThan(
			result.html.indexOf('<title>')
		);
		expect(result.html).toContain('twine.rs.preview.bridge');
		expect(result.html).toContain('var SESSION = "session-1"');
		expect(result.html).toContain("['log', 'info', 'warn', 'error']");
		expect(result.html).toContain("window.addEventListener('error'");
		expect(result.html).toContain(
			"window.addEventListener('unhandledrejection'"
		);
		expect(result.html).toContain("storage.getItem('Saved Session')");
		expect(result.html).toContain(
			'var ENABLE_HARLOWE_SESSION_STORAGE_FALLBACK = false'
		);
		expect(result.html).toContain("'Harlowe session'");
		expect(result.html).toContain('<body>Story</body>');
	});

	it('observes nonfatal view-transition readiness failures', () => {
		const catchReady = jest.fn<void, [(error: unknown) => void]>();
		const transition = {ready: {catch: catchReady}};
		const startViewTransition = jest.fn<
			typeof transition,
			[update?: () => void]
		>(() => transition);
		const previewDocument = {startViewTransition};

		Function(
			'document',
			STORY_PREVIEW_VIEW_TRANSITION_GUARD_SOURCE
		)(previewDocument);
		const update = jest.fn();

		expect(previewDocument.startViewTransition(update)).toBe(transition);
		expect(startViewTransition).toHaveBeenCalledWith(update);
		expect(catchReady).toHaveBeenCalledWith(expect.any(Function));
		const handleReadinessError = catchReady.mock.calls[0][0];

		expect(
			handleReadinessError({
				message: 'Transition was aborted because of timeout in DOM update',
				name: 'TimeoutError'
			})
		).toBe(undefined);
		expect(() =>
			handleReadinessError(new Error('story update failed'))
		).toThrow('story update failed');
	});
});

describe('<StoryPreviewFrame>', () => {
	it('keeps expensive srcDoc instrumentation stable across runtime renders and semantic clones', () => {
		const instrumentPreviewHtmlMock = jest.mocked(instrumentPreviewHtml);
		const html = restartEligibleSugarCubeHtml();
		const source = {
			admission: sugarCubeAdmission(),
			bridgeSessionId: 'stable-instrumentation-session',
			generation: 1,
			html,
			sugarCubeRestartEligible: true,
			type: 'srcDoc' as const
		};
		const props = {
			missingStoryMessage: 'Missing story',
			storyExists: true,
			title: 'Stable instrumentation preview'
		};

		instrumentPreviewHtmlMock.mockClear();
		const {rerender} = render(
			<StoryPreviewFrame {...props} contentSource={source} />
		);
		expect(instrumentPreviewHtmlMock).toHaveBeenCalledTimes(1);

		postBridgeMessage(props.title, source.bridgeSessionId, {
			args: ['runtime log'],
			level: 'log',
			type: 'console'
		});
		postBridgeMessage(props.title, source.bridgeSessionId, {
			currentPassage: {localId: '1', source: 'runtime'},
			type: 'state',
			viewport: {height: 640, width: 960}
		});
		expect(instrumentPreviewHtmlMock).toHaveBeenCalledTimes(1);

		rerender(
			<StoryPreviewFrame
				{...props}
				contentSource={{
					...source,
					admission: {...source.admission}
				}}
			/>
		);
		expect(instrumentPreviewHtmlMock).toHaveBeenCalledTimes(1);

		rerender(
			<StoryPreviewFrame
				{...props}
				contentSource={{...source, admission: {...source.admission}}}
				stagedContentSource={{
					admission: sugarCubeAdmission(),
					bridgeSessionId: 'candidate-session',
					generation: 2,
					htmlBytes: 100,
					storyDataCount: 1,
					sugarCubeRestartEligible: true,
					type: 'url',
					url: 'twine-preview://candidate/index.html'
				}}
				stagedTitle="Stable instrumentation candidate"
			/>
		);
		postBridgeMessage('Stable instrumentation candidate', 'candidate-session', {
			args: ['candidate log'],
			level: 'warn',
			type: 'console'
		});
		expect(instrumentPreviewHtmlMock).toHaveBeenCalledTimes(1);

		rerender(
			<StoryPreviewFrame
				{...props}
				contentSource={{...source, generation: 2}}
			/>
		);
		expect(instrumentPreviewHtmlMock).toHaveBeenCalledTimes(2);

		rerender(
			<StoryPreviewFrame
				{...props}
				contentSource={{
					...source,
					generation: 2,
					sugarCubeRestartEligible: false
				}}
			/>
		);
		expect(instrumentPreviewHtmlMock).toHaveBeenCalledTimes(3);

		rerender(
			<StoryPreviewFrame
				{...props}
				contentSource={{
					...source,
					admission: sugarCubeAdmission('2.36.0'),
					generation: 2,
					sugarCubeRestartEligible: false
				}}
			/>
		);
		expect(instrumentPreviewHtmlMock).toHaveBeenCalledTimes(4);

		rerender(
			<StoryPreviewFrame
				{...props}
				contentSource={{
					...source,
					admission: sugarCubeAdmission('2.36.0'),
					generation: 2,
					html: restartEligibleSugarCubeHtml('2.36.0'),
					sugarCubeRestartEligible: false
				}}
			/>
		);
		expect(instrumentPreviewHtmlMock).toHaveBeenCalledTimes(5);
	});

	it('restarts a negotiated exact runtime with one controlled remount', async () => {
		render(
			<StoryPreviewFrame
				admission={sugarCubeAdmission()}
				html={restartEligibleSugarCubeHtml()}
				missingStoryMessage="Missing story"
				previewTarget="test"
				storyExists
				title="Restart preview"
			/>
		);
		const frame = screen.getByTitle('Restart preview') as HTMLIFrameElement;
		const sessionId = sessionIdFromFrame('Restart preview');
		const postMessage = jest.spyOn(frame.contentWindow!, 'postMessage');

		postBridgeMessage('Restart preview', sessionId, {
			adapterId: 'sugarcube-2.37.3',
			capabilities: [
				'currentPassage',
				'storyVariables',
				'temporaryVariables',
				'visitedPassages'
			],
			format: 'SugarCube',
			formatVersion: '2.37.3',
			protocolVersion: 1,
			reliability: 'exact-version',
			type: 'debugger-hello'
		});
		postBridgeMessage('Restart preview', sessionId, {
			adapterId: 'sugarcube-2.37.3',
			commandCapabilities: ['restart'],
			protocolVersion: 1,
			type: 'debugger-command-hello'
		});
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		fireEvent.click(screen.getByRole('button', {name: 'Restart'}));

		expect(postMessage).toHaveBeenCalledTimes(1);
		const request = postMessage.mock.calls[0][0] as Record<string, unknown>;
		expect(request).toMatchObject({
			adapterId: 'sugarcube-2.37.3',
			command: 'restart',
			protocolVersion: 1,
			sessionId,
			source: 'twine.rs.preview.host-command'
		});
		expect(frame.name).toContain(`twine-rs-restart:${sessionId}:`);

		postBridgeMessage(
			'Restart preview',
			sessionId,
			{
				adapterId: 'sugarcube-2.37.3',
				command: 'restart',
				protocolVersion: 1,
				requestId: request.requestId,
				status: 'applied',
				type: 'debugger-command-result'
			},
			frame.contentWindow
		);

		await waitFor(() =>
			expect(screen.getByTitle('Restart preview')).not.toBe(frame)
		);
		const remountedFrame = screen.getByTitle(
			'Restart preview'
		) as HTMLIFrameElement;

		expect(remountedFrame.name).toBe('');
		expect(
			screen.getByText('Story restarted from its launch passage.')
		).toBeInTheDocument();
		expect(screen.getByRole('button', {name: 'Debugger'})).toHaveAttribute(
			'aria-expanded',
			'true'
		);
	});

	it.each([
		['failed', 'Restart failed before changing the runtime.'],
		['unavailable', 'Restart is no longer available for this runtime.']
	] as const)(
		'keeps the frame mounted when Restart reports %s',
		async (status, notice) => {
			render(
				<StoryPreviewFrame
					admission={sugarCubeAdmission()}
					html={restartEligibleSugarCubeHtml()}
					missingStoryMessage="Missing story"
					previewTarget="test"
					storyExists
					title="Restart failure preview"
				/>
			);
			const frame = screen.getByTitle(
				'Restart failure preview'
			) as HTMLIFrameElement;
			const sessionId = sessionIdFromFrame('Restart failure preview');
			const postMessage = jest.spyOn(frame.contentWindow!, 'postMessage');

			negotiateSugarCubeRestart('Restart failure preview', sessionId);
			fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
			fireEvent.click(screen.getByRole('button', {name: 'Restart'}));
			const request = postMessage.mock.calls[0][0] as Record<string, unknown>;

			postBridgeMessage(
				'Restart failure preview',
				sessionId,
				{
					adapterId: 'sugarcube-2.37.3',
					command: 'restart',
					protocolVersion: 1,
					requestId: request.requestId,
					status,
					type: 'debugger-command-result'
				},
				frame.contentWindow
			);

			expect(screen.getByTitle('Restart failure preview')).toBe(frame);
			expect(frame.name).toBe('');
			expect(screen.getByText(notice)).toBeInTheDocument();

			postBridgeMessage(
				'Restart failure preview',
				sessionId,
				{
					adapterId: 'sugarcube-2.37.3',
					command: 'restart',
					protocolVersion: 1,
					requestId: request.requestId,
					status: 'applied',
					type: 'debugger-command-result'
				},
				frame.contentWindow
			);
			expect(screen.getByTitle('Restart failure preview')).toBe(frame);
		}
	);

	it('remounts on indeterminate Restart and ignores wrong or late results', async () => {
		jest.useFakeTimers();
		try {
			render(
				<StoryPreviewFrame
					admission={sugarCubeAdmission()}
					html={restartEligibleSugarCubeHtml()}
					missingStoryMessage="Missing story"
					previewTarget="test"
					storyExists
					title="Indeterminate Restart preview"
				/>
			);
			const frame = screen.getByTitle(
				'Indeterminate Restart preview'
			) as HTMLIFrameElement;
			const sessionId = sessionIdFromFrame('Indeterminate Restart preview');
			const postMessage = jest.spyOn(frame.contentWindow!, 'postMessage');

			negotiateSugarCubeRestart('Indeterminate Restart preview', sessionId);
			fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
			fireEvent.click(screen.getByRole('button', {name: 'Restart'}));
			const request = postMessage.mock.calls[0][0] as Record<string, unknown>;
			const result = {
				adapterId: 'sugarcube-2.37.3',
				command: 'restart',
				protocolVersion: 1,
				requestId: request.requestId,
				status: 'indeterminate',
				type: 'debugger-command-result'
			};

			postBridgeMessage(
				'Indeterminate Restart preview',
				'wrong-session',
				result,
				frame.contentWindow
			);
			postBridgeMessage(
				'Indeterminate Restart preview',
				sessionId,
				{...result, requestId: 'wrong-request'},
				frame.contentWindow
			);
			expect(screen.getByTitle('Indeterminate Restart preview')).toBe(frame);

			postBridgeMessage(
				'Indeterminate Restart preview',
				sessionId,
				result,
				frame.contentWindow
			);
			const remounted = screen.getByTitle('Indeterminate Restart preview');

			expect(remounted).not.toBe(frame);
			fireEvent.load(remounted);
			expect(
				screen.getByText(
					'Restart could not be confirmed. The current artifact was remounted.'
				)
			).toBeInTheDocument();
			postBridgeMessage(
				'Indeterminate Restart preview',
				sessionId,
				{...result, status: 'applied'},
				frame.contentWindow
			);
			expect(screen.getByTitle('Indeterminate Restart preview')).toBe(
				remounted
			);
		} finally {
			jest.useRealTimers();
		}
	});

	it('remounts after an unanswered Restart timeout', () => {
		jest.useFakeTimers();
		try {
			render(
				<StoryPreviewFrame
					admission={sugarCubeAdmission()}
					html={restartEligibleSugarCubeHtml()}
					missingStoryMessage="Missing story"
					previewTarget="test"
					storyExists
					title="Restart timeout preview"
				/>
			);
			const frame = screen.getByTitle('Restart timeout preview');
			const sessionId = sessionIdFromFrame('Restart timeout preview');

			negotiateSugarCubeRestart('Restart timeout preview', sessionId);
			fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
			fireEvent.click(screen.getByRole('button', {name: 'Restart'}));
			act(() => jest.advanceTimersByTime(1999));
			expect(screen.getByTitle('Restart timeout preview')).toBe(frame);
			act(() => jest.advanceTimersByTime(1));
			const remounted = screen.getByTitle('Restart timeout preview');

			expect(remounted).not.toBe(frame);
			fireEvent.load(remounted);
			expect(
				screen.getByText(
					'Restart timed out. The current artifact was remounted as a precaution.'
				)
			).toBeInTheDocument();
		} finally {
			jest.useRealTimers();
		}
	});

	it('cancels a pending Restart when the preview generation changes', () => {
		const source = {
			admission: sugarCubeAdmission(),
			bridgeSessionId: 'generation-session',
			generation: 1,
			htmlBytes: 123,
			storyDataCount: 1,
			sugarCubeRestartEligible: true,
			type: 'url' as const,
			url: 'twine-preview://generation/index.html'
		};
		const {rerender} = render(
			<StoryPreviewFrame
				contentSource={source}
				missingStoryMessage="Missing story"
				previewTarget="test"
				storyExists
				title="Generation Restart preview"
			/>
		);
		const oldFrame = screen.getByTitle(
			'Generation Restart preview'
		) as HTMLIFrameElement;
		const postMessage = jest.spyOn(oldFrame.contentWindow!, 'postMessage');

		negotiateSugarCubeRestart(
			'Generation Restart preview',
			'generation-session'
		);
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		fireEvent.click(screen.getByRole('button', {name: 'Restart'}));
		const request = postMessage.mock.calls[0][0] as Record<string, unknown>;

		rerender(
			<StoryPreviewFrame
				contentSource={{...source, generation: 2}}
				missingStoryMessage="Missing story"
				previewTarget="test"
				storyExists
				title="Generation Restart preview"
			/>
		);
		const newFrame = screen.getByTitle('Generation Restart preview');

		expect(newFrame).toBe(oldFrame);
		postBridgeMessage(
			'Generation Restart preview',
			'generation-session',
			{
				adapterId: 'sugarcube-2.37.3',
				command: 'restart',
				protocolVersion: 1,
				requestId: request.requestId,
				status: 'applied',
				type: 'debugger-command-result'
			},
			oldFrame.contentWindow
		);
		expect(screen.getByTitle('Generation Restart preview')).toBe(newFrame);
		expect(
			screen.queryByText('Story restarted from its launch passage.')
		).not.toBeInTheDocument();
	});

	it('confirms Clear State and remounts an opaque browser preview', async () => {
		render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing story"
				previewTarget="play"
				storyExists
				title="Clear browser preview"
			/>
		);
		const frame = screen.getByTitle('Clear browser preview');

		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		fireEvent.click(screen.getByRole('button', {name: 'Clear State'}));
		const dialog = await screen.findByRole('dialog', {
			name: 'Clear all stored runtime data and cookies for this preview? Saved progress and format preferences in this preview will be removed. Other previews are not affected.'
		});
		fireEvent.click(within(dialog).getByRole('button', {name: 'Clear State'}));

		await waitFor(() =>
			expect(screen.getByTitle('Clear browser preview')).not.toBe(frame)
		);
		expect(screen.getByText('Story state cleared.')).toBeInTheDocument();
	});

	it('cancels a begin that resolves after preview identity changes and permits another clear', async () => {
		const firstOperation = {
			generation: 1,
			operationId: 'clear-first',
			url: 'twine-preview://first/__twine-preview-clear-state/first'
		};
		const secondOperation = {
			generation: 2,
			operationId: 'clear-second',
			url: 'twine-preview://second/__twine-preview-clear-state/second'
		};
		const firstBegin = deferred<typeof firstOperation>();
		const onBeginClearState = jest
			.fn()
			.mockReturnValueOnce(firstBegin.promise)
			.mockResolvedValueOnce(secondOperation);
		const onCancelClearState = jest.fn().mockResolvedValue(undefined);
		const onCompleteClearState = jest.fn().mockResolvedValue(undefined);
		const props = {
			missingStoryMessage: 'Missing story',
			onBeginClearState,
			onCancelClearState,
			onCompleteClearState,
			previewTarget: 'play' as const,
			storyExists: true,
			title: 'Identity clear preview'
		};
		const {rerender} = render(
			<StoryPreviewFrame {...props} html="<html><body>First</body></html>" />
		);

		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		fireEvent.click(screen.getByRole('button', {name: 'Clear State'}));
		const firstConfirm = within(await screen.findByRole('dialog')).getByRole(
			'button',
			{name: 'Clear State'}
		);
		fireEvent.click(firstConfirm);
		rerender(
			<StoryPreviewFrame {...props} html="<html><body>Second</body></html>" />
		);
		await act(async () => {
			firstBegin.resolve(firstOperation);
			await firstBegin.promise;
		});
		await waitFor(() =>
			expect(onCancelClearState).toHaveBeenCalledWith(firstOperation)
		);
		expect(onCancelClearState).toHaveBeenCalledTimes(1);
		expect(onCompleteClearState).not.toHaveBeenCalled();
		expect(
			screen.queryByText(
				'Clear State could not be fully confirmed. The current artifact was remounted.'
			)
		).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		fireEvent.click(screen.getByRole('button', {name: 'Clear State'}));
		fireEvent.click(
			within(await screen.findByRole('dialog')).getByRole('button', {
				name: 'Clear State'
			})
		);
		const cleanupFrame = (await screen.findByTitle(
			'Clearing preview state'
		)) as HTMLIFrameElement;

		act(() => {
			window.dispatchEvent(
				new MessageEvent('message', {
					data: {
						operationId: secondOperation.operationId,
						type: 'twine-preview-state-cleared'
					},
					source: cleanupFrame.contentWindow
				})
			);
		});
		await waitFor(() =>
			expect(onCompleteClearState).toHaveBeenCalledWith(secondOperation)
		);
		expect(onBeginClearState).toHaveBeenCalledTimes(2);
		expect(onCancelClearState).toHaveBeenCalledTimes(1);
	});

	it('does not expose Runtime Controls in Proof', () => {
		render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing story"
				previewTarget="proof"
				storyExists
				title="Proof preview"
			/>
		);

		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		expect(screen.queryByText('Runtime Controls')).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: 'Clear State'})
		).not.toBeInTheDocument();
	});

	it('keeps a copy operation pending and suppresses stale feedback after log changes', async () => {
		let resolveCopy!: () => void;
		const onCopyRuntimeLog = jest.fn(
			() => new Promise<void>(resolve => (resolveCopy = resolve))
		);
		render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing story"
				onCopyRuntimeLog={onCopyRuntimeLog}
				storyExists
				title="Copy race preview"
			/>
		);
		const sessionId = sessionIdFromFrame('Copy race preview');
		postBridgeMessage('Copy race preview', sessionId, {
			args: ['A'],
			level: 'log',
			type: 'console'
		});
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		const copy = screen.getByRole('button', {name: 'Copy Runtime Log'});
		fireEvent.click(copy);
		fireEvent.click(copy);
		await waitFor(() => expect(onCopyRuntimeLog).toHaveBeenCalledTimes(1));
		expect(copy).toBeDisabled();
		postBridgeMessage('Copy race preview', sessionId, {
			args: ['B'],
			level: 'error',
			type: 'console'
		});
		expect(copy).toBeDisabled();
		await act(async () => resolveCopy());
		expect(screen.queryByText('Runtime log copied.')).not.toBeInTheDocument();
		expect(copy).not.toBeDisabled();
	});

	it('disables unsupported copy and reports current write failures', async () => {
		const onCopyRuntimeLog = jest.fn().mockRejectedValue(new Error('denied'));
		const {rerender} = render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing"
				storyExists
				title="Copy failure preview"
			/>
		);
		const sessionId = sessionIdFromFrame('Copy failure preview');
		postBridgeMessage('Copy failure preview', sessionId, {
			args: ['A'],
			level: 'log',
			type: 'console'
		});
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		expect(
			screen.getByRole('button', {name: 'Copy Runtime Log'})
		).toBeDisabled();
		rerender(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing"
				onCopyRuntimeLog={onCopyRuntimeLog}
				storyExists
				title="Copy failure preview"
			/>
		);
		fireEvent.click(screen.getByRole('button', {name: 'Copy Runtime Log'}));
		await waitFor(() =>
			expect(
				screen.getByText('Could not copy runtime log.')
			).toBeInTheDocument()
		);
	});

	it('suppresses stale copy rejection after reload', async () => {
		let rejectCopy!: (error: Error) => void;
		const onCopyRuntimeLog = jest.fn(
			() => new Promise<void>((_, reject) => (rejectCopy = reject))
		);
		render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing"
				onCopyRuntimeLog={onCopyRuntimeLog}
				storyExists
				title="Copy rejection preview"
			/>
		);
		const sessionId = sessionIdFromFrame('Copy rejection preview');
		postBridgeMessage('Copy rejection preview', sessionId, {
			args: ['A'],
			level: 'log',
			type: 'console'
		});
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		fireEvent.click(screen.getByRole('button', {name: 'Copy Runtime Log'}));
		await waitFor(() => expect(onCopyRuntimeLog).toHaveBeenCalledTimes(1));
		fireEvent.click(screen.getByRole('button', {name: 'Reload'}));
		await act(async () => rejectCopy(new Error('denied')));
		expect(
			screen.queryByText('Could not copy runtime log.')
		).not.toBeInTheDocument();
	});

	it('renders the pre-negotiation console safely and copies the current buffer exactly', async () => {
		const onCopyRuntimeLog = jest.fn().mockResolvedValue(undefined);
		render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing"
				onCopyRuntimeLog={onCopyRuntimeLog}
				storyExists
				title="Console preview"
			/>
		);
		const sessionId = sessionIdFromFrame('Console preview');
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		const inspector = screen.getByRole('region', {
			name: 'Runtime debugger inspector'
		});
		expect(inspector).toHaveTextContent(
			'Waiting for debugger adapter negotiation.'
		);
		expect(
			screen.getByRole('button', {name: 'Copy Runtime Log'})
		).toBeDisabled();
		postBridgeMessage('Console preview', sessionId, {
			args: ['<b>old</b>'],
			level: 'info',
			type: 'console'
		});
		postBridgeMessage('Console preview', sessionId, {
			args: ['new'],
			level: 'warn',
			type: 'console'
		});
		expect(inspector.querySelector('b')).toBeNull();
		expect(within(inspector).getByText('<b>old</b>')).toBeInTheDocument();
		expect(within(inspector).getByText('Warning')).toBeInTheDocument();
		expect(within(inspector).getByText('Info')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', {name: 'Copy Runtime Log'}));
		await waitFor(() =>
			expect(onCopyRuntimeLog).toHaveBeenCalledWith(
				'[1970-01-01T00:00:00.010Z] WARNING: "new"\n[1970-01-01T00:00:00.010Z] INFO: "<b>old</b>"'
			)
		);
		await waitFor(() =>
			expect(screen.getByText('Runtime log copied.')).toBeInTheDocument()
		);
	});

	it('shows failure for a synchronously throwing copy callback', async () => {
		const onCopyRuntimeLog = jest.fn(() => {
			throw new Error('denied');
		});
		render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing"
				onCopyRuntimeLog={onCopyRuntimeLog}
				storyExists
				title="Sync copy failure"
			/>
		);
		const sessionId = sessionIdFromFrame('Sync copy failure');
		postBridgeMessage('Sync copy failure', sessionId, {
			args: ['A'],
			level: 'log',
			type: 'console'
		});
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		fireEvent.click(screen.getByRole('button', {name: 'Copy Runtime Log'}));
		await waitFor(() =>
			expect(
				screen.getByText('Could not copy runtime log.')
			).toBeInTheDocument()
		);
	});

	it('suppresses stale rejection for A after a nonempty B buffer replaces it', async () => {
		let rejectCopy!: (error: Error) => void;
		const onCopyRuntimeLog = jest.fn(
			() => new Promise<void>((_, reject) => (rejectCopy = reject))
		);
		render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing"
				onCopyRuntimeLog={onCopyRuntimeLog}
				storyExists
				title="Copy rejection B"
			/>
		);
		const sessionId = sessionIdFromFrame('Copy rejection B');
		postBridgeMessage('Copy rejection B', sessionId, {
			args: ['A'],
			level: 'log',
			type: 'console'
		});
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		const copy = screen.getByRole('button', {name: 'Copy Runtime Log'});
		fireEvent.click(copy);
		await waitFor(() => expect(onCopyRuntimeLog).toHaveBeenCalledTimes(1));
		postBridgeMessage('Copy rejection B', sessionId, {
			args: ['B'],
			level: 'error',
			type: 'console'
		});
		await act(async () => rejectCopy(new Error('denied')));
		expect(
			screen.queryByText('Could not copy runtime log.')
		).not.toBeInTheDocument();
		expect(copy).not.toBeDisabled();
		expect(screen.getAllByText('B')).toHaveLength(2);
	});
	it('isolates story code from the application origin', () => {
		render(
			<StoryPreviewFrame
				html="<html><body><script>parent.twineElectron?.loadStories()</script></body></html>"
				missingStoryMessage="Missing story"
				storyExists
				title="Isolated preview"
			/>
		);

		const frame = screen.getByTitle('Isolated preview');

		expect(frame).toHaveAttribute(
			'sandbox',
			'allow-downloads allow-forms allow-modals allow-popups allow-scripts'
		);
		expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
	});

	it('hosts an explicit desktop URL without discovering the general bridge', () => {
		const registerStoryPreview = jest.fn();
		const releaseStoryPreview = jest.fn();
		const url =
			'twine-preview://6b5df370-33a7-42c5-8ee9-c4b06470ff40/index.html';

		(window as any).twineElectron = {registerStoryPreview, releaseStoryPreview};
		render(
			<StoryPreviewFrame
				contentSource={{
					bridgeSessionId: 'desktop-session',
					htmlBytes: 123,
					storyDataCount: 1,
					type: 'url',
					url
				}}
				missingStoryMessage="Missing story"
				storyExists
				title="Desktop preview"
			/>
		);
		const frame = screen.getByTitle('Desktop preview');

		expect(registerStoryPreview).not.toHaveBeenCalled();
		expect(releaseStoryPreview).not.toHaveBeenCalled();
		expect(frame).toHaveAttribute('src', url);
		expect(frame).not.toHaveAttribute('srcdoc');
		expect(frame.getAttribute('sandbox')).toContain('allow-same-origin');
		expect(
			screen.getByText('123 bytes · 1 story-data element')
		).toBeInTheDocument();

		delete (window as any).twineElectron;
	});

	it('installs the runtime message listener before assigning frame content', () => {
		const addEventListener = jest.spyOn(window, 'addEventListener');

		render(
			<StoryPreviewFrame
				html="<html><head></head><body>Startup</body></html>"
				missingStoryMessage="Missing story"
				storyExists
				title="Startup-listener preview"
			/>
		);

		const messageRegistration = addEventListener.mock.calls.findIndex(
			([type]) => type === 'message'
		);

		expect(messageRegistration).toBeGreaterThanOrEqual(0);
		expect(screen.getByTitle('Startup-listener preview')).toHaveAttribute(
			'srcdoc'
		);
		addEventListener.mockRestore();
	});

	it('feeds desktop URL messages through the shared runtime reducer', () => {
		render(
			<StoryPreviewFrame
				contentSource={{
					bridgeSessionId: 'desktop-session',
					htmlBytes: 123,
					storyDataCount: 1,
					type: 'url',
					url: 'twine-preview://6b5df370-33a7-42c5-8ee9-c4b06470ff40/index.html'
				}}
				missingStoryMessage="Missing story"
				passages={[{id: 'stable-id', localId: '2', name: 'Second passage'}]}
				storyExists
				title="Desktop runtime preview"
			/>
		);

		postBridgeMessage('Desktop runtime preview', 'desktop-session', {
			currentPassage: {localId: '2', source: 'runtime'},
			type: 'state',
			viewport: {height: 600, width: 800}
		});

		expect(screen.getByText('Current: Second passage')).toBeInTheDocument();
		expect(screen.getByText('800 x 600')).toBeInTheDocument();
	});

	it('reports an observed passage without identity as unknown', () => {
		render(
			<StoryPreviewFrame
				html="<html><head></head><body>Story</body></html>"
				missingStoryMessage="Missing story"
				startPassageName="Start"
				storyExists
				title="Unknown runtime preview"
			/>
		);

		expect(screen.getByText('Current: waiting')).toBeInTheDocument();
		const sessionId = sessionIdFromFrame('Unknown runtime preview');

		postBridgeMessage('Unknown runtime preview', sessionId, {
			type: 'state',
			viewport: {height: 600, width: 800}
		});

		expect(screen.getByText('Current: unknown')).toBeInTheDocument();
		expect(screen.queryByText('Current: Start')).not.toBeInTheDocument();
	});

	it('keeps exact admission and Restart eligibility isolated per frame', () => {
		const currentAdmission = sugarCubeAdmission('2.31.0');
		const candidateAdmission = sugarCubeAdmission('2.37.3');
		const currentSource = {
			admission: currentAdmission,
			bridgeSessionId: 'exact-current-session',
			generation: 1,
			htmlBytes: 123,
			storyDataCount: 1,
			sugarCubeRestartEligible: true,
			type: 'url' as const,
			url: 'twine-preview://exact-current/index.html'
		};
		const candidateSource = {
			admission: candidateAdmission,
			bridgeSessionId: 'exact-candidate-session',
			generation: 2,
			htmlBytes: 456,
			storyDataCount: 1,
			sugarCubeRestartEligible: false,
			type: 'url' as const,
			url: 'twine-preview://exact-candidate/index.html'
		};
		const passages = [
			{id: 'current-id', localId: '1', name: 'Current exact'},
			{id: 'candidate-id', localId: '9', name: 'Candidate exact'}
		];
		const exactHello = (version: string) => ({
			adapterId: `sugarcube-${version}`,
			capabilities: [
				'currentPassage',
				'storyVariables',
				'temporaryVariables',
				'visitedPassages'
			],
			format: 'SugarCube',
			formatVersion: version,
			protocolVersion: 1,
			reliability: 'exact-version',
			type: 'debugger-hello'
		});
		const exactSnapshot = (version: string, localId: string) => ({
			adapterId: `sugarcube-${version}`,
			currentPassage: {localId, source: 'debugger'},
			protocolVersion: 1,
			sections: {
				currentPassage: {state: 'complete'},
				storyVariables: {state: 'complete'},
				temporaryVariables: {state: 'complete'},
				visitedPassages: {state: 'complete'}
			},
			storyVariables: [],
			temporaryVariables: [],
			type: 'debugger-snapshot',
			visitedPassages: [{localId}]
		});
		const {rerender} = render(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing story"
				passages={passages}
				previewTarget="test"
				storyExists
				title="Current exact preview"
			/>
		);

		postBridgeMessage(
			'Current exact preview',
			'exact-current-session',
			exactHello('2.31.0')
		);
		postBridgeMessage(
			'Current exact preview',
			'exact-current-session',
			exactSnapshot('2.31.0', '1')
		);
		postBridgeMessage('Current exact preview', 'exact-current-session', {
			adapterId: 'sugarcube-2.31.0',
			commandCapabilities: ['restart'],
			protocolVersion: 1,
			type: 'debugger-command-hello'
		});
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		expect(screen.getByRole('button', {name: 'Restart'})).toBeInTheDocument();

		rerender(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing story"
				passages={passages}
				previewTarget="test"
				stagedContentSource={candidateSource}
				stagedPassages={passages}
				stagedTitle="Candidate exact preview"
				storyExists
				title="Current exact preview"
			/>
		);
		const candidateFrame = screen.getByTitle('Candidate exact preview');

		postBridgeMessage(
			'Candidate exact preview',
			'exact-candidate-session',
			exactHello('2.31.0')
		);
		postBridgeMessage(
			'Candidate exact preview',
			'exact-candidate-session',
			exactSnapshot('2.31.0', '1')
		);
		postBridgeMessage('Candidate exact preview', 'exact-candidate-session', {
			adapterId: 'sugarcube-2.31.0',
			commandCapabilities: ['restart'],
			protocolVersion: 1,
			type: 'debugger-command-hello'
		});
		postBridgeMessage('Candidate exact preview', 'exact-candidate-session', {
			adapterId: 'sugarcube-2.31.0',
			command: 'restart',
			protocolVersion: 1,
			requestId: 'borrowed-request',
			status: 'applied',
			type: 'debugger-command-result'
		});
		postBridgeMessage(
			'Candidate exact preview',
			'exact-candidate-session',
			exactHello('2.37.3')
		);
		postBridgeMessage(
			'Candidate exact preview',
			'exact-candidate-session',
			exactSnapshot('2.37.3', '9')
		);
		postBridgeMessage('Candidate exact preview', 'exact-candidate-session', {
			adapterId: 'sugarcube-2.37.3',
			commandCapabilities: ['restart'],
			protocolVersion: 1,
			type: 'debugger-command-hello'
		});

		rerender(
			<StoryPreviewFrame
				contentSource={candidateSource}
				missingStoryMessage="Missing story"
				passages={passages}
				previewTarget="test"
				storyExists
				title="Candidate exact committed"
			/>
		);

		expect(screen.getByTitle('Candidate exact committed')).toBe(candidateFrame);
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		const inspector = screen.getByRole('region', {
			name: 'Runtime debugger inspector'
		});

		expect(
			within(inspector).getByText('Adapter: sugarcube-2.37.3')
		).toBeInTheDocument();
		expect(within(inspector).getAllByText('Candidate exact')).toHaveLength(2);
		expect(
			screen.queryByRole('button', {name: 'Restart'})
		).not.toBeInTheDocument();

		postBridgeMessage(
			'Candidate exact committed',
			'exact-candidate-session',
			exactHello('2.31.0')
		);
		postBridgeMessage(
			'Candidate exact committed',
			'exact-candidate-session',
			exactSnapshot('2.31.0', '1')
		);
		postBridgeMessage('Candidate exact committed', 'exact-candidate-session', {
			adapterId: 'sugarcube-2.31.0',
			commandCapabilities: ['restart'],
			protocolVersion: 1,
			type: 'debugger-command-hello'
		});
		postBridgeMessage('Candidate exact committed', 'exact-candidate-session', {
			adapterId: 'sugarcube-2.31.0',
			command: 'restart',
			protocolVersion: 1,
			requestId: 'late-borrowed-request',
			status: 'applied',
			type: 'debugger-command-result'
		});
		expect(
			within(inspector).getByText('Adapter: sugarcube-2.37.3')
		).toBeInTheDocument();
		expect(within(inspector).getAllByText('Candidate exact')).toHaveLength(2);
		expect(
			screen.queryByRole('button', {name: 'Restart'})
		).not.toBeInTheDocument();
	});

	it('buffers candidate runtime messages and promotes them with the frame', async () => {
		const onRuntimeModelChange = jest.fn();
		const currentSource = {
			bridgeSessionId: 'current-session',
			htmlBytes: 123,
			storyDataCount: 1,
			type: 'url' as const,
			url: 'twine-preview://00000000-0000-4000-8000-000000000001/index.html'
		};
		const candidateSource = {
			bridgeSessionId: 'candidate-session',
			htmlBytes: 456,
			storyDataCount: 1,
			type: 'url' as const,
			url: 'twine-preview://00000000-0000-4000-8000-000000000002/index.html'
		};
		const candidatePassages = [
			{id: 'candidate-id', localId: '9', name: 'Candidate passage'}
		];
		const {rerender} = render(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing story"
				onRuntimeModelChange={onRuntimeModelChange}
				storyExists
				title="Committed preview"
			/>
		);

		rerender(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing story"
				onRuntimeModelChange={onRuntimeModelChange}
				stagedContentSource={candidateSource}
				stagedPassages={candidatePassages}
				stagedTitle="Candidate preview"
				storyExists
				title="Committed preview"
			/>
		);
		const candidateFrame = screen.getByTitle('Candidate preview');

		postBridgeMessage('Candidate preview', 'candidate-session', {
			args: ['candidate startup'],
			level: 'warn',
			type: 'console'
		});
		postBridgeMessage('Candidate preview', 'candidate-session', {
			message: 'candidate rejection',
			type: 'runtime-error'
		});
		postBridgeMessage('Candidate preview', 'candidate-session', {
			currentPassage: {localId: '9', source: 'runtime'},
			type: 'state',
			viewport: {height: 640, width: 960}
		});
		postBridgeMessage('Candidate preview', 'candidate-session', {
			adapterId: 'generic',
			capabilities: ['currentPassage'],
			format: 'SugarCube',
			formatVersion: '2.37.3',
			protocolVersion: 1,
			reliability: 'best-effort',
			type: 'debugger-hello'
		});
		postBridgeMessage('Candidate preview', 'candidate-session', {
			adapterId: 'sugarcube-2.37.3',
			capabilities: [
				'currentPassage',
				'storyVariables',
				'temporaryVariables',
				'visitedPassages'
			],
			format: 'SugarCube',
			formatVersion: '2.37.3',
			protocolVersion: 1,
			reliability: 'exact-version',
			type: 'debugger-hello'
		});
		postBridgeMessage('Candidate preview', 'candidate-session', {
			adapterId: 'sugarcube-2.37.3',
			currentPassage: {localId: '9', source: 'debugger'},
			protocolVersion: 1,
			sections: {
				currentPassage: {state: 'complete'},
				storyVariables: {state: 'complete'},
				temporaryVariables: {state: 'complete'},
				visitedPassages: {state: 'complete'}
			},
			storyVariables: [],
			temporaryVariables: [],
			type: 'debugger-snapshot',
			visitedPassages: [{localId: '9'}]
		});

		expect(screen.getByText('0 logs')).toBeInTheDocument();
		expect(screen.queryByText('candidate startup')).not.toBeInTheDocument();
		expect(screen.queryByText('candidate rejection')).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: 'Debugger'})
		).toBeInTheDocument();
		expect(
			onRuntimeModelChange.mock.calls.some(
				([model]) => model.debugger.hello !== undefined
			)
		).toBe(false);

		rerender(
			<StoryPreviewFrame
				contentSource={candidateSource}
				missingStoryMessage="Missing story"
				onRuntimeModelChange={onRuntimeModelChange}
				passages={candidatePassages}
				storyExists
				title="Candidate committed preview"
			/>
		);

		await waitFor(() => expect(screen.getByText('2 logs')).toBeInTheDocument());
		expect(screen.getByText('candidate rejection')).toBeInTheDocument();
		expect(screen.getByText('Current: Candidate passage')).toBeInTheDocument();
		expect(screen.getByText('960 x 640')).toBeInTheDocument();
		expect(screen.getByTitle('Candidate committed preview')).toBe(
			candidateFrame
		);
		await waitFor(() =>
			expect(
				onRuntimeModelChange.mock.calls.some(
					([model]) =>
						model.debugger.hello?.id === 'generic' &&
						model.runtime.currentPassage?.id === 'candidate-id'
				)
			).toBe(true)
		);
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		const inspector = within(
			screen.getByRole('region', {name: 'Runtime debugger inspector'})
		);
		expect(inspector.getByText('Adapter: generic')).toBeInTheDocument();
		expect(
			inspector.getByText('Waiting for the first debugger snapshot.')
		).toBeInTheDocument();
	});

	it('discards buffered candidate messages on rollback', async () => {
		const onRuntimeModelChange = jest.fn();
		const currentSource = {
			bridgeSessionId: 'current-session',
			htmlBytes: 123,
			storyDataCount: 1,
			type: 'url' as const,
			url: 'twine-preview://00000000-0000-4000-8000-000000000001/index.html'
		};
		const candidateSource = {
			bridgeSessionId: 'candidate-session',
			htmlBytes: 456,
			storyDataCount: 1,
			type: 'url' as const,
			url: 'twine-preview://00000000-0000-4000-8000-000000000002/index.html'
		};
		const {rerender} = render(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing story"
				onRuntimeModelChange={onRuntimeModelChange}
				stagedContentSource={candidateSource}
				stagedTitle="Candidate preview"
				storyExists
				title="Committed preview"
			/>
		);

		postBridgeMessage('Candidate preview', 'candidate-session', {
			args: ['abandoned startup'],
			level: 'error',
			type: 'console'
		});
		postBridgeMessage('Candidate preview', 'candidate-session', {
			adapterId: 'generic',
			capabilities: ['currentPassage'],
			format: 'Unknown',
			formatVersion: '1.0.0',
			protocolVersion: 1,
			reliability: 'best-effort',
			type: 'debugger-hello'
		});
		postBridgeMessage('Candidate preview', 'candidate-session', {
			adapterId: 'generic',
			protocolVersion: 1,
			sections: {currentPassage: {state: 'unavailable'}},
			type: 'debugger-snapshot'
		});
		rerender(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing story"
				onRuntimeModelChange={onRuntimeModelChange}
				storyExists
				title="Committed preview"
			/>
		);
		rerender(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing story"
				onRuntimeModelChange={onRuntimeModelChange}
				stagedContentSource={candidateSource}
				stagedTitle="Retry candidate preview"
				storyExists
				title="Committed preview"
			/>
		);
		rerender(
			<StoryPreviewFrame
				contentSource={candidateSource}
				missingStoryMessage="Missing story"
				onRuntimeModelChange={onRuntimeModelChange}
				storyExists
				title="Candidate committed preview"
			/>
		);

		await waitFor(() =>
			expect(
				screen.getByTitle('Candidate committed preview')
			).toBeInTheDocument()
		);
		expect(screen.getByText('0 logs')).toBeInTheDocument();
		expect(screen.queryByText('abandoned startup')).not.toBeInTheDocument();
		expect(
			onRuntimeModelChange.mock.calls.some(
				([model]) => model.debugger.hello !== undefined
			)
		).toBe(false);
		expect(
			screen.queryByRole('button', {name: 'Debugger'})
		).toBeInTheDocument();
	});

	it('preserves committed copy feedback on rollback and invalidates it on candidate promotion', async () => {
		const currentSource = {
			bridgeSessionId: 'copy-current',
			htmlBytes: 1,
			storyDataCount: 1,
			type: 'url' as const,
			url: 'twine-preview://copy-current/index.html'
		};
		const candidateSource = {
			bridgeSessionId: 'copy-candidate',
			htmlBytes: 1,
			storyDataCount: 1,
			type: 'url' as const,
			url: 'twine-preview://copy-candidate/index.html'
		};
		const onCopyRuntimeLog = jest.fn().mockResolvedValue(undefined);
		const {rerender} = render(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing"
				onCopyRuntimeLog={onCopyRuntimeLog}
				storyExists
				title="Copy committed"
			/>
		);
		postBridgeMessage('Copy committed', 'copy-current', {
			args: ['A'],
			level: 'log',
			type: 'console'
		});
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		fireEvent.click(screen.getByRole('button', {name: 'Copy Runtime Log'}));
		await waitFor(() =>
			expect(screen.getByText('Runtime log copied.')).toBeInTheDocument()
		);
		rerender(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing"
				onCopyRuntimeLog={onCopyRuntimeLog}
				stagedContentSource={candidateSource}
				stagedTitle="Copy candidate"
				storyExists
				title="Copy committed"
			/>
		);
		rerender(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing"
				onCopyRuntimeLog={onCopyRuntimeLog}
				storyExists
				title="Copy committed"
			/>
		);
		expect(screen.getByText('Runtime log copied.')).toBeInTheDocument();
		expect(screen.getAllByText('A')).toHaveLength(2);
		rerender(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing"
				onCopyRuntimeLog={onCopyRuntimeLog}
				stagedContentSource={candidateSource}
				stagedTitle="Copy candidate"
				storyExists
				title="Copy committed"
			/>
		);
		postBridgeMessage('Copy candidate', 'copy-candidate', {
			args: ['B'],
			level: 'error',
			type: 'console'
		});
		rerender(
			<StoryPreviewFrame
				contentSource={candidateSource}
				missingStoryMessage="Missing"
				onCopyRuntimeLog={onCopyRuntimeLog}
				storyExists
				title="Copy candidate committed"
			/>
		);
		await waitFor(() => expect(screen.getByText('1 log')).toBeInTheDocument());
		expect(
			screen.queryByRole('region', {name: 'Runtime debugger inspector'})
		).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		expect(screen.queryByText('Runtime log copied.')).not.toBeInTheDocument();
		expect(screen.getAllByText('B')).toHaveLength(2);
	});

	it('keeps a committed copy pending across promotion until its stale completion settles', async () => {
		const currentSource = {
			bridgeSessionId: 'pending-current',
			htmlBytes: 1,
			storyDataCount: 1,
			type: 'url' as const,
			url: 'twine-preview://pending-current/index.html'
		};
		const candidateSource = {
			bridgeSessionId: 'pending-candidate',
			htmlBytes: 1,
			storyDataCount: 1,
			type: 'url' as const,
			url: 'twine-preview://pending-candidate/index.html'
		};
		let resolveCopy!: () => void;
		const onCopyRuntimeLog = jest.fn(
			() => new Promise<void>(resolve => (resolveCopy = resolve))
		);
		const {rerender} = render(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing"
				onCopyRuntimeLog={onCopyRuntimeLog}
				storyExists
				title="Pending committed"
			/>
		);
		postBridgeMessage('Pending committed', 'pending-current', {
			args: ['A'],
			level: 'log',
			type: 'console'
		});
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		fireEvent.click(screen.getByRole('button', {name: 'Copy Runtime Log'}));
		await waitFor(() => expect(onCopyRuntimeLog).toHaveBeenCalledTimes(1));
		rerender(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing"
				onCopyRuntimeLog={onCopyRuntimeLog}
				stagedContentSource={candidateSource}
				stagedTitle="Pending candidate"
				storyExists
				title="Pending committed"
			/>
		);
		postBridgeMessage('Pending candidate', 'pending-candidate', {
			args: ['B'],
			level: 'error',
			type: 'console'
		});
		rerender(
			<StoryPreviewFrame
				contentSource={candidateSource}
				missingStoryMessage="Missing"
				onCopyRuntimeLog={onCopyRuntimeLog}
				storyExists
				title="Pending candidate committed"
			/>
		);
		await waitFor(() => expect(screen.getByText('1 log')).toBeInTheDocument());
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		const copy = screen.getByRole('button', {name: 'Copy Runtime Log'});
		expect(copy).toBeDisabled();
		await act(async () => resolveCopy());
		expect(copy).not.toBeDisabled();
		expect(screen.queryByText('Runtime log copied.')).not.toBeInTheDocument();
		expect(
			screen.queryByText('Could not copy runtime log.')
		).not.toBeInTheDocument();
	});

	it('reports content loads to the hosting shell', () => {
		const onContentLoad = jest.fn();

		render(
			<StoryPreviewFrame
				contentSource={{
					bridgeSessionId: 'desktop-session',
					htmlBytes: 123,
					storyDataCount: 1,
					type: 'url',
					url: 'twine-preview://6b5df370-33a7-42c5-8ee9-c4b06470ff40/index.html'
				}}
				missingStoryMessage="Missing story"
				onContentLoad={onContentLoad}
				storyExists
				title="Load-aware preview"
			/>
		);

		fireEvent.load(screen.getByTitle('Load-aware preview'));

		expect(onContentLoad).toHaveBeenCalledTimes(1);
	});

	it('waits for closure-correlated Harlowe readiness before reporting a content load', async () => {
		const onContentLoad = jest.fn();

		render(
			<StoryPreviewFrame
				contentSource={{
					admission: harloweAdmission(),
					bridgeSessionId: 'harlowe-load-session',
					generation: 1,
					htmlBytes: 123,
					storyDataCount: 1,
					type: 'url',
					url: 'twine-preview://harlowe-load/index.html'
				}}
				missingStoryMessage="Missing story"
				onContentLoad={onContentLoad}
				storyExists
				title="Harlowe load-aware preview"
			/>
		);

		fireEvent.load(screen.getByTitle('Harlowe load-aware preview'));
		expect(onContentLoad).not.toHaveBeenCalled();

		postBridgeMessage(
			'Harlowe load-aware preview',
			'harlowe-load-session',
			{
				adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
				protocolVersion: 1,
				type: 'debugger-bootstrap-ready'
			},
			window
		);
		expect(onContentLoad).not.toHaveBeenCalled();

		postBridgeMessage('Harlowe load-aware preview', 'wrong-session', {
			adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
			protocolVersion: 1,
			type: 'debugger-bootstrap-ready'
		});
		expect(onContentLoad).not.toHaveBeenCalled();

		postBridgeMessage('Harlowe load-aware preview', 'harlowe-load-session', {
			adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
			protocolVersion: 1,
			type: 'debugger-bootstrap-ready'
		});
		expect(onContentLoad).not.toHaveBeenCalled();

		const bootstrapChallenge = await armHarloweBootstrap(
			'Harlowe load-aware preview',
			'harlowe-load-session'
		);

		postBridgeMessage('Harlowe load-aware preview', 'harlowe-load-session', {
			adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
			bootstrapChallenge,
			protocolVersion: 1,
			type: 'debugger-bootstrap-ready'
		});
		expect(onContentLoad).not.toHaveBeenCalled();
		postHarloweReadiness(
			'Harlowe load-aware preview',
			'harlowe-load-session',
			'b'.repeat(64)
		);
		expect(onContentLoad).not.toHaveBeenCalled();
		postHarloweReadiness(
			'Harlowe load-aware preview',
			'harlowe-load-session',
			bootstrapChallenge
		);
		expect(onContentLoad).toHaveBeenCalledTimes(1);

		postHarloweReadiness(
			'Harlowe load-aware preview',
			'harlowe-load-session',
			bootstrapChallenge
		);
		fireEvent.load(screen.getByTitle('Harlowe load-aware preview'));
		expect(onContentLoad).toHaveBeenCalledTimes(1);
	});

	it('treats pre-load Harlowe readiness as provisional until the loaded document reattests', async () => {
		const onContentLoad = jest.fn();

		render(
			<StoryPreviewFrame
				contentSource={{
					admission: harloweAdmission(),
					bridgeSessionId: 'harlowe-ready-first',
					generation: 2,
					htmlBytes: 123,
					storyDataCount: 1,
					type: 'url',
					url: 'twine-preview://harlowe-ready-first/index.html'
				}}
				missingStoryMessage="Missing story"
				onContentLoad={onContentLoad}
				storyExists
				title="Harlowe ready-first preview"
			/>
		);

		const frame = screen.getByTitle(
			'Harlowe ready-first preview'
		) as HTMLIFrameElement;
		const frameWindow = frame.contentWindow;
		const provisionalChallenge = await armHarloweBootstrap(
			'Harlowe ready-first preview',
			'harlowe-ready-first'
		);
		postHarloweReadiness(
			'Harlowe ready-first preview',
			'harlowe-ready-first',
			provisionalChallenge
		);
		expect(onContentLoad).not.toHaveBeenCalled();

		const loadedDocumentChallenge = await captureHarloweBootstrapChallenge(
			'Harlowe ready-first preview',
			() => fireEvent.load(frame)
		);

		expect(frame.contentWindow).toBe(frameWindow);
		expect(loadedDocumentChallenge).not.toBe(provisionalChallenge);
		postHarloweReadiness(
			'Harlowe ready-first preview',
			'harlowe-ready-first',
			provisionalChallenge,
			frameWindow
		);
		expect(onContentLoad).not.toHaveBeenCalled();
		postHarloweReadiness(
			'Harlowe ready-first preview',
			'harlowe-ready-first',
			loadedDocumentChallenge,
			frameWindow
		);
		expect(onContentLoad).toHaveBeenCalledTimes(1);
	});

	it('fails closed when the same iframe navigates after a Harlowe challenge is issued', async () => {
		const onContentLoad = jest.fn();

		render(
			<StoryPreviewFrame
				contentSource={{
					admission: harloweAdmission(),
					bridgeSessionId: 'harlowe-native-navigation',
					generation: 3,
					htmlBytes: 123,
					storyDataCount: 1,
					type: 'url',
					url: 'twine-preview://harlowe-native-navigation/index.html'
				}}
				missingStoryMessage="Missing story"
				onContentLoad={onContentLoad}
				storyExists
				title="Harlowe native navigation"
			/>
		);
		const frame = screen.getByTitle(
			'Harlowe native navigation'
		) as HTMLIFrameElement;
		const frameWindow = frame.contentWindow;

		fireEvent.load(frame);
		const oldDocumentChallenge = await armHarloweBootstrap(
			'Harlowe native navigation',
			'harlowe-native-navigation'
		);
		const replayQueuedReadiness = destroyHarloweDocumentPort(frame);
		const replacementDocumentChallenge =
			captureHarloweBootstrapChallengeSynchronously(
				'Harlowe native navigation',
				() => fireEvent.load(frame)
			);

		expect(frame.contentWindow).toBe(frameWindow);
		expect(replacementDocumentChallenge).toBeUndefined();
		replayQueuedReadiness?.('harlowe-native-navigation', oldDocumentChallenge);
		expect(onContentLoad).not.toHaveBeenCalled();
		postHarloweReadiness(
			'Harlowe native navigation',
			'harlowe-native-navigation',
			oldDocumentChallenge,
			frameWindow
		);
		expect(onContentLoad).not.toHaveBeenCalled();
		postHarloweReadiness(
			'Harlowe native navigation',
			'harlowe-native-navigation',
			'c'.repeat(64),
			frameWindow
		);
		expect(onContentLoad).not.toHaveBeenCalled();
	});

	it('does not promote a staged native navigation with the prior document readiness', async () => {
		const onStagedContentLoad = jest.fn();

		render(
			<StoryPreviewFrame
				contentSource={{
					bridgeSessionId: 'native-navigation-current',
					htmlBytes: 123,
					storyDataCount: 1,
					type: 'url',
					url: 'twine-preview://native-navigation-current/index.html'
				}}
				missingStoryMessage="Missing story"
				onStagedContentLoad={onStagedContentLoad}
				stagedContentSource={{
					admission: harloweAdmission(),
					bridgeSessionId: 'native-navigation-candidate',
					generation: 2,
					htmlBytes: 456,
					storyDataCount: 1,
					type: 'url',
					url: 'twine-preview://native-navigation-candidate/index.html'
				}}
				stagedTitle="Native navigation candidate"
				storyExists
				title="Native navigation current"
			/>
		);
		const frame = screen.getByTitle(
			'Native navigation candidate'
		) as HTMLIFrameElement;
		const frameWindow = frame.contentWindow;

		fireEvent.load(frame);
		const oldDocumentChallenge = await armHarloweBootstrap(
			'Native navigation candidate',
			'native-navigation-candidate'
		);

		const replayQueuedReadiness = destroyHarloweDocumentPort(frame);
		const replacementDocumentChallenge =
			captureHarloweBootstrapChallengeSynchronously(
				'Native navigation candidate',
				() => fireEvent.load(frame)
			);

		expect(frame.contentWindow).toBe(frameWindow);
		expect(replacementDocumentChallenge).toBeUndefined();
		replayQueuedReadiness?.(
			'native-navigation-candidate',
			oldDocumentChallenge
		);
		expect(onStagedContentLoad).not.toHaveBeenCalled();
		postHarloweReadiness(
			'Native navigation candidate',
			'native-navigation-candidate',
			oldDocumentChallenge,
			frameWindow
		);
		expect(onStagedContentLoad).not.toHaveBeenCalled();
		postHarloweReadiness(
			'Native navigation candidate',
			'native-navigation-candidate',
			'd'.repeat(64),
			frameWindow
		);
		expect(onStagedContentLoad).not.toHaveBeenCalled();
	});

	it('resets exact Harlowe readiness when only the bridge session changes', async () => {
		const onContentLoad = jest.fn();
		const source = {
			admission: harloweAdmission(),
			bridgeSessionId: 'harlowe-old-session',
			generation: 4,
			htmlBytes: 123,
			storyDataCount: 1,
			type: 'url' as const,
			url: 'twine-preview://harlowe-same-url/index.html'
		};
		const {rerender} = render(
			<StoryPreviewFrame
				contentSource={source}
				missingStoryMessage="Missing story"
				onContentLoad={onContentLoad}
				storyExists
				title="Harlowe session replacement"
			/>
		);

		fireEvent.load(screen.getByTitle('Harlowe session replacement'));
		rerender(
			<StoryPreviewFrame
				contentSource={{...source, bridgeSessionId: 'harlowe-new-session'}}
				missingStoryMessage="Missing story"
				onContentLoad={onContentLoad}
				storyExists
				title="Harlowe session replacement"
			/>
		);
		const newChallenge = await armHarloweBootstrap(
			'Harlowe session replacement',
			'harlowe-new-session'
		);
		postHarloweReadiness(
			'Harlowe session replacement',
			'harlowe-new-session',
			newChallenge
		);
		expect(onContentLoad).not.toHaveBeenCalled();

		const loadedChallenge = await captureHarloweBootstrapChallenge(
			'Harlowe session replacement',
			() => fireEvent.load(screen.getByTitle('Harlowe session replacement'))
		);
		expect(loadedChallenge).not.toBe(newChallenge);
		postHarloweReadiness(
			'Harlowe session replacement',
			'harlowe-new-session',
			loadedChallenge
		);
		expect(onContentLoad).toHaveBeenCalledTimes(1);

		rerender(
			<StoryPreviewFrame
				contentSource={{...source, bridgeSessionId: 'harlowe-third-session'}}
				missingStoryMessage="Missing story"
				onContentLoad={onContentLoad}
				storyExists
				title="Harlowe session replacement"
			/>
		);
		fireEvent.load(screen.getByTitle('Harlowe session replacement'));
		expect(onContentLoad).toHaveBeenCalledTimes(1);
		const thirdChallenge = await armHarloweBootstrap(
			'Harlowe session replacement',
			'harlowe-third-session'
		);
		postHarloweReadiness(
			'Harlowe session replacement',
			'harlowe-third-session',
			thirdChallenge
		);
		expect(onContentLoad).toHaveBeenCalledTimes(2);
	});

	it('does not inherit pre-load Harlowe readiness across bridge sessions', async () => {
		const onContentLoad = jest.fn();
		const source = {
			admission: harloweAdmission(),
			bridgeSessionId: 'harlowe-ready-old',
			generation: 4,
			htmlBytes: 123,
			storyDataCount: 1,
			type: 'url' as const,
			url: 'twine-preview://harlowe-ready-session/index.html'
		};
		const {rerender} = render(
			<StoryPreviewFrame
				contentSource={source}
				missingStoryMessage="Missing story"
				onContentLoad={onContentLoad}
				storyExists
				title="Harlowe pre-load session replacement"
			/>
		);

		const oldChallenge = await armHarloweBootstrap(
			'Harlowe pre-load session replacement',
			'harlowe-ready-old'
		);
		postHarloweReadiness(
			'Harlowe pre-load session replacement',
			'harlowe-ready-old',
			oldChallenge
		);
		rerender(
			<StoryPreviewFrame
				contentSource={{...source, bridgeSessionId: 'harlowe-ready-new'}}
				missingStoryMessage="Missing story"
				onContentLoad={onContentLoad}
				storyExists
				title="Harlowe pre-load session replacement"
			/>
		);
		fireEvent.load(screen.getByTitle('Harlowe pre-load session replacement'));
		expect(onContentLoad).not.toHaveBeenCalled();

		const newChallenge = await armHarloweBootstrap(
			'Harlowe pre-load session replacement',
			'harlowe-ready-new'
		);
		postHarloweReadiness(
			'Harlowe pre-load session replacement',
			'harlowe-ready-new',
			newChallenge
		);
		expect(onContentLoad).toHaveBeenCalledTimes(1);
	});

	it('rejects exact Harlowe readiness from a stale generation window', async () => {
		const onContentLoad = jest.fn();
		const source = {
			admission: harloweAdmission(),
			bridgeSessionId: 'harlowe-generation-session',
			generation: 4,
			htmlBytes: 123,
			storyDataCount: 1,
			type: 'url' as const,
			url: 'twine-preview://harlowe-generation/index.html'
		};
		const {rerender} = render(
			<StoryPreviewFrame
				contentSource={source}
				missingStoryMessage="Missing story"
				onContentLoad={onContentLoad}
				storyExists
				title="Harlowe generation replacement"
			/>
		);
		const staleWindow = (
			screen.getByTitle('Harlowe generation replacement') as HTMLIFrameElement
		).contentWindow;
		const staleChallenge = await armHarloweBootstrap(
			'Harlowe generation replacement',
			'harlowe-generation-session'
		);

		fireEvent.load(screen.getByTitle('Harlowe generation replacement'));
		rerender(
			<StoryPreviewFrame
				contentSource={{...source, generation: 5}}
				missingStoryMessage="Missing story"
				onContentLoad={onContentLoad}
				storyExists
				title="Harlowe generation replacement"
			/>
		);
		postHarloweReadiness(
			'Harlowe generation replacement',
			'harlowe-generation-session',
			staleChallenge,
			staleWindow
		);
		expect(onContentLoad).not.toHaveBeenCalled();

		const currentChallenge = await armHarloweBootstrap(
			'Harlowe generation replacement',
			'harlowe-generation-session'
		);
		postHarloweReadiness(
			'Harlowe generation replacement',
			'harlowe-generation-session',
			currentChallenge
		);
		expect(onContentLoad).not.toHaveBeenCalled();
		const loadedChallenge = await captureHarloweBootstrapChallenge(
			'Harlowe generation replacement',
			() => fireEvent.load(screen.getByTitle('Harlowe generation replacement'))
		);
		expect(loadedChallenge).not.toBe(currentChallenge);
		postHarloweReadiness(
			'Harlowe generation replacement',
			'harlowe-generation-session',
			loadedChallenge
		);
		expect(onContentLoad).toHaveBeenCalledTimes(1);
	});

	it('does not let rolled-back Harlowe candidate readiness complete staging', async () => {
		const onStagedContentLoad = jest.fn();
		const currentSource = {
			bridgeSessionId: 'committed-session',
			htmlBytes: 123,
			storyDataCount: 1,
			type: 'url' as const,
			url: 'twine-preview://committed/index.html'
		};
		const candidateSource = {
			admission: harloweAdmission(),
			bridgeSessionId: 'harlowe-candidate-session',
			generation: 2,
			htmlBytes: 456,
			storyDataCount: 1,
			type: 'url' as const,
			url: 'twine-preview://harlowe-candidate/index.html'
		};
		const {rerender} = render(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing story"
				onStagedContentLoad={onStagedContentLoad}
				stagedContentSource={candidateSource}
				stagedTitle="Harlowe candidate preview"
				storyExists
				title="Committed preview"
			/>
		);
		const candidateFrame = screen.getByTitle(
			'Harlowe candidate preview'
		) as HTMLIFrameElement;
		const candidateWindow = candidateFrame.contentWindow;

		fireEvent.load(candidateFrame);
		expect(onStagedContentLoad).not.toHaveBeenCalled();
		const candidateChallenge = await armHarloweBootstrap(
			'Harlowe candidate preview',
			'harlowe-candidate-session'
		);

		rerender(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing story"
				onStagedContentLoad={onStagedContentLoad}
				storyExists
				title="Committed preview"
			/>
		);
		postHarloweReadiness(
			'Committed preview',
			'harlowe-candidate-session',
			candidateChallenge,
			candidateWindow
		);

		expect(onStagedContentLoad).not.toHaveBeenCalled();
	});

	it('rejects same-session forged staged readiness before and after challenge issuance', async () => {
		const onStagedContentLoad = jest.fn();

		render(
			<StoryPreviewFrame
				contentSource={{
					bridgeSessionId: 'forged-staged-current',
					htmlBytes: 123,
					storyDataCount: 1,
					type: 'url',
					url: 'twine-preview://forged-staged-current/index.html'
				}}
				missingStoryMessage="Missing story"
				onStagedContentLoad={onStagedContentLoad}
				stagedContentSource={{
					admission: harloweAdmission(),
					bridgeSessionId: 'forged-staged-candidate',
					generation: 2,
					htmlBytes: 456,
					storyDataCount: 1,
					type: 'url',
					url: 'twine-preview://forged-staged-candidate/index.html'
				}}
				stagedTitle="Forged staged candidate"
				storyExists
				title="Forged staged current"
			/>
		);
		const candidate = screen.getByTitle('Forged staged candidate');

		fireEvent.load(candidate);
		postBridgeMessage('Forged staged candidate', 'forged-staged-candidate', {
			adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
			bootstrapChallenge: 'f'.repeat(64),
			protocolVersion: 1,
			type: 'debugger-bootstrap-ready'
		});
		expect(onStagedContentLoad).not.toHaveBeenCalled();

		const bootstrapChallenge = await armHarloweBootstrap(
			'Forged staged candidate',
			'forged-staged-candidate'
		);

		postBridgeMessage('Forged staged candidate', 'forged-staged-candidate', {
			adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
			bootstrapChallenge,
			protocolVersion: 1,
			type: 'debugger-bootstrap-ready'
		});
		expect(onStagedContentLoad).not.toHaveBeenCalled();
		postHarloweReadiness(
			'Forged staged candidate',
			'forged-staged-candidate',
			'f'.repeat(64)
		);
		expect(onStagedContentLoad).not.toHaveBeenCalled();
		postHarloweReadiness(
			'Forged staged candidate',
			'forged-staged-candidate',
			bootstrapChallenge
		);
		expect(onStagedContentLoad).toHaveBeenCalledTimes(1);
	});

	it('keeps the listener armed when current Harlowe readiness arrives during replacement commit', () => {
		const onContentLoad = jest.fn();
		function Harness({generation}: {generation: number}) {
			const previousGeneration = React.useRef(generation);

			React.useLayoutEffect(() => {
				if (previousGeneration.current === generation) return;
				previousGeneration.current = generation;
				const frame = document.querySelector<HTMLIFrameElement>(
					'iframe[title="Synchronous current replacement"]'
				)!;
				const source = frame.contentWindow;

				frame.dispatchEvent(new Event('load'));
				const bootstrapChallenge =
					captureHarloweBootstrapChallengeSynchronously(
						'Synchronous current replacement',
						() =>
							window.dispatchEvent(
								new MessageEvent('message', {
									data: {
										adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
										protocolVersion: 1,
										sessionId: 'synchronous-current-session',
										source: STORY_PREVIEW_BRIDGE_SOURCE,
										type: 'debugger-bootstrap-arm'
									},
									source
								})
							)
					);

				expect(bootstrapChallenge).toMatch(/^[0-9a-f]{64}$/);
				postHarloweReadiness(
					'Synchronous current replacement',
					'synchronous-current-session',
					bootstrapChallenge!,
					undefined,
					false
				);
			}, [generation]);

			return (
				<StoryPreviewFrame
					contentSource={{
						admission: harloweAdmission(),
						bridgeSessionId: 'synchronous-current-session',
						generation,
						htmlBytes: 123,
						storyDataCount: 1,
						type: 'url',
						url: 'twine-preview://synchronous-current/index.html'
					}}
					missingStoryMessage="Missing story"
					onContentLoad={onContentLoad}
					storyExists
					title="Synchronous current replacement"
				/>
			);
		}

		const {rerender} = render(<Harness generation={1} />);

		rerender(<Harness generation={2} />);
		expect(onContentLoad).toHaveBeenCalledTimes(1);
	});

	it('keeps the listener armed when staged Harlowe readiness arrives during replacement commit', () => {
		const onStagedContentLoad = jest.fn();
		function Harness({generation}: {generation: number}) {
			const previousGeneration = React.useRef(generation);

			React.useLayoutEffect(() => {
				if (previousGeneration.current === generation) return;
				previousGeneration.current = generation;
				const frame = document.querySelector<HTMLIFrameElement>(
					'iframe[title="Synchronous staged replacement"]'
				)!;
				const source = frame.contentWindow;

				frame.dispatchEvent(new Event('load'));
				const bootstrapChallenge =
					captureHarloweBootstrapChallengeSynchronously(
						'Synchronous staged replacement',
						() =>
							window.dispatchEvent(
								new MessageEvent('message', {
									data: {
										adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
										protocolVersion: 1,
										sessionId: 'synchronous-staged-session',
										source: STORY_PREVIEW_BRIDGE_SOURCE,
										type: 'debugger-bootstrap-arm'
									},
									source
								})
							)
					);

				expect(bootstrapChallenge).toMatch(/^[0-9a-f]{64}$/);
				postHarloweReadiness(
					'Synchronous staged replacement',
					'synchronous-staged-session',
					bootstrapChallenge!,
					undefined,
					false
				);
			}, [generation]);

			return (
				<StoryPreviewFrame
					contentSource={{
						bridgeSessionId: 'committed-session',
						htmlBytes: 123,
						storyDataCount: 1,
						type: 'url',
						url: 'twine-preview://committed/index.html'
					}}
					missingStoryMessage="Missing story"
					onStagedContentLoad={onStagedContentLoad}
					stagedContentSource={{
						admission: harloweAdmission(),
						bridgeSessionId: 'synchronous-staged-session',
						generation,
						htmlBytes: 456,
						storyDataCount: 1,
						type: 'url',
						url: 'twine-preview://synchronous-staged/index.html'
					}}
					stagedTitle="Synchronous staged replacement"
					storyExists
					title="Committed preview"
				/>
			);
		}

		const {rerender} = render(<Harness generation={1} />);

		rerender(<Harness generation={2} />);
		expect(onStagedContentLoad).toHaveBeenCalledTimes(1);
	});

	it('surfaces runtime passage state and routes actions to that passage', () => {
		const start = fakePassage({id: 'start', name: 'Start'});
		const lighthouse = fakePassage({id: 'lighthouse', name: 'Lighthouse'});
		const story = {
			...fakeStory(),
			passages: [start, lighthouse],
			startPassage: start.id
		};
		const onRevealGraph = jest.fn();
		const onRevealSource = jest.fn();
		const onTestCurrentPassage = jest.fn();

		render(
			<StoryPreviewFrame
				html="<html><head></head><body>Story</body></html>"
				missingStoryMessage="Missing story"
				onRevealGraph={onRevealGraph}
				onRevealSource={onRevealSource}
				onTestCurrentPassage={onTestCurrentPassage}
				passages={storyPreviewPassages(story)}
				startPassageName="Start"
				storyExists
				storyName="Runtime Story"
				targetLabel="Test"
				title="Runtime preview"
			/>
		);

		const sessionId = sessionIdFromFrame('Runtime preview');

		postBridgeMessage('Runtime preview', sessionId, {
			currentPassage: {name: 'Lighthouse', source: 'runtime'},
			type: 'state',
			viewport: {height: 700, width: 390}
		});

		expect(screen.getByText('Current: Lighthouse')).toBeInTheDocument();
		expect(screen.getByText('390 x 700')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: 'Edit Passage'}));
		fireEvent.click(screen.getByRole('button', {name: 'Reveal in Graph'}));
		fireEvent.click(screen.getByRole('button', {name: 'Test Current'}));

		expect(onRevealSource).toHaveBeenCalledWith('lighthouse');
		expect(onRevealGraph).toHaveBeenCalledWith('lighthouse');
		expect(onTestCurrentPassage).toHaveBeenCalledWith('lighthouse');
	});

	it('disables reveal actions when the runtime passage cannot be resolved', () => {
		const onRevealGraph = jest.fn();
		const onRevealSource = jest.fn();
		render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing story"
				onRevealGraph={onRevealGraph}
				onRevealSource={onRevealSource}
				passages={[{id: 'known', localId: '1', name: 'Known'}]}
				storyExists
				title="Unknown runtime preview"
			/>
		);
		const sessionId = sessionIdFromFrame('Unknown runtime preview');
		postBridgeMessage('Unknown runtime preview', sessionId, {
			currentPassage: {name: 'Missing', source: 'runtime'},
			type: 'state',
			viewport: {height: 700, width: 390}
		});
		const source = screen.getByRole('button', {name: 'Edit Passage'});
		const graph = screen.getByRole('button', {name: 'Reveal in Graph'});
		expect(source).toBeDisabled();
		expect(graph).toBeDisabled();
		fireEvent.click(source);
		fireEvent.click(graph);
		expect(onRevealSource).not.toHaveBeenCalled();
		expect(onRevealGraph).not.toHaveBeenCalled();
	});

	it('disables and guards all reveal controls while an owner command is pending', () => {
		const story = fakeStory();
		const onRevealGraph = jest.fn();
		const onRevealSource = jest.fn();
		render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing story"
				onRevealGraph={onRevealGraph}
				onRevealSource={onRevealSource}
				passages={storyPreviewPassages(story)}
				runtimeControlsBusy
				storyExists
				title="Busy runtime preview"
			/>
		);
		const sessionId = sessionIdFromFrame('Busy runtime preview');
		postBridgeMessage('Busy runtime preview', sessionId, {
			currentPassage: {name: story.passages[0].name, source: 'runtime'},
			type: 'state',
			viewport: {height: 700, width: 390}
		});

		for (const name of ['Edit Passage', 'Reveal in Graph']) {
			const control = screen.getByRole('button', {name});
			expect(control).toBeDisabled();
			fireEvent.click(control);
		}
		expect(onRevealSource).not.toHaveBeenCalled();
		expect(onRevealGraph).not.toHaveBeenCalled();
	});

	it('shows captured runtime log output', () => {
		render(
			<StoryPreviewFrame
				html="<html><head></head><body>Story</body></html>"
				missingStoryMessage="Missing story"
				storyExists
				title="Log preview"
			/>
		);

		const sessionId = sessionIdFromFrame('Log preview');

		postBridgeMessage('Log preview', sessionId, {
			args: ['hello', 'runtime'],
			level: 'warn',
			type: 'console'
		});

		expect(screen.getByText('1 log')).toBeInTheDocument();
		expect(screen.getByText('hello runtime')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: 'Reload'}));

		expect(screen.getByText('0 logs')).toBeInTheDocument();
		expect(screen.queryByText('hello runtime')).not.toBeInTheDocument();
	});

	it('ignores bridge messages from outside the frame or a wrong session', () => {
		render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing story"
				storyExists
				title="Source checked preview"
			/>
		);
		const sessionId = sessionIdFromFrame('Source checked preview');

		postBridgeMessage(
			'Source checked preview',
			sessionId,
			{args: ['forged'], level: 'warn', type: 'console'},
			window
		);
		postBridgeMessage('Source checked preview', 'wrong-session', {
			args: ['wrong session'],
			level: 'warn',
			type: 'console'
		});

		expect(screen.getByText('0 logs')).toBeInTheDocument();
	});

	it('does not enable Test Current for an unknown runtime passage ID', () => {
		const onTestCurrentPassage = jest.fn();

		render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing story"
				onTestCurrentPassage={onTestCurrentPassage}
				passages={[{id: 'known', localId: '1', name: 'Known'}]}
				storyExists
				title="Unknown passage preview"
			/>
		);
		const sessionId = sessionIdFromFrame('Unknown passage preview');

		postBridgeMessage('Unknown passage preview', sessionId, {
			currentPassage: {
				id: 'not-in-descriptor',
				name: 'Unknown',
				source: 'runtime'
			},
			type: 'state',
			viewport: {height: 600, width: 800}
		});

		expect(screen.getByText('Current: Unknown')).toBeInTheDocument();
		expect(screen.getByRole('button', {name: 'Test Current'})).toBeDisabled();
		expect(onTestCurrentPassage).not.toHaveBeenCalled();
	});

	it('shows the negotiated debugger inspector and bounded snapshot text', () => {
		const onRevealGraph = jest.fn();
		const onRevealSource = jest.fn();
		render(
			<StoryPreviewFrame
				admission={sugarCubeAdmission()}
				html='<html><body><tw-storydata format="SugarCube" format-version="2.37.3"></tw-storydata></body></html>'
				missingStoryMessage="Missing story"
				onRevealGraph={onRevealGraph}
				onRevealSource={onRevealSource}
				passages={[
					{id: 'start', localId: '1', name: 'Start'},
					{id: 'second', localId: '2', name: 'Second'}
				]}
				storyExists
				title="Debugger preview"
			/>
		);
		const sessionId = sessionIdFromFrame('Debugger preview');

		postBridgeMessage('Debugger preview', sessionId, {
			adapterId: 'sugarcube-2.37.3',
			capabilities: [
				'currentPassage',
				'storyVariables',
				'temporaryVariables',
				'visitedPassages'
			],
			format: 'SugarCube',
			formatVersion: '2.37.3',
			protocolVersion: 1,
			reliability: 'exact-version',
			type: 'debugger-hello'
		});

		const toggle = screen.getByRole('button', {name: 'Debugger'});
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		fireEvent.click(toggle);
		const inspector = screen.getByRole('region', {
			name: 'Runtime debugger inspector'
		});
		expect(toggle).toHaveAttribute('aria-expanded', 'true');
		expect(
			within(inspector).getByText('Adapter: sugarcube-2.37.3')
		).toBeInTheDocument();
		expect(
			within(inspector).getByText('Waiting for the first debugger snapshot.')
		).toBeInTheDocument();

		postBridgeMessage('Debugger preview', sessionId, {
			adapterId: 'sugarcube-2.37.3',
			currentPassage: {localId: '2', source: 'debugger'},
			protocolVersion: 1,
			sections: {
				currentPassage: {state: 'complete'},
				storyVariables: {state: 'complete'},
				temporaryVariables: {
					reasons: [
						'field-limit',
						'item-limit',
						'text-budget',
						'uninspectable'
					],
					state: 'truncated'
				},
				visitedPassages: {state: 'unavailable'}
			},
			storyVariables: [
				{name: '$unsafe', preview: '<b>not HTML</b>', type: 'string'},
				{name: '$spaced', preview: '" a  b "', type: 'string'}
			],
			temporaryVariables: [
				{name: '_spacing', preview: '\tline  one\nline two ', type: 'string'}
			],
			type: 'debugger-snapshot',
			visitedPassages: undefined
		});

		expect(within(inspector).getByText('<b>not HTML</b>')).toBeInTheDocument();
		expect(inspector.querySelector('b')).toBeNull();
		expect(
			Array.from(
				inspector.querySelectorAll(
					'.story-preview-route__debugger-variable-preview'
				),
				preview => preview.textContent
			)
		).toEqual(['<b>not HTML</b>', '" a  b "', '\tline  one\nline two ']);
		expect(
			within(inspector).getByText(
				'Truncated: field-limit, item-limit, text-budget, uninspectable'
			)
		).toBeInTheDocument();
		expect(within(inspector).getByText('Unavailable')).toBeInTheDocument();
		fireEvent.click(
			within(inspector).getByRole('button', {name: 'Edit text for Second'})
		);
		fireEvent.click(
			within(inspector).getByRole('button', {name: 'Reveal Second in Graph'})
		);
		expect(onRevealSource).toHaveBeenCalledWith('second');
		expect(onRevealGraph).toHaveBeenCalledWith('second');
	});

	it('filters the inspector to negotiated capabilities and clears it on reload', () => {
		render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing story"
				storyExists
				title="Generic debugger preview"
			/>
		);
		const sessionId = sessionIdFromFrame('Generic debugger preview');

		postBridgeMessage('Generic debugger preview', sessionId, {
			adapterId: 'generic',
			capabilities: ['currentPassage'],
			format: 'Unknown',
			formatVersion: '1.0.0',
			protocolVersion: 1,
			reliability: 'best-effort',
			type: 'debugger-hello'
		});
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		postBridgeMessage('Generic debugger preview', sessionId, {
			adapterId: 'generic',
			currentPassage: {name: 'Captured', source: 'debugger'},
			protocolVersion: 1,
			sections: {currentPassage: {state: 'complete'}},
			type: 'debugger-snapshot'
		});

		const inspector = screen.getByRole('region', {
			name: 'Runtime debugger inspector'
		});
		expect(within(inspector).getByText('Current passage')).toBeInTheDocument();
		expect(
			within(inspector).queryByText('Story variables')
		).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', {name: 'Reload'}));
		expect(
			screen.queryByRole('button', {name: 'Debugger'})
		).toBeInTheDocument();
		expect(
			screen.queryByRole('region', {name: 'Runtime debugger inspector'})
		).not.toBeInTheDocument();
	});

	it('renders exact Harlowe temporary scopes and explains empty and unavailable observations', () => {
		const title = 'Harlowe scoped debugger preview';
		const sessionId = 'harlowe-scoped-debugger';

		render(
			<StoryPreviewFrame
				contentSource={{
					admission: harloweAdmission(),
					bridgeSessionId: sessionId,
					generation: 1,
					htmlBytes: 123,
					storyDataCount: 1,
					type: 'url',
					url: 'twine-preview://harlowe-scoped/index.html'
				}}
				missingStoryMessage="Missing story"
				storyExists
				title={title}
			/>
		);
		postBridgeMessage(title, sessionId, {
			adapterId: 'harlowe-3.3.9',
			capabilities: [
				'currentPassage',
				'storyVariables',
				'temporaryVariables',
				'visitedPassages'
			],
			format: 'Harlowe',
			formatVersion: '3.3.9',
			protocolVersion: 1,
			reliability: 'exact-version',
			type: 'debugger-hello'
		});
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		const inspector = screen.getByRole('region', {
			name: 'Runtime debugger inspector'
		});
		const explanation =
			'Harlowe temporary variables are assignments observed during this turn; scope names are supplied by Harlowe.';

		postBridgeMessage(title, sessionId, {
			adapterId: 'harlowe-3.3.9',
			currentPassage: {name: 'Start'},
			protocolVersion: 1,
			sections: {
				currentPassage: {state: 'complete'},
				storyVariables: {state: 'complete'},
				temporaryVariables: {state: 'complete'},
				visitedPassages: {state: 'complete'}
			},
			storyVariables: [],
			temporaryVariables: [],
			type: 'debugger-snapshot',
			visitedPassages: [{name: 'Start'}]
		});
		expect(within(inspector).getByText(explanation)).toBeInTheDocument();

		postBridgeMessage(title, sessionId, {
			adapterId: 'harlowe-3.3.9',
			currentPassage: {name: 'Start'},
			protocolVersion: 1,
			sections: {
				currentPassage: {state: 'complete'},
				storyVariables: {state: 'complete'},
				temporaryVariables: {state: 'complete'},
				visitedPassages: {state: 'complete'}
			},
			storyVariables: [],
			temporaryVariables: [
				{name: 'same', preview: '1', scope: '?named', type: 'number'},
				{
					name: 'same',
					preview: '2',
					scope: 'an unnamed hook',
					type: 'number'
				}
			],
			type: 'debugger-snapshot',
			visitedPassages: [{name: 'Start'}]
		});
		expect(within(inspector).getAllByText('same')).toHaveLength(2);
		expect(within(inspector).getByText('?named')).toBeInTheDocument();
		expect(within(inspector).getByText('an unnamed hook')).toBeInTheDocument();

		postBridgeMessage(title, sessionId, {
			adapterId: 'harlowe-3.3.9',
			currentPassage: {name: 'Start'},
			protocolVersion: 1,
			sections: {
				currentPassage: {state: 'complete'},
				storyVariables: {state: 'complete'},
				temporaryVariables: {state: 'unavailable'},
				visitedPassages: {state: 'complete'}
			},
			storyVariables: [],
			type: 'debugger-snapshot',
			visitedPassages: [{name: 'Start'}]
		});
		expect(within(inspector).getByText(explanation)).toBeInTheDocument();
		expect(within(inspector).getByText('Unavailable.')).toBeInTheDocument();
	});

	it('offers inspector passage actions only for resolved history entries', () => {
		const onRevealSource = jest.fn();
		render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing story"
				onRevealSource={onRevealSource}
				passages={[{id: 'start', localId: '1', name: 'Start'}]}
				storyExists
				title="History debugger preview"
			/>
		);
		const sessionId = sessionIdFromFrame('History debugger preview');

		postBridgeMessage('History debugger preview', sessionId, {
			adapterId: 'snowman-2.1.1',
			capabilities: ['currentPassage', 'storyVariables', 'visitedPassages'],
			format: 'Snowman',
			formatVersion: '2.1.1',
			protocolVersion: 1,
			reliability: 'exact-version',
			type: 'debugger-hello'
		});
		postBridgeMessage('History debugger preview', sessionId, {
			adapterId: 'snowman-2.1.1',
			currentPassage: {localId: '1', source: 'debugger'},
			protocolVersion: 1,
			sections: {
				currentPassage: {state: 'complete'},
				storyVariables: {state: 'complete'},
				visitedPassages: {state: 'complete'}
			},
			storyVariables: [],
			type: 'debugger-snapshot',
			visitedPassages: [
				{localId: '1', source: 'debugger'},
				{name: 'Unresolved', source: 'debugger'}
			]
		});
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		const inspector = screen.getByRole('region', {
			name: 'Runtime debugger inspector'
		});
		expect(within(inspector).getByText('None.')).toBeInTheDocument();
		const historySection = within(inspector)
			.getByRole('heading', {name: 'Visited passages'})
			.closest('section');
		expect(historySection).not.toBeNull();
		expect(
			within(historySection!).getAllByRole('button', {
				name: 'Edit text for Start'
			})
		).toHaveLength(1);
		fireEvent.click(
			within(historySection!).getByRole('button', {
				name: 'Edit text for Start'
			})
		);
		expect(onRevealSource).toHaveBeenCalledWith('start');
	});

	it('labels unresolved current and history passages by nonblank identity order', () => {
		const onRevealGraph = jest.fn();
		const onRevealSource = jest.fn();

		render(
			<StoryPreviewFrame
				html="<html><body>Story</body></html>"
				missingStoryMessage="Missing story"
				onRevealGraph={onRevealGraph}
				onRevealSource={onRevealSource}
				storyExists
				title="Unresolved debugger passage preview"
			/>
		);
		const sessionId = sessionIdFromFrame('Unresolved debugger passage preview');

		postBridgeMessage('Unresolved debugger passage preview', sessionId, {
			adapterId: 'snowman-2.1.1',
			capabilities: ['currentPassage', 'storyVariables', 'visitedPassages'],
			format: 'Snowman',
			formatVersion: '2.1.1',
			protocolVersion: 1,
			reliability: 'exact-version',
			type: 'debugger-hello'
		});
		postBridgeMessage('Unresolved debugger passage preview', sessionId, {
			adapterId: 'snowman-2.1.1',
			currentPassage: {
				localId: 'unmapped-current-id',
				name: '   ',
				rawName: ' Runtime current title ',
				source: 'debugger'
			},
			protocolVersion: 1,
			sections: {
				currentPassage: {state: 'complete'},
				storyVariables: {state: 'complete'},
				visitedPassages: {state: 'complete'}
			},
			storyVariables: [],
			type: 'debugger-snapshot',
			visitedPassages: [
				{
					id: 'unmapped-named-id',
					localId: 'unmapped-named-local-id',
					name: 'Runtime named title',
					rawName: 'Ignored raw title',
					source: 'debugger'
				},
				{
					id: 'unmapped-raw-id',
					localId: 'unmapped-raw-local-id',
					name: '\t ',
					rawName: ' Runtime raw title ',
					source: 'debugger'
				},
				{
					id: 'unmapped-local-fallback-id',
					localId: 'unmapped-history-local-id',
					name: ' ',
					rawName: '\t',
					source: 'debugger'
				},
				{
					id: 'unmapped-history-id',
					localId: ' ',
					name: ' ',
					rawName: '\t',
					source: 'debugger'
				}
			]
		});
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		const inspector = screen.getByRole('region', {
			name: 'Runtime debugger inspector'
		});
		const currentSection = within(inspector)
			.getByRole('heading', {name: 'Current passage'})
			.closest('section');
		const historySection = within(inspector)
			.getByRole('heading', {name: 'Visited passages'})
			.closest('section');

		expect(currentSection).not.toBeNull();
		expect(historySection).not.toBeNull();
		expect(
			within(currentSection!).getByText('Runtime current title', {exact: true})
		).toBeInTheDocument();
		expect(
			within(historySection!).getByText('Runtime named title', {exact: true})
		).toBeInTheDocument();
		expect(
			within(historySection!).getByText('Runtime raw title', {exact: true})
		).toBeInTheDocument();
		expect(
			within(historySection!).getByText('unmapped-history-local-id', {
				exact: true
			})
		).toBeInTheDocument();
		expect(
			within(historySection!).getByText('unmapped-history-id', {exact: true})
		).toBeInTheDocument();
		expect(
			within(inspector).queryByRole('button', {name: /^Open /})
		).not.toBeInTheDocument();
		expect(onRevealGraph).not.toHaveBeenCalled();
		expect(onRevealSource).not.toHaveBeenCalled();
	});
});
