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

describe('instrumentPreviewHtml()', () => {
	it('injects the preview bridge into an HTML head', () => {
		const html =
			'<html><head><title>Story</title></head><body>Story</body></html>';
		const result = instrumentPreviewHtml(html, 'session-1');

		expect(result.indexOf('<script>')).toBeGreaterThan(
			result.indexOf('<head>')
		);
		expect(result.indexOf('<script>')).toBeLessThan(result.indexOf('<title>'));
		expect(result).toContain('twine.rs.preview.bridge');
		expect(result).toContain('var SESSION = "session-1"');
		expect(result).toContain("['log', 'info', 'warn', 'error']");
		expect(result).toContain("window.addEventListener('error'");
		expect(result).toContain("window.addEventListener('unhandledrejection'");
		expect(result).toContain("storage.getItem('Saved Session')");
		expect(result).toContain(
			'var ENABLE_HARLOWE_SESSION_STORAGE_FALLBACK = false'
		);
		expect(result).toContain("'Harlowe session'");
		expect(result).toContain('<body>Story</body>');
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
		).not.toBeInTheDocument();
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
						model.debugger.hello?.id === 'sugarcube-2.37.3' &&
						model.debugger.snapshot?.currentPassage?.id === 'candidate-id'
				)
			).toBe(true)
		);
		fireEvent.click(screen.getByRole('button', {name: 'Debugger'}));
		expect(
			within(
				screen.getByRole('region', {name: 'Runtime debugger inspector'})
			).getAllByText('Candidate passage')
		).toHaveLength(2);
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

		fireEvent.click(screen.getByRole('button', {name: 'Source'}));
		fireEvent.click(screen.getByRole('button', {name: 'Graph'}));
		fireEvent.click(screen.getByRole('button', {name: 'Test Current'}));

		expect(onRevealSource).toHaveBeenCalledWith('lighthouse');
		expect(onRevealGraph).toHaveBeenCalledWith('lighthouse');
		expect(onTestCurrentPassage).toHaveBeenCalledWith('lighthouse');
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
				html="<html><body>Story</body></html>"
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
			within(inspector).getByRole('button', {name: 'Open Second in Source'})
		);
		fireEvent.click(
			within(inspector).getByRole('button', {name: 'Open Second in Graph'})
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
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('region', {name: 'Runtime debugger inspector'})
		).not.toBeInTheDocument();
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
				name: 'Open Start in Source'
			})
		).toHaveLength(1);
		fireEvent.click(
			within(historySection!).getByRole('button', {
				name: 'Open Start in Source'
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
		expect(within(inspector).queryAllByRole('button')).toHaveLength(0);
		expect(onRevealGraph).not.toHaveBeenCalled();
		expect(onRevealSource).not.toHaveBeenCalled();
	});
});
