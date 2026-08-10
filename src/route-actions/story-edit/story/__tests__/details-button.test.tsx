import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {FakeStateProvider, FakeStateProviderProps} from '../../../../test-util';
import {DetailsButton} from '../details-button';

const TestDetailsButton: React.FC<{onOpen: () => void}> = ({onOpen}) => {
	return <DetailsButton onOpenWorkbenchPanel={onOpen} />;
};

describe('<DetailsButton>', () => {
	function renderComponent(contexts?: FakeStateProviderProps) {
		const onOpen = jest.fn();
		const result = render(
			<FakeStateProvider {...contexts}>
				<TestDetailsButton onOpen={onOpen} />
			</FakeStateProvider>
		);
		return {...result, onOpen};
	}

	it('opens the story details workbench panel when clicked', () => {
		const {onOpen} = renderComponent();
		fireEvent.click(screen.getByRole('button', {name: 'common.details'}));
		expect(onOpen).toHaveBeenCalledWith('story-details');
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
