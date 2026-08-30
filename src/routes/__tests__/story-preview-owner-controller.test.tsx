import * as React from 'react';
import {act, render, waitFor} from '@testing-library/react';
import {useNavigate} from 'react-router';
import {StoryPreviewOwnerController} from '../story-preview-owner-controller';
import {usePrefsContext} from '../../store/prefs';
import {useComputedTheme} from '../../store/prefs/use-computed-theme';
import {useStoriesContext} from '../../store/stories';
import {useNativeStoryPreviewPreparation} from '../../store/use-story-launch';
import {useCoreProjectHost} from '../../core/project-host-public';
import {
	armStoryEditRevealRollback,
	finalizeStoryEditReveal,
	registerStoryEditRevealRollback,
	rejectStoryEditReveal,
	settleStoryEditReveal
} from '../story-edit-reveal';

function settleAppliedReveal(requestId: string) {
	registerStoryEditRevealRollback(requestId, () => undefined);
	armStoryEditRevealRollback(requestId);
	return settleStoryEditReveal(requestId);
}

jest.mock('../../store/prefs');
jest.mock('../../store/prefs/use-computed-theme');
jest.mock('../../store/stories');
jest.mock('../../store/use-story-launch');
jest.mock('../../core/project-host-public');
jest.mock('react-router', () => ({
	...jest.requireActual('react-router'),
	useNavigate: jest.fn()
}));

