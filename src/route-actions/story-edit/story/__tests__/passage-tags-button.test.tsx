import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {FakeStateProvider, FakeStateProviderProps} from '../../../../test-util';
import {PassageTagsButton} from '../passage-tags-button';

const TestPassageTagsButton: React.FC<{onOpen: () => void}> = ({onOpen}) => {
	return <PassageTagsButton onOpenWorkbenchPanel={onOpen} />;
};

describe('<PassageTagsButton>', () => {
	function renderComponent(contexts?: FakeStateProviderProps) {
		const onOpen = jest.fn();
		const result = render(
			<FakeStateProvider {...contexts}>
				<TestPassageTagsButton onOpen={onOpen} />
			</FakeStateProvider>
		);
		return {...result, onOpen};
	}

	it('opens the passage tags workbench panel when clicked', () => {
		const {onOpen} = renderComponent();
		fireEvent.click(
			screen.getByRole('button', {name: 'routes.storyEdit.toolbar.passageTags'})
		);
		expect(onOpen).toHaveBeenCalledWith('passage-tags');
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
