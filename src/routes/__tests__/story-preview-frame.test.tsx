import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {
	instrumentPreviewHtml,
	STORY_PREVIEW_BRIDGE_SOURCE,
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
		expect(result).toContain("sessionStorage.getItem('Saved Session')");
		expect(result).toContain("'Harlowe session'");
		expect(result).toContain('<body>Story</body>');
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
		expect(screen.getByText('123 bytes · 1 story data')).toBeInTheDocument();

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

	it('buffers candidate runtime messages and promotes them with the frame', async () => {
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
				storyExists
				title="Committed preview"
			/>
		);

		rerender(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing story"
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

		expect(screen.getByText('0 logs')).toBeInTheDocument();
		expect(screen.queryByText('candidate startup')).not.toBeInTheDocument();
		expect(screen.queryByText('candidate rejection')).not.toBeInTheDocument();

		rerender(
			<StoryPreviewFrame
				contentSource={candidateSource}
				missingStoryMessage="Missing story"
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
	});

	it('discards buffered candidate messages on rollback', async () => {
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
		rerender(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing story"
				storyExists
				title="Committed preview"
			/>
		);
		rerender(
			<StoryPreviewFrame
				contentSource={currentSource}
				missingStoryMessage="Missing story"
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

		expect(screen.getByText('1 logs')).toBeInTheDocument();
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
});
