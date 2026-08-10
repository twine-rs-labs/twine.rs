import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {FakeStateProvider, FakeStateProviderProps} from '../../../../test-util';
import {JavaScriptButton} from '../javascript-button';

const TestJavaScriptButton: React.FC<{onOpen: () => void}> = ({onOpen}) => {
	return <JavaScriptButton onOpenEditorWindow={onOpen} />;
};

describe('<JavaScriptButton>', () => {
	function renderComponent(contexts?: FakeStateProviderProps) {
		const onOpen = jest.fn();
		const result = render(
			<FakeStateProvider {...contexts}>
				<TestJavaScriptButton onOpen={onOpen} />
			</FakeStateProvider>
		);
		return {...result, onOpen};
	}

	it('opens the JavaScript editor buffer when clicked', () => {
		const {onOpen} = renderComponent();
		fireEvent.click(
			screen.getByRole('button', {name: 'routes.storyEdit.toolbar.javaScript'})
		);
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
