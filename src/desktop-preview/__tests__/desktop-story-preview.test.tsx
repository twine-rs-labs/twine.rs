import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import type {
	NativeStoryPreviewAppearanceUpdate,
	NativeStoryPreviewCommandResult,
	NativeStoryPreviewDescriptor,
	NativeStoryPreviewReplacementResult
} from '../../electron/shared';
import type {NativeStoryPreviewBridge} from '../../electron/preview-ipc-channels';
import {STORY_PREVIEW_BRIDGE_SOURCE} from '../../routes/story-preview-debug';
import {DesktopStoryPreview} from '../desktop-story-preview';

function descriptor(
	overrides: Partial<NativeStoryPreviewDescriptor> = {}
): NativeStoryPreviewDescriptor {
	return {
		appearance: {
			highContrast: false,
			reducedMotion: false,
			theme: 'dark'
		},
		bridgeSessionId: 'bridge-1',
		generation: 1,
		htmlBytes: 1234,
		launchPassage: {id: 'passage-1', name: 'Start'},
		passages: [{id: 'passage-1', localId: '1', name: 'Start'}],
		sessionId: 'session-1',
		storyDataCount: 1,
		storyId: 'story-1',
		storyName: 'Story',
		target: 'play',
		...overrides
	};
}

function previewApi() {
	let appearanceListener:
		((update: NativeStoryPreviewAppearanceUpdate) => void) | undefined;
	let commandResultListener:
		((result: NativeStoryPreviewCommandResult) => void) | undefined;
	let replacementListener:
		((result: NativeStoryPreviewReplacementResult) => void) | undefined;
	const unsubscribers = {
		appearance: jest.fn(),
		commandResult: jest.fn(),
		replacement: jest.fn()
	};
	const api: NativeStoryPreviewBridge = {
		command: jest.fn().mockResolvedValue({
			command: 'revealSource',
			generation: 1,
			status: 'busy'
		}),
		frameLoaded: jest.fn().mockResolvedValue(undefined),
		getInitialState: jest.fn().mockResolvedValue({
			descriptor: descriptor(),
			url: 'twine-preview://00000000-0000-4000-8000-000000000001/index.html'
		}),
		onAppearance(callback) {
			appearanceListener = callback;
			return unsubscribers.appearance;
		},
		onCommandResult(callback) {
			commandResultListener = callback;
			return unsubscribers.commandResult;
		},
		onReplacement(callback) {
			replacementListener = callback;
			return unsubscribers.replacement;
		},
		ready: jest.fn()
	};

	return {
		api,
		appearance(update: NativeStoryPreviewAppearanceUpdate) {
			act(() => appearanceListener?.(update));
		},
		commandResult(result: NativeStoryPreviewCommandResult) {
			act(() => commandResultListener?.(result));
		},
		replacement(result: NativeStoryPreviewReplacementResult) {
			act(() => replacementListener?.(result));
		},
		unsubscribers
	};
}

function postRuntimeLog(frame: HTMLElement, message: string) {
	act(() => {
		window.dispatchEvent(
			new MessageEvent('message', {
				data: {
					args: [message],
					level: 'warn',
					sessionId: 'bridge-1',
					source: STORY_PREVIEW_BRIDGE_SOURCE,
					time: 10,
					type: 'console'
				},
				source: (frame as HTMLIFrameElement).contentWindow
			})
		);
	});
}

