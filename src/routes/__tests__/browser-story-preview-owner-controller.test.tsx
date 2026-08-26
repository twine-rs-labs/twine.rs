import {act, render, waitFor} from '@testing-library/react';
import * as React from 'react';
import {useNavigate} from 'react-router';
import {StoriesContext} from '../../store/stories';
import {
	browserPreviewOwnerProtocol,
	registerBrowserPreviewOwner,
	unregisterBrowserPreviewOwner
} from '../browser-preview-owner-registry';
import {BrowserStoryPreviewOwnerController} from '../browser-story-preview-owner-controller';
import {
	armStoryEditRevealRollback,
	registerStoryEditRevealRollback,
	settleStoryEditReveal
} from '../story-edit-reveal';

function settleAppliedReveal(requestId: string) {
	// These controller tests simulate the route's post-write acknowledgement.
	registerStoryEditRevealRollback(requestId, () => undefined);
	armStoryEditRevealRollback(requestId);
	return settleStoryEditReveal(requestId);
}

jest.mock('@lukeed/uuid', () => ({v4: () => 'browser-request'}));
jest.mock('react-router', () => ({
	...jest.requireActual('react-router'),
	useNavigate: jest.fn()
}));

class CapturingPort {
	close = jest.fn();
	messages: unknown[] = [];
	onmessage: ((event: MessageEvent) => void) | null = null;
	postMessage = jest.fn((message: unknown) => {
		this.messages.push(message);
	});
	receive(message: unknown) {
		this.onmessage?.({data: message} as MessageEvent);
	}
}

