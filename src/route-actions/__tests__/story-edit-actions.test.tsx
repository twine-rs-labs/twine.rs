import {act, render, screen} from '@testing-library/react';
import * as React from 'react';
import {
	AppCommandContribution,
	AppShellContext,
	ShellToolbarRegistration
} from '../../components/app-shell';
import {FakeStateProvider, fakeStory} from '../../test-util';
import {StoryEditActions} from '../story-edit-actions';

describe('<StoryEditActions>', () => {
	it('registers the Twine RS documentation URL for toolbar help', () => {
		const setToolbar = jest.fn<void, [ShellToolbarRegistration | undefined]>();

		render(
			<AppShellContext.Provider
				value={{
					inShell: true,
					registerCommandContribution: () => ({
						refresh: () => undefined,
						unregister: () => undefined
					}),
					setDock: jest.fn(),
					setToolbar
				}}
			>
				<FakeStateProvider>
					<StoryEditActions
						getCenter={() => ({left: 0, top: 0})}
						onEditPassages={jest.fn()}
						onOpenFuzzyFinder={jest.fn()}
						story={fakeStory()}
					/>
				</FakeStateProvider>
			</AppShellContext.Provider>
		);

		expect(setToolbar).toHaveBeenCalledWith(
			expect.objectContaining({
				helpUrl:
					'https://github.com/twine-rs-labs/twine.rs/blob/main/docs/user/README.md'
			})
		);
	});

	it('owns the rename command outside the visual Passage toolbar panel', async () => {
		const story = fakeStory(1);
		story.passages[0].selected = true;
		let contribution: AppCommandContribution | undefined;

		render(
			<AppShellContext.Provider
				value={{
					inShell: true,
					registerCommandContribution: current => {
						contribution = current;
						return {
							refresh: commands => {
								if (contribution) contribution.commands = commands;
							},
							unregister: () => undefined
						};
					},
					setDock: jest.fn(),
					setToolbar: jest.fn()
				}}
			>
				<FakeStateProvider stories={[story]}>
					<StoryEditActions
						getCenter={() => ({left: 0, top: 0})}
						onEditPassages={jest.fn()}
						onOpenFuzzyFinder={jest.fn()}
						story={story}
					/>
				</FakeStateProvider>
			</AppShellContext.Provider>
		);

		const rename = contribution?.commands.find(
			command => command.id === 'story-edit.rename-active-passage'
		);
		expect(rename).toBeDefined();
		await act(async () => rename?.run());
		expect(
			screen.getByRole('dialog', {name: 'common.renamePrompt'})
		).toBeInTheDocument();
		expect(screen.getByRole('textbox')).toHaveFocus();
	});
});
