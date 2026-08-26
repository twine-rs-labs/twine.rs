import * as React from 'react';
import {useNavigate} from 'react-router';
import {useStoriesContext} from '../store/stories';
import {
	browserPreviewOwner,
	browserPreviewOwnerAcceptanceTimeoutMs,
	browserPreviewOwnerProtocol,
	isBrowserPreviewRevealControl,
	isBrowserPreviewRevealRequest,
	type BrowserPreviewRevealResult
} from './browser-preview-owner-registry';
import {
	finalizeStoryEditReveal,
	registerStoryEditReveal,
	rejectStoryEditReveal,
	storyEditRevealUrl
} from './story-edit-reveal';

const maxRevealErrorLength = 4096;

function uniquePassage(
	story: {passages: Array<{id: string}>},
	passageId: string
) {
	const matches = story.passages.filter(passage => passage.id === passageId);
	return matches.length === 1 ? matches[0] : undefined;
}

function revealResult(
	status: BrowserPreviewRevealResult['status'],
	requestId: string,
	message?: string
): BrowserPreviewRevealResult {
	return {
		...(message ? {message: message.slice(0, maxRevealErrorLength)} : {}),
		requestId,
		source: browserPreviewOwnerProtocol.source,
		status,
		type: 'reveal-result',
		version: browserPreviewOwnerProtocol.version
	};
}

/**
 * Browser equivalent of the Electron owner bridge. It accepts only the exact
 * popup registered for the opaque launch token and replies only over the
 * request's transferred port.
 */
export const BrowserStoryPreviewOwnerController: React.FC = () => {
	const navigate = useNavigate();
	const {stories} = useStoriesContext();
	const current = React.useRef({navigate, stories});
	const revealQueue = React.useRef(Promise.resolve());

	current.current = {navigate, stories};

	React.useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (
				event.origin !== window.location.origin ||
				!isBrowserPreviewRevealRequest(event.data) ||
				event.ports.length !== 1
			) {
				return;
			}

			const request = event.data;
			const port = event.ports[0];
			const entry = browserPreviewOwner(request.token);

			if (!entry) {
				// The registry is a best-effort transport capability. An evicted or
				// missing entry must let the popup's acceptance timer use its normal
				// self-navigation fallback, rather than authoritatively rejecting it.
				port.close();
				return;
			}

			if (entry.preview !== event.source || entry.storyId !== request.storyId) {
				port.postMessage(revealResult('rejected', request.requestId));
				port.close();
				return;
			}
			const acceptanceDeadline = Math.min(
				request.acceptanceDeadline,
				Date.now() + browserPreviewOwnerAcceptanceTimeoutMs
			);
			if (acceptanceDeadline <= Date.now()) {
				port.postMessage(revealResult('rejected', request.requestId));
				port.close();
				return;
			}
			let cancelled = false;
			let committed = false;
			const editRequestId = `browser-reveal-${request.requestId}`;
			let settleCommit: ((committed: boolean) => void) | undefined;
			const commit = new Promise<boolean>(resolve => {
				settleCommit = resolve;
			});
			const commitTimeout = setTimeout(
				() => settleCommit?.(false),
				Math.max(0, acceptanceDeadline - Date.now())
			);
			// Install this before queueing, so a popup can cancel a request that is
			// waiting behind another reveal.
			port.onmessage = controlEvent => {
				if (
					!isBrowserPreviewRevealControl(controlEvent.data) ||
					controlEvent.data.requestId !== request.requestId
				)
					return;
				if (controlEvent.data.type === 'cancel') {
					cancelled = true;
					rejectStoryEditReveal(
						editRequestId,
						new Error('The browser preview reveal was cancelled.')
					);
				}
				if (controlEvent.data.type === 'commit') {
					if (Date.now() < acceptanceDeadline) {
						committed = true;
						clearTimeout(commitTimeout);
					}
				}
				settleCommit?.(committed);
			};
			port.start?.();
			const live = () =>
				!cancelled && (committed || Date.now() < acceptanceDeadline);

			const execute = async () => {
				if (!live()) {
					port.close();
					return;
				}
				const active = current.current;
				const story = active.stories.find(
					candidate => candidate.id === request.storyId
				);
				const passage = story
					? uniquePassage(story, request.passageId)
					: undefined;

				if (!story || !passage) {
					port.postMessage(
						revealResult(
							'rejected',
							request.requestId,
							'The requested story or passage no longer exists.'
						)
					);
					port.close();
					return;
				}

				let applied: Promise<void> | undefined;

				try {
					if (!live()) return;
					port.postMessage(revealResult('accepted', request.requestId));
					const didCommit = await commit;
					if (!didCommit || !committed || !live()) return;
					applied = registerStoryEditReveal(editRequestId);
					// The route can reject while navigation is being scheduled. Attach a
					// handler now so an abandoned popup cannot create an unhandled rejection.
					void applied.catch(() => undefined);
					window.focus();
					if (!live()) return;
					active.navigate(
						storyEditRevealUrl(
							story.id,
							request.mode,
							passage.id,
							editRequestId
						)
					);
					await applied;
					if (live()) {
						port.postMessage(revealResult('success', request.requestId));
						finalizeStoryEditReveal(editRequestId);
					}
				} catch (error) {
					rejectStoryEditReveal(
						editRequestId,
						error instanceof Error
							? error
							: new Error('The reveal request failed.')
					);
					await applied?.catch(() => undefined);
					port.postMessage(
						revealResult(
							'rejected',
							request.requestId,
							error instanceof Error ? error.message : undefined
						)
					);
				} finally {
					clearTimeout(commitTimeout);
					port.close();
				}
			};

			const queued = revealQueue.current.then(execute, execute);
			revealQueue.current = queued.then(
				() => undefined,
				() => undefined
			);
		};

		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, []);

	return null;
};
