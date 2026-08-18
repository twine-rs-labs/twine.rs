import {render, screen, within} from '@testing-library/react';
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

	it('credits Twine RS contributors first', () => {
		const {container} = renderComponent();
		const codeCredits = container.querySelector('.credits .code');

		expect(codeCredits).not.toBeNull();
		expect(
			within(codeCredits as HTMLElement)
				.getAllByRole('listitem')
				.slice(0, 2)
				.map(item => item.textContent)
		).toEqual(['bransta61', 'aphrodite-games']);
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

	it('groups Twine RS links before separate upstream links', () => {
		const {container} = renderComponent();
		const twineRsLinks = container.querySelector('.twine-rs-links');
		const upstreamLinks = container.querySelector('.upstream-links');

		expect(twineRsLinks).not.toBeNull();
		expect(upstreamLinks).not.toBeNull();
		expect(
			within(twineRsLinks as HTMLElement)
				.getAllByRole('link')
				.map(link => link.textContent)
		).toEqual([
			'dialogs.aboutTwine.supportTwineRs',
			'dialogs.aboutTwine.codeRepo'
		]);
		expect(
			within(upstreamLinks as HTMLElement)
				.getAllByRole('link')
				.map(link => link.textContent)
		).toEqual([
			'dialogs.aboutTwine.upstreamRepo',
			'dialogs.aboutTwine.supportUpstreamTwine'
		]);
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
