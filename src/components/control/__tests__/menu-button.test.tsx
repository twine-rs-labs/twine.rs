import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {MenuButton} from '../menu-button';

describe('<MenuButton>', () => {
	it('opens its fixed-position menu and invokes an item', () => {
		const onClick = jest.fn();

		render(
			<MenuButton
				icon={<span aria-hidden />}
				items={[{label: 'Do the thing', onClick}]}
				label="Actions"
			/>
		);

		fireEvent.click(screen.getByRole('button', {name: 'Actions'}));
		fireEvent.click(screen.getByRole('button', {name: 'Do the thing'}));

		expect(onClick).toHaveBeenCalledTimes(1);
	});
});
