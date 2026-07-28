import * as React from 'react';
import {act, render, waitFor} from '@testing-library/react';
import {useNavigate} from 'react-router';
import {StoryPreviewOwnerController} from '../story-preview-owner-controller';
import {usePrefsContext} from '../../store/prefs';
import {useComputedTheme} from '../../store/prefs/use-computed-theme';
import {useStoriesContext} from '../../store/stories';
import {useNativeStoryPreviewPreparation} from '../../store/use-story-launch';

jest.mock('../../store/prefs');
jest.mock('../../store/prefs/use-computed-theme');
jest.mock('../../store/stories');
jest.mock('../../store/use-story-launch');
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

	beforeEach(() => {
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
		preparePreview.mockResolvedValue({
			projectRoot: '/project',
			request: {descriptor: {}, instrumentedHtml: '<html></html>'}
		});
		replaceStoryPreview.mockResolvedValue({generation: 2});
		reportStoryPreviewCommandResult.mockResolvedValue(undefined);
		updateStoryPreviewAppearance.mockResolvedValue(undefined);
		(window as any).twineElectron = {
			onStoryPreviewCommand: jest.fn((listener: (command: any) => void) => {
				commandListener = listener;
				return jest.fn();
			}),
			replaceStoryPreview,
			reportStoryPreviewCommandResult,
			updateStoryPreviewAppearance
		};
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
				command: {generation: 1, type: 'revealSource'},
				passageId: 'current',
				sessionId: 'session',
				storyId: 'story'
			});
		});

		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(
				'/stories/story?mode=text&passage=current'
			)
		);
		expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith('session', {
			command: 'revealSource',
			generation: 1,
			status: 'success'
		});
	});

	it('rebuilds Test Current from the latest live story in the same session', async () => {
		render(<StoryPreviewOwnerController />);

		await act(async () => {
			commandListener?.({
				command: {
					generation: 3,
					passageId: 'current',
					type: 'testCurrent'
				},
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
			'/project'
		);
		expect(reportStoryPreviewCommandResult).toHaveBeenCalledWith('session', {
			command: 'testCurrent',
			generation: 3,
			status: 'success'
		});
	});

	it('keeps the preview open and reports a deleted passage exactly', async () => {
		render(<StoryPreviewOwnerController />);

		await act(async () => {
			commandListener?.({
				command: {
					generation: 4,
					passageId: 'deleted',
					type: 'testCurrent'
				},
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
					generation: 4,
					message: 'The requested passage no longer exists in the story.',
					operation: 'command',
					status: 'error'
				})
			)
		);
		expect(replaceStoryPreview).not.toHaveBeenCalled();
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
					type: 'testCurrent'
				},
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
					generation: 5,
					message: longMessage.slice(0, 4096),
					operation: 'command',
					status: 'error'
				})
			)
		);
	});
});
