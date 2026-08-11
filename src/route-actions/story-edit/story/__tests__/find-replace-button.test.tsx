import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {FakeStateProvider, FakeStateProviderProps} from '../../../../test-util';
import {FindReplaceButton} from '../find-replace-button';

const TestFindReplaceButton: React.FC<{onOpen: () => void}> = ({onOpen}) => {
	return <FindReplaceButton onOpenWorkbenchPanel={onOpen} />;
};

describe('<FindReplaceButton>', () => {
	function renderComponent(contexts?: FakeStateProviderProps) {
		const onOpen = jest.fn();
		const result = render(
			<FakeStateProvider {...contexts}>
				<TestFindReplaceButton onOpen={onOpen} />
			</FakeStateProvider>
		);
		return {...result, onOpen};
	}

	it('opens the find/replace workbench panel when clicked', () => {
		const {onOpen} = renderComponent();
		fireEvent.click(
			screen.getByRole('button', {
				name: 'routes.storyEdit.toolbar.findAndReplace'
			})
		);
		expect(onOpen).toHaveBeenCalledWith('find-replace');
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
