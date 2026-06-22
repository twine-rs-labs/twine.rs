import {act, fireEvent, render, screen} from '@testing-library/react';
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

function postBridgeMessage(sessionId: string, data: Record<string, unknown>) {
	act(() => {
		window.dispatchEvent(
			new MessageEvent('message', {
				data: {
					source: STORY_PREVIEW_BRIDGE_SOURCE,
					sessionId,
					time: 10,
					...data
				}
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
		expect(result).toContain('<body>Story</body>');
	});
});

describe('<StoryPreviewFrame>', () => {
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

		postBridgeMessage(sessionId, {
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

		postBridgeMessage(sessionId, {
			args: ['hello', 'runtime'],
			level: 'warn',
			type: 'console'
		});

		expect(screen.getByText('1 logs')).toBeInTheDocument();
		expect(screen.getByText('hello runtime')).toBeInTheDocument();
	});
});
