import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {StoryFormatsFilterButton} from '../story-formats-filter-button';
import {FakeStateProvider, PrefInspector} from '../../../test-util';
import {PrefsState} from '../../../store/prefs';

describe('<StoryFormatsFilterButton>', () => {
	const prefs: ('all' | 'current' | 'user')[][] = [
		['all'],
		['current'],
		['user']
	];

	function renderComponent(prefs?: Partial<PrefsState>) {
		return render(
			<FakeStateProvider prefs={prefs}>
				<StoryFormatsFilterButton />
				<PrefInspector name="storyFormatListFilter" />
			</FakeStateProvider>
		);
	}

	async function waitForMenuPosition(item: HTMLElement) {
		await waitFor(() =>
			expect(item.closest('.menu-button-menu')).toHaveAttribute(
				'data-popper-placement'
			)
		);
	}

	describe.each(prefs)(
		'When the current story format filter is %s',
		storyFormatListFilter => {
			it('displays the label for this state', () => {
				renderComponent({storyFormatListFilter});
				expect(
					screen.getByRole('button', {
						name: `dialogs.storyFormats.filterButton.${storyFormatListFilter}`
					})
				).toBeInTheDocument();
			});

			it('checks the appropriate item in the menu', async () => {
				renderComponent({storyFormatListFilter});
				fireEvent.click(
					screen.getByRole('button', {
						name: `dialogs.storyFormats.filterButton.${storyFormatListFilter}`
					})
				);
				const item = screen.getByRole('checkbox', {
					name: `dialogs.storyFormats.filterButton.${storyFormatListFilter}`
				});

				await waitForMenuPosition(item);
				expect(item).toBeChecked();
			});

			it('unchecks all other items in the menu', async () => {
				renderComponent({storyFormatListFilter});
				fireEvent.click(
					screen.getByRole('button', {
						name: `dialogs.storyFormats.filterButton.${storyFormatListFilter}`
					})
				);
				await waitForMenuPosition(screen.getAllByRole('checkbox')[0]);

				for (const pref of prefs.filter(
					([item]) => item !== storyFormatListFilter
				)) {
					expect(
						screen.getByRole('checkbox', {
							name: `dialogs.storyFormats.filterButton.${pref}`
						})
					).not.toBeChecked();
				}
			});
		}
	);

	it.each(prefs)(
		'Dispatches a preference update when the %s menu item is selected',
		async pref => {
			renderComponent();
			fireEvent.click(screen.getByRole('button'));
			const item = screen.getByRole('checkbox', {
				name: `dialogs.storyFormats.filterButton.${pref}`
			});

			await waitForMenuPosition(item);
			fireEvent.click(item);
			expect(
				screen.getByTestId('pref-inspector-storyFormatListFilter')
			).toHaveTextContent(pref);
		}
	);

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
