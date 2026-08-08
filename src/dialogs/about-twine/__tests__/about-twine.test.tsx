import {render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {AboutTwineDialog} from '../about-twine';

describe('<AboutTwineDialog>', () => {
	function renderComponent() {
		return render(
			<AboutTwineDialog
				collapsed={false}
				onChangeCollapsed={jest.fn()}
				onChangeHighlighted={jest.fn()}
				onChangeMaximized={jest.fn()}
				onChangeProps={jest.fn()}
				onClose={jest.fn()}
			/>
		);
	}

	it('leads with a link to support Twine RS', () => {
		renderComponent();
		expect(
			screen.getByText('dialogs.aboutTwine.supportTwineRs').getAttribute('href')
		).toBe('https://www.patreon.com/TwineRSLab');
	});

	it('distinguishes the Twine RS source repository from upstream TwineJS', () => {
		renderComponent();
		expect(
			screen.getByText('dialogs.aboutTwine.codeRepo').getAttribute('href')
		).toBe('https://github.com/twine-rs-labs/twine.rs');
		expect(
			screen.getByText('dialogs.aboutTwine.upstreamRepo').getAttribute('href')
		).toBe('https://github.com/klembot/twinejs');
	});

	it('offers a secondary link to support upstream Twine', () => {
		renderComponent();
		expect(
			screen
				.getByText('dialogs.aboutTwine.supportUpstreamTwine')
				.getAttribute('href')
		).toBe('https://twinery.org/donate');
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
