import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MenuButton} from '../menu-button';

describe('<MenuButton>', () => {
	it('opens its fixed-position menu and invokes an item', async () => {
		const onClick = jest.fn();

		render(
			<MenuButton
				icon={<span aria-hidden />}
				items={[{label: 'Do the thing', onClick}]}
				label="Actions"
			/>
		);

		fireEvent.click(screen.getByRole('button', {name: 'Actions'}));
		const item = screen.getByRole('button', {name: 'Do the thing'});

		await waitFor(() =>
			expect(item.closest('.menu-button-menu')).toHaveAttribute(
				'data-popper-placement'
			)
		);
		fireEvent.click(item);

		expect(onClick).toHaveBeenCalledTimes(1);
	});
});
