import {render} from '@testing-library/react';
import * as React from 'react';
import {
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
});