describe('<BrowserStoryPreviewOwnerController>', () => {
	const navigate = jest.fn();
	const story = {
		id: 'story',
		passages: [{id: 'passage', name: 'Passage'}]
	};
	const preview = {closed: false} as WindowProxy;

	function renderController() {
		return render(
			<StoriesContext.Provider
				value={{dispatch: jest.fn(), stories: [story] as any}}
			>
				<BrowserStoryPreviewOwnerController />
			</StoriesContext.Provider>
		);
	}

	function requestEvent(
		port: CapturingPort,
		overrides: Record<string, unknown> = {},
		source: MessageEventSource | null = preview
	) {
		const event = new MessageEvent('message', {
			data: {
				acceptanceDeadline: Date.now() + 10_000,
				mode: 'text',
				passageId: 'passage',
				requestId: 'preview-request',
				source: browserPreviewOwnerProtocol.source,
				storyId: 'story',
				token: 'owner-token',
				type: 'reveal',
				version: browserPreviewOwnerProtocol.version,
				...overrides
			},
			origin: window.location.origin,
			ports: [port as unknown as MessagePort],
			source
		});

		window.dispatchEvent(event);
	}

	beforeEach(() => {
		navigate.mockReset();
		(useNavigate as jest.Mock).mockReturnValue(navigate);
		jest.spyOn(window, 'focus').mockImplementation(() => undefined);
		registerBrowserPreviewOwner({
			preview,
			storyId: 'story',
			token: 'owner-token'
		});
	});

	afterEach(() => {
		unregisterBrowserPreviewOwner('owner-token');
		jest.restoreAllMocks();
	});

	it('accepts only the registered popup and reports success after editor apply', async () => {
		const port = new CapturingPort();

		renderController();
		act(() => requestEvent(port));

		await waitFor(() =>
			expect(port.messages).toContainEqual(
				expect.objectContaining({status: 'accepted'})
			)
		);
		act(() =>
			port.receive({
				requestId: 'preview-request',
				source: browserPreviewOwnerProtocol.source,
				type: 'commit',
				version: browserPreviewOwnerProtocol.version
			})
		);
		await waitFor(() => expect(navigate).toHaveBeenCalled());
		expect(window.focus).toHaveBeenCalledTimes(1);
		expect(navigate).toHaveBeenCalledWith(
			'/stories/story?mode=text&passage=passage&revealRequest=browser-reveal-preview-request'
		);
		expect(port.messages).not.toContainEqual(
			expect.objectContaining({status: 'success'})
		);

		act(() => {
			settleAppliedReveal('browser-reveal-preview-request');
		});
		await waitFor(() =>
			expect(port.messages).toContainEqual(
				expect.objectContaining({status: 'success'})
			)
		);
		expect(port.close).toHaveBeenCalledTimes(1);
	});

	it('rejects a mismatched popup source without navigating or focusing', async () => {
		const port = new CapturingPort();

		renderController();
		act(() => requestEvent(port, {}, {closed: false} as WindowProxy));

		await waitFor(() =>
			expect(port.messages).toContainEqual(
				expect.objectContaining({status: 'rejected'})
			)
		);
		expect(navigate).not.toHaveBeenCalled();
		expect(window.focus).not.toHaveBeenCalled();
	});

	it('does not accept a queued reveal after its popup cancels on timeout', async () => {
		const first = new CapturingPort();
		const second = new CapturingPort();

		renderController();
		act(() => requestEvent(first, {requestId: 'first-request'}));
		await waitFor(() =>
			expect(first.messages).toContainEqual(
				expect.objectContaining({status: 'accepted'})
			)
		);
		act(() =>
			first.receive({
				requestId: 'first-request',
				source: browserPreviewOwnerProtocol.source,
				type: 'commit',
				version: browserPreviewOwnerProtocol.version
			})
		);
		await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));

		act(() => {
			requestEvent(second, {requestId: 'second-request'});
			second.receive({
				requestId: 'second-request',
				source: browserPreviewOwnerProtocol.source,
				type: 'cancel',
				version: browserPreviewOwnerProtocol.version
			});
			settleAppliedReveal('browser-reveal-first-request');
		});
		await waitFor(() =>
			expect(first.messages).toContainEqual(
				expect.objectContaining({status: 'success'})
			)
		);
		expect(second.messages).not.toContainEqual(
			expect.objectContaining({status: 'accepted'})
		);
		expect(navigate).toHaveBeenCalledTimes(1);
		expect(window.focus).toHaveBeenCalledTimes(1);
	});

	it('releases the queue when an accepted popup never commits', async () => {
		jest.useFakeTimers();
		const first = new CapturingPort();
		const second = new CapturingPort();

		try {
			renderController();
			act(() => {
				requestEvent(first, {
					acceptanceDeadline: Date.now() + 100,
					requestId: 'abandoned-request'
				});
				requestEvent(second, {
					acceptanceDeadline: Date.now() + 10_000,
					requestId: 'following-request'
				});
			});
			await waitFor(() =>
				expect(first.messages).toContainEqual(
					expect.objectContaining({status: 'accepted'})
				)
			);
			expect(settleAppliedReveal('browser-reveal-abandoned-request')).toBe(
				false
			);

			act(() => jest.advanceTimersByTime(100));
			await waitFor(() =>
				expect(second.messages).toContainEqual(
					expect.objectContaining({status: 'accepted'})
				)
			);
			expect(first.close).toHaveBeenCalledTimes(1);
			act(() =>
				second.receive({
					requestId: 'following-request',
					source: browserPreviewOwnerProtocol.source,
					type: 'commit',
					version: browserPreviewOwnerProtocol.version
				})
			);
			await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
			act(() => settleAppliedReveal('browser-reveal-following-request'));
			await waitFor(() =>
				expect(second.messages).toContainEqual(
					expect.objectContaining({status: 'success'})
				)
			);
		} finally {
			jest.useRealTimers();
		}
	});

	it('caps an untrusted acceptance deadline so an abandoned request cannot wedge the queue', async () => {
		jest.useFakeTimers();
		const first = new CapturingPort();
		const second = new CapturingPort();

		try {
			renderController();
			act(() => {
				requestEvent(first, {
					acceptanceDeadline: Number.MAX_SAFE_INTEGER,
					requestId: 'huge-deadline-request'
				});
			});
			await waitFor(() =>
				expect(first.messages).toContainEqual(
					expect.objectContaining({status: 'accepted'})
				)
			);
			expect(settleAppliedReveal('browser-reveal-huge-deadline-request')).toBe(
				false
			);

			act(() => jest.advanceTimersByTime(1_500));
			await waitFor(() => expect(first.close).toHaveBeenCalledTimes(1));
			act(() =>
				requestEvent(second, {
					acceptanceDeadline: Date.now() + 10_000,
					requestId: 'after-huge-deadline-request'
				})
			);
			await waitFor(() =>
				expect(second.messages).toContainEqual(
					expect.objectContaining({status: 'accepted'})
				)
			);
			act(() =>
				second.receive({
					requestId: 'after-huge-deadline-request',
					source: browserPreviewOwnerProtocol.source,
					type: 'commit',
					version: browserPreviewOwnerProtocol.version
				})
			);
			await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
			act(() =>
				settleAppliedReveal('browser-reveal-after-huge-deadline-request')
			);
			await waitFor(() =>
				expect(second.messages).toContainEqual(
					expect.objectContaining({status: 'success'})
				)
			);
		} finally {
			jest.useRealTimers();
		}
	});

	it('keeps a timely committed reveal live after its acceptance window closes', async () => {
		jest.useFakeTimers();
		const port = new CapturingPort();
		try {
			renderController();
			act(() => requestEvent(port, {acceptanceDeadline: Date.now() + 100}));
			await waitFor(() =>
				expect(port.messages).toContainEqual(
					expect.objectContaining({status: 'accepted'})
				)
			);
			act(() => {
				port.receive({
					requestId: 'preview-request',
					source: browserPreviewOwnerProtocol.source,
					type: 'commit',
					version: browserPreviewOwnerProtocol.version
				});
				jest.advanceTimersByTime(100);
			});
			await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
			act(() => settleAppliedReveal('browser-reveal-preview-request'));
			await waitFor(() =>
				expect(port.messages).toContainEqual(
					expect.objectContaining({status: 'success'})
				)
			);
		} finally {
			jest.useRealTimers();
		}
	});

	it('rejects a late commit when wall time crossed the capped deadline before its timer ran', async () => {
		jest.useFakeTimers();
		const clock = jest.spyOn(Date, 'now');
		const port = new CapturingPort();
		try {
			const now = Date.now();
			renderController();
			act(() => requestEvent(port, {acceptanceDeadline: now + 100}));
			await waitFor(() =>
				expect(port.messages).toContainEqual(
					expect.objectContaining({status: 'accepted'})
				)
			);
			clock.mockReturnValue(now + 100);
			act(() =>
				port.receive({
					requestId: 'preview-request',
					source: browserPreviewOwnerProtocol.source,
					type: 'commit',
					version: browserPreviewOwnerProtocol.version
				})
			);
			await waitFor(() => expect(port.close).toHaveBeenCalledTimes(1));
			expect(navigate).not.toHaveBeenCalled();
			expect(settleAppliedReveal('browser-reveal-preview-request')).toBe(false);
		} finally {
			clock.mockRestore();
			jest.useRealTimers();
		}
	});

	it('treats an evicted owner registry entry as unavailable transport', () => {
		const port = new CapturingPort();

		for (let index = 0; index < 32; index++) {
			registerBrowserPreviewOwner({
				preview: {closed: false} as WindowProxy,
				storyId: 'story',
				token: `replacement-${index}`
			});
		}
		renderController();
		act(() => requestEvent(port));

		expect(port.messages).toEqual([]);
		expect(port.close).toHaveBeenCalledTimes(1);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('rejects a passage deleted from the live story before acceptance', async () => {
		const port = new CapturingPort();

		renderController();
		act(() => requestEvent(port, {passageId: 'deleted'}));

		await waitFor(() =>
			expect(port.messages).toContainEqual(
				expect.objectContaining({status: 'rejected'})
			)
		);
		expect(port.messages).not.toContainEqual(
			expect.objectContaining({status: 'accepted'})
		);
		expect(navigate).not.toHaveBeenCalled();
		expect(window.focus).not.toHaveBeenCalled();
	});

	it('rejects an ambiguous live passage ID before acceptance', async () => {
		const port = new CapturingPort();

		story.passages.push({id: 'passage', name: 'Duplicate'});
		renderController();
		act(() => requestEvent(port));

		await waitFor(() =>
			expect(port.messages).toContainEqual(
				expect.objectContaining({status: 'rejected'})
			)
		);
		expect(navigate).not.toHaveBeenCalled();
		expect(window.focus).not.toHaveBeenCalled();
		story.passages.pop();
	});

	it('ignores requests from a foreign origin', () => {
		const port = new CapturingPort();

		renderController();
		act(() => {
			window.dispatchEvent(
				new MessageEvent('message', {
					data: {
						mode: 'text',
						passageId: 'passage',
						source: browserPreviewOwnerProtocol.source,
						storyId: 'story',
						token: 'owner-token',
						type: 'reveal',
						version: browserPreviewOwnerProtocol.version
					},
					origin: 'https://attacker.example',
					ports: [port as unknown as MessagePort],
					source: preview
				})
			);
		});
		expect(port.messages).toEqual([]);
		expect(navigate).not.toHaveBeenCalled();
	});
});
