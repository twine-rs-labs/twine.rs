import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {HashRouter, Route, Routes} from 'react-router';
import {CoreProjectHostProvider} from '../../../core';
import {StoriesContext} from '../../../store/stories';
import {usePublishing} from '../../../store/use-publishing';
import {fakeStory} from '../../../test-util';
import {browserRuntimeLogCopy, StoryPreviewRoute} from '../story-preview-route';
import {STORY_PREVIEW_BRIDGE_SOURCE} from '../../story-preview-debug';
import {browserPreviewOwnerProtocol} from '../../browser-preview-owner-registry';

jest.mock('../../../store/use-publishing');

describe('<StoryPreviewRoute>', () => {
	const usePublishingMock = usePublishing as jest.Mock;

	function renderComponent(route: string) {
		const story = {...fakeStory(), id: '123'};

		window.location.hash = route;
		const result = render(
			<StoriesContext.Provider value={{dispatch: jest.fn(), stories: [story]}}>
				<CoreProjectHostProvider>
					<HashRouter>
						<Routes>
							<Route
								element={<StoryPreviewRoute />}
								path="/stories/:storyId/preview"
							/>
						</Routes>
					</HashRouter>
				</CoreProjectHostProvider>
			</StoriesContext.Provider>
		);

		return {...result, story};
	}

	function postRuntimePassage(
		title: string,
		passage: {id: string; name: string}
	) {
		const frame = screen.getByTitle(title) as HTMLIFrameElement;
		const sessionId = frame
			.getAttribute('srcdoc')
			?.match(/var SESSION = "([^"]+)"/)?.[1];

		if (!sessionId) {
			throw new Error('Could not read the preview bridge session ID.');
		}
		act(() => {
			window.dispatchEvent(
				new MessageEvent('message', {
					data: {
						currentPassage: {
							localId: '1',
							name: passage.name,
							source: 'runtime'
						},
						sessionId,
						source: STORY_PREVIEW_BRIDGE_SOURCE,
						time: 10,
						type: 'state',
						viewport: {height: 700, width: 390}
					},
					source: frame.contentWindow
				})
			);
		});
	}

	function mockPublishing() {
		const buildStoryPreviewPackage = jest.fn(
			async (_storyId: string, target: string) => ({
				admission: {kind: 'none'},
				build: {
					html:
						target === 'proof' ? 'mock-proofed-story' : 'mock-published-story'
				},
				summary: undefined
			})
		);

		usePublishingMock.mockReturnValue({buildStoryPreviewPackage});
		return {buildStoryPreviewPackage};
	}

	it.each([
		{
			expectedLabel: 'Play',
			expectedTitle: 'Story preview',
			route: '/stories/123/preview?target=play',
			target: 'play'
		},
		{
			expectedLabel: 'Test',
			expectedTitle: 'Story test preview',
			route: '/stories/123/preview?target=test',
			target: 'test'
		}
	])(
		'renders the $target target through the canonical preview route',
		async ({expectedLabel, expectedTitle, route, target}) => {
			const {buildStoryPreviewPackage} = mockPublishing();

			renderComponent(route);
			await waitFor(() =>
				expect(
					screen.getByTitle(expectedTitle).getAttribute('srcdoc')
				).toContain('mock-published-story')
			);
			expect(screen.getByText(expectedLabel)).toBeInTheDocument();
			expect(buildStoryPreviewPackage).toHaveBeenCalledWith(
				'123',
				target,
				target === 'test' ? {formatOptions: 'debug', startId: undefined} : {}
			);
		}
	);

	it('keeps Test From Here on the canonical route with an explicit start passage', async () => {
		const {buildStoryPreviewPackage} = mockPublishing();

		renderComponent('/stories/123/preview?target=test&passage=456');
		await waitFor(() =>
			expect(buildStoryPreviewPackage).toHaveBeenCalledWith('123', 'test', {
				formatOptions: 'debug',
				startId: '456',
				startMode: 'afterStartup'
			})
		);
	});

	it('returns Test From Start to the story start instead of the requested passage', async () => {
		const {buildStoryPreviewPackage} = mockPublishing();

		renderComponent('/stories/123/preview?target=test&passage=456');
		await waitFor(() => expect(buildStoryPreviewPackage).toHaveBeenCalled());
		fireEvent.click(screen.getByRole('button', {name: 'Test From Start'}));

		await waitFor(() =>
			expect(window.location.hash).toBe('#/stories/123/preview?target=test')
		);
	});

	it('uses proofing format query parameters on the same route', async () => {
		const {buildStoryPreviewPackage} = mockPublishing();

		renderComponent(
			'/stories/123/preview?target=proof&proofingFormatName=Paperthin&proofingFormatVersion=1.0.0'
		);
		await waitFor(() =>
			expect(buildStoryPreviewPackage).toHaveBeenCalledWith('123', 'proof', {
				proofingFormat: {name: 'Paperthin', version: '1.0.0'}
			})
		);
		expect(screen.getByText('Proof')).toBeInTheDocument();
	});

	it('reveals in the owner tab and keeps an accepted preview open', async () => {
		mockPublishing();
		const {story} = renderComponent(
			'/stories/123/preview?target=play&ownerToken=owner-token'
		);
		await waitFor(() =>
			expect(screen.getByTitle('Story preview')).toHaveAttribute('srcdoc')
		);
		postRuntimePassage('Story preview', story.passages[0]);

		const port1 = {
			close: jest.fn(),
			onmessage: undefined as any,
			postMessage: jest.fn()
		};
		const port2 = {
			postMessage(message: unknown) {
				port1.onmessage?.({data: message});
			}
		};
		const MessageChannelMock = jest.fn(() => ({port1, port2}));
		const postMessage = jest.fn(
			(message: any, _origin: string, transfer: MessagePort[]) => {
				const ownerPort = transfer[0] as unknown as typeof port2;

				ownerPort.postMessage({
					requestId: message.requestId,
					source: browserPreviewOwnerProtocol.source,
					status: 'accepted',
					type: 'reveal-result',
					version: browserPreviewOwnerProtocol.version
				});
				ownerPort.postMessage({
					requestId: message.requestId,
					source: browserPreviewOwnerProtocol.source,
					status: 'success',
					type: 'reveal-result',
					version: browserPreviewOwnerProtocol.version
				});
			}
		);
		const previousMessageChannel = globalThis.MessageChannel;
		const previousOpener = window.opener;

		Object.defineProperty(globalThis, 'MessageChannel', {
			configurable: true,
			value: MessageChannelMock
		});
		Object.defineProperty(window, 'opener', {
			configurable: true,
			value: {closed: false, postMessage}
		});
		try {
			fireEvent.click(screen.getByRole('button', {name: 'Edit Passage'}));
			expect(postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					mode: 'text',
					passageId: story.passages[0].id,
					source: browserPreviewOwnerProtocol.source,
					storyId: '123',
					token: 'owner-token',
					type: 'reveal'
				}),
				window.location.origin,
				[port2]
			);
			expect(window.location.hash).toBe(
				'#/stories/123/preview?target=play&ownerToken=owner-token'
			);
		} finally {
			Object.defineProperty(globalThis, 'MessageChannel', {
				configurable: true,
				value: previousMessageChannel
			});
			Object.defineProperty(window, 'opener', {
				configurable: true,
				value: previousOpener
			});
		}
	});

	it('keeps the preview open when its valid owner rejects a stale reveal', async () => {
		mockPublishing();
		const {story} = renderComponent(
			'/stories/123/preview?target=play&ownerToken=owner-token'
		);
		await waitFor(() =>
			expect(screen.getByTitle('Story preview')).toHaveAttribute('srcdoc')
		);
		postRuntimePassage('Story preview', story.passages[0]);

		const port1 = {
			close: jest.fn(),
			onmessage: undefined as any,
			postMessage: jest.fn()
		};
		const port2 = {
			postMessage(message: unknown) {
				port1.onmessage?.({data: message});
			}
		};
		const previousMessageChannel = globalThis.MessageChannel;
		const previousOpener = window.opener;

		Object.defineProperty(globalThis, 'MessageChannel', {
			configurable: true,
			value: jest.fn(() => ({port1, port2}))
		});
		Object.defineProperty(window, 'opener', {
			configurable: true,
			value: {
				closed: false,
				postMessage: jest.fn(
					(message: any, _origin: string, transfer: MessagePort[]) => {
						const ownerPort = transfer[0] as unknown as typeof port2;

						ownerPort.postMessage({
							requestId: message.requestId,
							message: 'Passage deleted',
							source: browserPreviewOwnerProtocol.source,
							status: 'rejected',
							type: 'reveal-result',
							version: browserPreviewOwnerProtocol.version
						});
					}
				)
			}
		});
		try {
			fireEvent.click(screen.getByRole('button', {name: 'Edit Passage'}));
			expect(window.location.hash).toBe(
				'#/stories/123/preview?target=play&ownerToken=owner-token'
			);
			expect(port1.close).toHaveBeenCalledTimes(1);
		} finally {
			Object.defineProperty(globalThis, 'MessageChannel', {
				configurable: true,
				value: previousMessageChannel
			});
			Object.defineProperty(window, 'opener', {
				configurable: true,
				value: previousOpener
			});
		}
	});

	it('falls back to self-navigation only when no owner is available', async () => {
		mockPublishing();
		const {story} = renderComponent(
			'/stories/123/preview?target=play&ownerToken=owner-token'
		);
		await waitFor(() =>
			expect(screen.getByTitle('Story preview')).toHaveAttribute('srcdoc')
		);
		postRuntimePassage('Story preview', story.passages[0]);
		const previousOpener = window.opener;

		Object.defineProperty(window, 'opener', {
			configurable: true,
			value: null
		});
		try {
			fireEvent.click(screen.getByRole('button', {name: 'Reveal in Graph'}));
			await waitFor(() =>
				expect(window.location.hash).toBe(
					`#/stories/123?mode=graph&passage=${story.passages[0].id}`
				)
			);
		} finally {
			Object.defineProperty(window, 'opener', {
				configurable: true,
				value: previousOpener
			});
		}
	});

	it('falls back when the owner transport does not acknowledge the reveal', async () => {
		mockPublishing();
		const {story} = renderComponent(
			'/stories/123/preview?target=play&ownerToken=owner-token'
		);
		await waitFor(() =>
			expect(screen.getByTitle('Story preview')).toHaveAttribute('srcdoc')
		);
		postRuntimePassage('Story preview', story.passages[0]);
		const previousMessageChannel = globalThis.MessageChannel;
		const previousOpener = window.opener;
		const port1 = {
			close: jest.fn(),
			onmessage: undefined as any,
			postMessage: jest.fn()
		};
		const port2 = {postMessage: jest.fn()};

		Object.defineProperty(globalThis, 'MessageChannel', {
			configurable: true,
			value: jest.fn(() => ({port1, port2}))
		});
		Object.defineProperty(window, 'opener', {
			configurable: true,
			value: {closed: false, postMessage: jest.fn()}
		});
		jest.useFakeTimers();
		try {
			fireEvent.click(screen.getByRole('button', {name: 'Reveal in Graph'}));
			act(() => jest.advanceTimersByTime(1500));
			expect(window.location.hash).toBe(
				`#/stories/123?mode=graph&passage=${story.passages[0].id}`
			);
			expect(port1.close).toHaveBeenCalledTimes(1);
		} finally {
			jest.useRealTimers();
			Object.defineProperty(globalThis, 'MessageChannel', {
				configurable: true,
				value: previousMessageChannel
			});
			Object.defineProperty(window, 'opener', {
				configurable: true,
				value: previousOpener
			});
		}
	});

	it('shows publishing failures in the shared preview surface', async () => {
		usePublishingMock.mockReturnValue({
			buildStoryPreviewPackage: jest.fn(async () => {
				throw new Error('mock-error-message');
			})
		});

		renderComponent('/stories/123/preview?target=test');
		await waitFor(() =>
			expect(document.body.textContent).toContain('mock-error-message')
		);
	});
});

describe('browserRuntimeLogCopy', () => {
	it('uses supported clipboard writes and propagates rejection', async () => {
		const writeText = jest.fn().mockRejectedValue(new Error('denied'));
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {writeText}
		});

		const copy = browserRuntimeLogCopy();
		await expect(copy?.('runtime log')).rejects.toThrow('denied');
		expect(writeText).toHaveBeenCalledWith('runtime log');
	});

	it('is unavailable when clipboard writeText is unsupported', () => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: undefined
		});
		expect(browserRuntimeLogCopy()).toBeUndefined();
	});
});