describe('StoryPreviewOwnerController', () => {
	const navigate = jest.fn();
	const preparePreview = jest.fn();
	const replaceStoryPreview = jest.fn();
	const reportStoryPreviewCommandResult = jest.fn();
	const updateStoryPreviewAppearance = jest.fn();
	let commandListener: ((command: any) => void) | undefined;
	let cancellationListener: ((cancellation: any) => void) | undefined;
	let coreRevision = 1;
	let statusListener: (() => void) | undefined;

	beforeEach(() => {
		coreRevision = 1;
		statusListener = undefined;
		(useNavigate as jest.Mock).mockReturnValue(navigate);
		(usePrefsContext as jest.Mock).mockReturnValue({
			prefs: {highContrast: true, reducedMotion: false}
		});
		(useComputedTheme as jest.Mock).mockReturnValue('dark');
		(useStoriesContext as jest.Mock).mockReturnValue({
			stories: [
				{
					id: 'story',
					passages: [
						{id: 'start', name: 'Start'},
						{id: 'current', name: 'Current'}
					]
				}
			]
		});
		(useNativeStoryPreviewPreparation as jest.Mock).mockReturnValue(
			preparePreview
		);
		(useCoreProjectHost as jest.Mock).mockReturnValue({
			sessionStatus: () => ({revision: coreRevision}),
			subscribeToStatus: (listener: () => void) => {
				statusListener = listener;
				return jest.fn();
			}
		});
		preparePreview.mockResolvedValue({
			projectRoot: '/project',
			request: {descriptor: {}, html: '<html></html>'}
		});
		replaceStoryPreview.mockResolvedValue({generation: 2});
		reportStoryPreviewCommandResult.mockResolvedValue(Date.now() + 10_000);
		updateStoryPreviewAppearance.mockResolvedValue(undefined);
		(window as any).twineElectron = {
			onStoryPreviewCommandCancellation: jest.fn(
				(listener: (cancellation: any) => void) => {
					cancellationListener = listener;
					return jest.fn();
				}
			),
			onStoryPreviewCommand: jest.fn((listener: (command: any) => void) => {
				commandListener = listener;
				return jest.fn();
			}),
			replaceStoryPreview,
			reportStoryPreviewCommandResult,
			updateStoryPreviewAppearance
		};
	});

	it('does not accept or navigate a reveal cancelled before its queued work runs', async () => {
		render(<StoryPreviewOwnerController />);
		const request = {
			command: {
				generation: 1,
				requestId: 'cancelled-preview',
				type: 'revealSource'
			},
			dispatchId: 'cancelled-dispatch',
			passageId: 'current',
			sessionId: 'session',
			storyId: 'story'
		};
		act(() =>
			cancellationListener?.({
				command: request.command.type,
				dispatchId: request.dispatchId,
				generation: request.command.generation,
				message: 'cancelled',
				requestId: request.command.requestId,
				sessionId: 'session'
			})
		);
		act(() => commandListener?.(request));
		await waitFor(() =>
			expect(reportStoryPreviewCommandResult).toHaveBeenCalled()
		);
		expect(reportStoryPreviewCommandResult).not.toHaveBeenCalledWith(
			'session',
			expect.objectContaining({status: 'accepted'})
		);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('does not navigate after cancellation races an accepted reveal', async () => {
		let acknowledge!: (deadline: number) => void;
		reportStoryPreviewCommandResult.mockImplementationOnce(
			() => new Promise<number>(resolve => (acknowledge = resolve))
		);
		render(<StoryPreviewOwnerController />);
		const request = {
			command: {
				generation: 1,
				requestId: 'accepted-preview',
				type: 'revealGraph'
			},
			dispatchId: 'accepted-dispatch',
			passageId: 'current',
			sessionId: 'session',
			storyId: 'story'
		};
		act(() => commandListener?.(request));
		await waitFor(() =>
			expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith(
				'session',
				expect.objectContaining({status: 'accepted'})
			)
		);
		act(() => {
			cancellationListener?.({
				command: request.command.type,
				dispatchId: request.dispatchId,
				generation: request.command.generation,
				message: 'cancelled',
				requestId: request.command.requestId,
				sessionId: 'session'
			});
			acknowledge(Date.now() + 10_000);
		});
		await waitFor(() =>
			expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith(
				'session',
				expect.objectContaining({status: 'error'})
			)
		);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('cancels only the matching delayed reveal before the next session proceeds', async () => {
		render(<StoryPreviewOwnerController />);
		const first = {
			command: {
				generation: 1,
				requestId: 'first-preview-request',
				type: 'revealSource' as const
			},
			dispatchId: 'first-dispatch',
			passageId: 'current',
			sessionId: 'first-session',
			storyId: 'story'
		};
		const second = {
			command: {
				generation: 2,
				requestId: 'second-preview-request',
				type: 'revealGraph' as const
			},
			dispatchId: 'second-dispatch',
			passageId: 'current',
			sessionId: 'second-session',
			storyId: 'story'
		};

		act(() => {
			commandListener?.(first);
			commandListener?.(second);
		});
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(
				'/stories/story?mode=text&passage=current&revealRequest=first-dispatch'
			)
		);
		expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith(
			'first-session',
			expect.objectContaining({
				dispatchId: 'first-dispatch',
				status: 'accepted'
			})
		);

		act(() =>
			cancellationListener?.({
				command: first.command.type,
				dispatchId: first.dispatchId,
				generation: first.command.generation,
				message: 'first reveal cancelled',
				requestId: first.command.requestId,
				sessionId: first.sessionId
			})
		);
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(
				'/stories/story?mode=graph&passage=current&revealRequest=second-dispatch'
			)
		);
		expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith(
			'first-session',
			expect.objectContaining({dispatchId: 'first-dispatch', status: 'error'})
		);
		act(() => settleAppliedReveal('second-dispatch'));
		await waitFor(() =>
			expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith(
				'second-session',
				expect.objectContaining({
					dispatchId: 'second-dispatch',
					status: 'success'
				})
			)
		);
	});

	it('refreshes preview metadata when a document-only Core revision lands', () => {
		render(<StoryPreviewOwnerController />);

		expect(useNativeStoryPreviewPreparation).toHaveBeenCalledTimes(1);
		act(() => {
			coreRevision = 2;
			statusListener?.();
		});
		expect(useNativeStoryPreviewPreparation).toHaveBeenCalledTimes(2);
	});

	it('broadcasts plain owner appearance without loading preview preferences', async () => {
		render(<StoryPreviewOwnerController />);

		await waitFor(() =>
			expect(updateStoryPreviewAppearance).toHaveBeenCalledWith({
				highContrast: true,
				reducedMotion: false,
				theme: 'dark'
			})
		);
	});

	it('reveals the main editor passage and reports success', async () => {
		render(<StoryPreviewOwnerController />);

		await act(async () => {
			commandListener?.({
				command: {
					generation: 1,
					requestId: 'reveal-request',
					type: 'revealSource'
				},
				dispatchId: 'dispatch-reveal-request',
				passageId: 'current',
				sessionId: 'session',
				storyId: 'story'
			});
		});

		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(
				'/stories/story?mode=text&passage=current&revealRequest=dispatch-reveal-request'
			)
		);
		expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith('session', {
			command: 'revealSource',
			dispatchId: 'dispatch-reveal-request',
			generation: 1,
			requestId: 'reveal-request',
			status: 'accepted'
		});
		expect(reportStoryPreviewCommandResult).not.toHaveBeenCalledWith(
			'session',
			{
				command: 'revealSource',
				dispatchId: 'dispatch-reveal-request',
				generation: 1,
				requestId: 'reveal-request',
				status: 'success'
			}
		);
		act(() => {
			settleAppliedReveal('dispatch-reveal-request');
		});
		await waitFor(() =>
			expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith('session', {
				command: 'revealSource',
				dispatchId: 'dispatch-reveal-request',
				generation: 1,
				requestId: 'reveal-request',
				status: 'success'
			})
		);
	});

	it('rolls back an applied reveal when the terminal main acknowledgement rejects', async () => {
		const rollback = jest.fn();
		reportStoryPreviewCommandResult
			.mockResolvedValueOnce(Date.now() + 10_000)
			.mockRejectedValueOnce(new Error('main rejected success'));
		render(<StoryPreviewOwnerController />);
		act(() =>
			commandListener?.({
				command: {
					generation: 1,
					requestId: 'rollback-request',
					type: 'revealSource'
				},
				dispatchId: 'rollback-dispatch',
				passageId: 'current',
				sessionId: 'session',
				storyId: 'story'
			})
		);
		await waitFor(() => expect(navigate).toHaveBeenCalled());
		registerStoryEditRevealRollback('rollback-dispatch', rollback);
		armStoryEditRevealRollback('rollback-dispatch');
		act(() => settleStoryEditReveal('rollback-dispatch'));
		await waitFor(() => expect(rollback).toHaveBeenCalledTimes(1));
	});

	it('finalizes an applied reveal only after terminal main acknowledgement succeeds', async () => {
		const rollback = jest.fn();
		render(<StoryPreviewOwnerController />);
		act(() =>
			commandListener?.({
				command: {
					generation: 1,
					requestId: 'finalize-request',
					type: 'revealSource'
				},
				dispatchId: 'finalize-dispatch',
				passageId: 'current',
				sessionId: 'session',
				storyId: 'story'
			})
		);
		await waitFor(() => expect(navigate).toHaveBeenCalled());
		registerStoryEditRevealRollback('finalize-dispatch', rollback);
		armStoryEditRevealRollback('finalize-dispatch');
		act(() => settleStoryEditReveal('finalize-dispatch'));
		await waitFor(() =>
			expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith('session', {
				command: 'revealSource',
				dispatchId: 'finalize-dispatch',
				generation: 1,
				requestId: 'finalize-request',
				status: 'success'
			})
		);
		expect(
			rejectStoryEditReveal('finalize-dispatch', new Error('late cancellation'))
		).toBe(false);
		expect(finalizeStoryEditReveal('finalize-dispatch')).toBe(false);
		expect(rollback).not.toHaveBeenCalled();
	});

	it('rebuilds Test Current from the latest live story in the same session', async () => {
		render(<StoryPreviewOwnerController />);

		await act(async () => {
			commandListener?.({
				command: {
					generation: 3,
					passageId: 'current',
					requestId: 'test-current-request',
					type: 'testCurrent'
				},
				dispatchId: 'dispatch-test-current',
				passageId: 'current',
				sessionId: 'session',
				storyId: 'story'
			});
		});

		await waitFor(() =>
			expect(preparePreview).toHaveBeenCalledWith('story', 'test', {
				startPassageId: 'current'
			})
		);
		expect(replaceStoryPreview).toHaveBeenCalledWith(
			'session',
			3,
			expect.any(Object),
			'/project',
			'dispatch-test-current'
		);
		expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith('session', {
			command: 'testCurrent',
			dispatchId: 'dispatch-test-current',
			generation: 3,
			requestId: 'test-current-request',
			status: 'success'
		});
	});

	it('does not replace after a test command is cancelled during preparation', async () => {
		let finishPreparation!: (value: {
			projectRoot: string;
			request: {descriptor: object; html: string};
		}) => void;
		preparePreview.mockReturnValueOnce(
			new Promise(resolve => {
				finishPreparation = resolve;
			})
		);
		render(<StoryPreviewOwnerController />);

		act(() => {
			commandListener?.({
				command: {
					generation: 3,
					passageId: 'current',
					requestId: 'cancelled-test-current',
					type: 'testCurrent'
				},
				dispatchId: 'dispatch-cancelled-test-current',
				passageId: 'current',
				sessionId: 'session',
				storyId: 'story'
			});
		});
		await waitFor(() => expect(preparePreview).toHaveBeenCalled());

		act(() => {
			cancellationListener?.({
				command: 'testCurrent',
				dispatchId: 'dispatch-cancelled-test-current',
				generation: 3,
				message: 'The command lease expired.',
				requestId: 'cancelled-test-current',
				sessionId: 'session'
			});
			finishPreparation({
				projectRoot: '/project',
				request: {descriptor: {}, html: '<html></html>'}
			});
		});

		await waitFor(() =>
			expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith(
				'session',
				expect.objectContaining({
					requestId: 'cancelled-test-current',
					status: 'error'
				})
			)
		);
		expect(replaceStoryPreview).not.toHaveBeenCalled();
	});

	it('keeps the preview open and reports a deleted passage exactly', async () => {
		render(<StoryPreviewOwnerController />);

		await act(async () => {
			commandListener?.({
				command: {
					generation: 4,
					passageId: 'deleted',
					requestId: 'deleted-request',
					type: 'testCurrent'
				},
				dispatchId: 'dispatch-deleted',
				passageId: 'deleted',
				sessionId: 'session',
				storyId: 'story'
			});
		});

		await waitFor(() =>
			expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith(
				'session',
				expect.objectContaining({
					command: 'testCurrent',
					dispatchId: 'dispatch-deleted',
					generation: 4,
					message:
						'The requested passage no longer exists uniquely in the story.',
					operation: 'command',
					requestId: 'deleted-request',
					status: 'error'
				})
			)
		);
		expect(replaceStoryPreview).not.toHaveBeenCalled();
	});

	it('rejects a deleted reveal before reporting owner acceptance', async () => {
		render(<StoryPreviewOwnerController />);

		await act(async () => {
			commandListener?.({
				command: {
					generation: 4,
					passageId: 'deleted',
					requestId: 'deleted-reveal-request',
					type: 'revealSource'
				},
				dispatchId: 'dispatch-deleted-reveal',
				passageId: 'deleted',
				sessionId: 'session',
				storyId: 'story'
			});
		});

		await waitFor(() =>
			expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith(
				'session',
				expect.objectContaining({
					command: 'revealSource',
					dispatchId: 'dispatch-deleted-reveal',
					message:
						'The requested passage no longer exists uniquely in the story.',
					requestId: 'deleted-reveal-request',
					status: 'error'
				})
			)
		);
		expect(reportStoryPreviewCommandResult).not.toHaveBeenCalledWith(
			'session',
			expect.objectContaining({
				requestId: 'deleted-reveal-request',
				status: 'accepted'
			})
		);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('rejects an ambiguous live passage ID before acceptance', async () => {
		(useStoriesContext as jest.Mock).mockReturnValue({
			stories: [
				{
					id: 'story',
					passages: [
						{id: 'current', name: 'Current'},
						{id: 'current', name: 'Duplicate Current'}
					]
				}
			]
		});
		render(<StoryPreviewOwnerController />);

		await act(async () => {
			commandListener?.({
				command: {
					generation: 4,
					passageId: 'current',
					requestId: 'ambiguous-reveal-request',
					type: 'revealSource'
				},
				dispatchId: 'dispatch-ambiguous-reveal',
				passageId: 'current',
				sessionId: 'session',
				storyId: 'story'
			});
		});

		await waitFor(() =>
			expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith(
				'session',
				expect.objectContaining({
					command: 'revealSource',
					dispatchId: 'dispatch-ambiguous-reveal',
					message:
						'The requested passage no longer exists uniquely in the story.',
					requestId: 'ambiguous-reveal-request',
					status: 'error'
				})
			)
		);
		expect(reportStoryPreviewCommandResult).not.toHaveBeenCalledWith(
			'session',
			expect.objectContaining({
				requestId: 'ambiguous-reveal-request',
				status: 'accepted'
			})
		);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('bounds owner-side failures before reporting them across IPC', async () => {
		const longMessage = 'x'.repeat(5000);

		preparePreview.mockRejectedValueOnce(new Error(longMessage));
		render(<StoryPreviewOwnerController />);

		await act(async () => {
			commandListener?.({
				command: {
					generation: 5,
					passageId: 'current',
					requestId: 'bounded-error-request',
					type: 'testCurrent'
				},
				dispatchId: 'dispatch-bounded',
				passageId: 'current',
				sessionId: 'session',
				storyId: 'story'
			});
		});

		await waitFor(() =>
			expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith(
				'session',
				expect.objectContaining({
					command: 'testCurrent',
					dispatchId: 'dispatch-bounded',
					generation: 5,
					message: longMessage.slice(0, 4096),
					operation: 'command',
					requestId: 'bounded-error-request',
					status: 'error'
				})
			)
		);
	});
});