describe('<DesktopStoryPreview>', () => {
	it('loads the narrow bridge state, applies appearance, and routes commands', async () => {
		const fixture = previewApi();
		const {unmount} = render(<DesktopStoryPreview api={fixture.api} />);
		const frame = await screen.findByTitle('Story story preview');

		expect(frame).toHaveAttribute(
			'src',
			'twine-preview://00000000-0000-4000-8000-000000000001/index.html'
		);
		expect(fixture.api.ready).toHaveBeenCalledWith(1);
		expect(document.body).toHaveAttribute('data-app-theme', 'dark');

		fireEvent.load(frame);
		await waitFor(() =>
			expect(fixture.api.frameLoaded).toHaveBeenCalledWith(1)
		);

		fireEvent.click(screen.getByRole('button', {name: 'Source'}));
		await waitFor(() =>
			expect(fixture.api.command).toHaveBeenCalledWith({
				generation: 1,
				type: 'revealSource'
			})
		);

		fixture.appearance({
			appearance: {
				highContrast: true,
				reducedMotion: true,
				theme: 'light'
			},
			generation: 1
		});
		expect(document.body).toHaveAttribute('data-app-theme', 'light');
		expect(document.body).toHaveAttribute('data-high-contrast', 'true');
		expect(document.body).toHaveAttribute('data-reduced-motion', 'true');

		unmount();
		expect(fixture.unsubscribers.appearance).toHaveBeenCalled();
		expect(fixture.unsubscribers.commandResult).toHaveBeenCalled();
		expect(fixture.unsubscribers.replacement).toHaveBeenCalled();
	});

	it('keeps existing content on failure and accepts only coherent newer replacements', async () => {
		const fixture = previewApi();

		render(<DesktopStoryPreview api={fixture.api} />);
		const originalFrame = await screen.findByTitle('Story story preview');
		const originalUrl = originalFrame.getAttribute('src');

		postRuntimeLog(originalFrame, 'committed runtime');
		expect(screen.getByText('1 log')).toBeInTheDocument();
		expect(screen.getByText('committed runtime')).toBeInTheDocument();

		fixture.replacement({
			generation: 2,
			message: 'The latest story could not be built.',
			operation: 'replacement',
			status: 'error'
		});
		expect(
			await screen.findByText('The latest story could not be built.')
		).toHaveAttribute('role', 'alert');
		expect(screen.getByTitle('Story story preview')).toHaveAttribute(
			'src',
			originalUrl
		);

		fixture.replacement({
			generation: 2,
			replacement: {
				descriptor: descriptor({
					bridgeSessionId: 'bridge-2',
					generation: 2,
					storyName: 'Updated Story',
					target: 'test'
				}),
				generation: 2,
				url: 'twine-preview://00000000-0000-4000-8000-000000000002/index.html'
			},
			status: 'success'
		});

		const firstCandidate = await screen.findByTitle(
			'Updated Story candidate story preview'
		);

		expect(firstCandidate).toHaveAttribute(
			'src',
			'twine-preview://00000000-0000-4000-8000-000000000002/index.html'
		);
		expect(screen.getByTitle('Story story preview')).toBe(originalFrame);
		expect(screen.getByText('1 log')).toBeInTheDocument();
		expect(
			screen.queryByText('The latest story could not be built.')
		).not.toBeInTheDocument();

		fixture.replacement({
			generation: 2,
			message: 'The replacement frame failed to load.',
			operation: 'replacement',
			status: 'error'
		});
		expect(
			screen.queryByTitle('Updated Story candidate story preview')
		).toBeNull();
		expect(screen.getByTitle('Story story preview')).toBe(originalFrame);
		expect(originalFrame).toHaveAttribute('src', originalUrl);
		expect(screen.getByText('1 log')).toBeInTheDocument();
		expect(screen.getByText('committed runtime')).toBeInTheDocument();
		expect(
			screen.getByText('The replacement frame failed to load.')
		).toHaveAttribute('role', 'alert');

		fixture.replacement({
			generation: 2,
			replacement: {
				descriptor: descriptor({
					bridgeSessionId: 'bridge-2',
					generation: 2,
					storyName: 'Updated Story',
					target: 'test'
				}),
				generation: 2,
				url: 'twine-preview://00000000-0000-4000-8000-000000000002/index.html'
			},
			status: 'success'
		});
		const committedCandidate = await screen.findByTitle(
			'Updated Story candidate story preview'
		);

		expect(screen.getByTitle('Story story preview')).toBe(originalFrame);
		fireEvent.load(committedCandidate);
		await waitFor(() =>
			expect(fixture.api.frameLoaded).toHaveBeenLastCalledWith(2)
		);
		await waitFor(() =>
			expect(screen.getByTitle('Updated Story story preview')).toBe(
				committedCandidate
			)
		);
		await waitFor(() => expect(screen.getByText('0 logs')).toBeInTheDocument());

		fixture.replacement({
			generation: 3,
			replacement: {
				descriptor: descriptor({generation: 4}),
				generation: 3,
				url: 'twine-preview://00000000-0000-4000-8000-000000000003/index.html'
			},
			status: 'success'
		});
		expect(screen.getByTitle('Updated Story story preview')).toHaveAttribute(
			'src',
			'twine-preview://00000000-0000-4000-8000-000000000002/index.html'
		);
	});

	it('restores committed content when main rejects a frame-load acknowledgement', async () => {
		const fixture = previewApi();

		render(<DesktopStoryPreview api={fixture.api} />);
		const originalFrame = await screen.findByTitle('Story story preview');
		const originalUrl = originalFrame.getAttribute('src');

		fixture.replacement({
			generation: 2,
			replacement: {
				descriptor: descriptor({
					bridgeSessionId: 'bridge-2',
					generation: 2,
					storyName: 'Candidate Story',
					target: 'test'
				}),
				generation: 2,
				url: 'twine-preview://00000000-0000-4000-8000-000000000002/index.html'
			},
			status: 'success'
		});
		(fixture.api.frameLoaded as jest.Mock).mockRejectedValueOnce(
			new Error('The candidate was already rolled back.')
		);
		const candidate = await screen.findByTitle(
			'Candidate Story candidate story preview'
		);

		expect(screen.getByTitle('Story story preview')).toBe(originalFrame);
		fireEvent.load(candidate);

		await waitFor(() =>
			expect(
				screen.queryByTitle('Candidate Story candidate story preview')
			).not.toBeInTheDocument()
		);
		expect(screen.getByTitle('Story story preview')).toBe(originalFrame);
		expect(originalFrame).toHaveAttribute('src', originalUrl);
		expect(
			screen.getByText('The candidate was already rolled back.')
		).toHaveAttribute('role', 'alert');
	});

	it('disables duplicate test commands until main reports completion', async () => {
		const fixture = previewApi();

		render(<DesktopStoryPreview api={fixture.api} />);
		const testFromStart = await screen.findByRole('button', {
			name: 'Test From Start'
		});

		fireEvent.click(testFromStart);
		await waitFor(() => expect(testFromStart).toBeDisabled());
		fireEvent.click(testFromStart);
		expect(fixture.api.command).toHaveBeenCalledTimes(1);

		fixture.commandResult({
			command: 'testFromStart',
			generation: 1,
			status: 'success'
		});
		await waitFor(() => expect(testFromStart).toBeEnabled());
	});
});
