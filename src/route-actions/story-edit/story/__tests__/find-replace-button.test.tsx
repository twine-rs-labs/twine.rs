import {act, fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {MemoryRouter} from 'react-router';
import {useStoriesContext} from '../../../../store/stories';
import {FakeStateProvider, FakeStateProviderProps} from '../../../../test-util';
import {FindReplaceButton} from '../find-replace-button';

const TestFindReplaceButton: React.FC = () => {
	const {stories} = useStoriesContext();

	return <FindReplaceButton story={stories[0]} />;
};

describe('<FindReplaceButton>', () => {
	afterEach(async () => await act(() => Promise.resolve()));

	function renderComponent(contexts?: FakeStateProviderProps) {
		return render(
			<MemoryRouter>
				<FakeStateProvider {...contexts}>
					<TestFindReplaceButton />
				</FakeStateProvider>
			</MemoryRouter>
		);
	}

	it('opens the find/replace dialog when clicked', async () => {
		renderComponent();
		fireEvent.click(
			screen.getByRole('button', {
				name: 'routes.storyEdit.toolbar.findAndReplace'
			})
		);
		expect(screen.getByText('dialogs.storySearch.title')).toBeInTheDocument();
		fireEvent.change(
			screen.getByRole('textbox', {name: 'dialogs.storySearch.find'}),
			{target: {value: 'needle-that-is-not-present'}}
		);
		expect(
			await screen.findByText('dialogs.storySearch.noMatches')
		).toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
