import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {FakeStateProvider, FakeStateProviderProps} from '../../../../test-util';
import {StylesheetButton} from '../stylesheet-button';

const TestStylesheetButton: React.FC<{onOpen: () => void}> = ({onOpen}) => {
	return <StylesheetButton onOpenEditorWindow={onOpen} />;
};

describe('<StylesheetButton>', () => {
	function renderComponent(contexts?: FakeStateProviderProps) {
		const onOpen = jest.fn();
		const result = render(
			<FakeStateProvider {...contexts}>
				<TestStylesheetButton onOpen={onOpen} />
			</FakeStateProvider>
		);
		return {...result, onOpen};
	}

	it('opens the stylesheet editor buffer when clicked', () => {
		const {onOpen} = renderComponent();
		fireEvent.click(
			screen.getByRole('button', {name: 'routes.storyEdit.toolbar.stylesheet'})
		);
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
