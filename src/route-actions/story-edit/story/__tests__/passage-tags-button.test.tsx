import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {StoreCoreProjectHost} from '../../../../core/project-host';
import {useStoriesContext} from '../../../../store/stories';
import {
	FakeStateProvider,
	FakeStateProviderProps,
	waitForMockPromises
} from '../../../../test-util';
import {PassageTagsButton} from '../passage-tags-button';

const TestPassageTagsButton: React.FC = () => {
	const {stories} = useStoriesContext();

	return <PassageTagsButton story={stories[0]} />;
};

describe('<PassageTagsButton>', () => {
	function renderComponent(contexts?: FakeStateProviderProps) {
		return render(
			<FakeStateProvider {...contexts}>
				<TestPassageTagsButton />
			</FakeStateProvider>
		);
	}

	it('opens the passage tags dialog when clicked', async () => {
		const queryContentsPage = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'queryContentsPageAsync'
		);

		renderComponent();
		fireEvent.click(
			screen.getByRole('button', {name: 'routes.storyEdit.toolbar.passageTags'})
		);
		await waitFor(() => expect(queryContentsPage).toHaveBeenCalledTimes(2));
		await waitForMockPromises(queryContentsPage);
		expect(screen.getByText('dialogs.passageTags.title')).toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
