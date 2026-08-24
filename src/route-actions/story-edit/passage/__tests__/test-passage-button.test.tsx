import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import type {ComponentProps} from 'react';
import * as React from 'react';
import {fakePassage} from '../../../../test-util';
import {TestPassageButton} from '../test-passage-button';

describe('<TestPassageButton>', () => {
	function renderComponent(
		props?: Partial<ComponentProps<typeof TestPassageButton>>
	) {
		return render(<TestPassageButton {...props} />);
	}

	it('is disabled when the passage prop is undefined', () => {
		renderComponent({passage: undefined});
		expect(
			screen.getByRole('button', {
				name: 'routes.storyEdit.toolbar.testFromHere'
			})
		).toBeDisabled();
	});

	it('delegates testing to the route-owned action', () => {
		const onTestPassage = jest.fn();
		const passage = fakePassage();

		renderComponent({onTestPassage, passage});
		fireEvent.click(
			screen.getByRole('button', {
				name: 'routes.storyEdit.toolbar.testFromHere'
			})
		);
		expect(onTestPassage).toHaveBeenCalledWith(passage);
	});

	it('shows matching pending state and disables the action', () => {
		const passage = fakePassage();

		renderComponent({
			onTestPassage: jest.fn(),
			passage,
			pending: true,
			pendingPassageId: passage.id
		});
		const button = screen.getByRole('button', {
			name: 'routes.storyEdit.toolbar.testFromHere'
		});

		expect(button).toBeDisabled();
		expect(button).toHaveAttribute('aria-busy', 'true');
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
