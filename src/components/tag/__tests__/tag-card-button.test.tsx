import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {TagCardButton, TagCardButtonProps} from '../tag-card-button';
import {axe} from 'jest-axe';

jest.mock('../../../components/control/autocomplete-text-input');

describe('<TagCardButton>', () => {
	function renderComponent(props?: Partial<TagCardButtonProps>) {
		return render(
			<TagCardButton
				allTags={[]}
				id="test-tag-input"
				onAdd={jest.fn()}
				onChangeColor={jest.fn()}
				onRemove={jest.fn()}
				tagColors={{}}
				tags={[]}
				{...props}
			/>
		);
	}

	async function openCard(label: string) {
		fireEvent.click(screen.getByRole('button', {name: label}));
		await waitFor(() =>
			expect(screen.getByRole('dialog')).toHaveAttribute(
				'data-popper-placement'
			)
		);
	}

	it('has a Tags label if there are no tags', () => {
		renderComponent();
		expect(screen.getByRole('button', {name: 'common.tags'})).toBeVisible();
	});

	it('has the number of tags in its label if there are more than one', () => {
		renderComponent({tags: ['one', 'two']});
		expect(
			screen.getByRole('button', {
				name: 'components.tagCardButton.tagsWithCount'
			})
		).toBeVisible();
	});

	describe('When the card is opened', () => {
		it('allows adding a new tag', async () => {
			const onAdd = jest.fn();

			renderComponent({onAdd});
			await openCard('common.tags');
			fireEvent.change(
				screen.getByRole('combobox', {
					name: 'components.tagCardButton.tagNameLabel'
				}),
				{target: {value: 'new-tag'}}
			);
			expect(onAdd).not.toHaveBeenCalled();
			fireEvent.click(screen.getByRole('button', {name: 'common.add'}));
			expect(onAdd.mock.calls).toEqual([['new-tag']]);
		});

		it("sets autocompletions to all tags that haven't already been added", async () => {
			renderComponent({
				allTags: ['one', 'two', 'three'],
				tags: ['one', 'three']
			});
			await openCard('components.tagCardButton.tagsWithCount');
			expect(
				(
					screen
						.getByText('components.tagCardButton.tagNameLabel')
						.closest('[data-completions]') as HTMLElement
				).dataset.completions
			).toBe(JSON.stringify(['two']));
		});

		it('clears the text field after adding a tag', async () => {
			renderComponent();
			await openCard('common.tags');
			fireEvent.change(
				screen.getByRole('combobox', {
					name: 'components.tagCardButton.tagNameLabel'
				}),
				{target: {value: 'new-tag'}}
			);
			fireEvent.click(screen.getByRole('button', {name: 'common.add'}));
			expect(
				screen.getByRole('combobox', {
					name: 'components.tagCardButton.tagNameLabel'
				})
			).toHaveValue('');
		});

		it('clears the text field after closing the card', async () => {
			renderComponent();
			await openCard('common.tags');
			fireEvent.change(
				screen.getByRole('combobox', {
					name: 'components.tagCardButton.tagNameLabel'
				}),
				{target: {value: 'new-tag'}}
			);
			fireEvent.click(screen.getByRole('button', {name: 'common.tags'}));
			await waitFor(() =>
				expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
			);
			await openCard('common.tags');
			expect(
				screen.getByRole('combobox', {
					name: 'components.tagCardButton.tagNameLabel'
				})
			).toHaveValue('');
		});

		it('prevents adding a tag already present', async () => {
			renderComponent({tags: ['test']});
			await openCard('components.tagCardButton.tagsWithCount');
			fireEvent.change(
				screen.getByRole('combobox', {
					name: 'components.tagCardButton.tagNameLabel'
				}),
				{target: {value: 'test'}}
			);
			expect(screen.getByRole('button', {name: 'common.add'})).toBeDisabled();
		});

		it('prevents adding an invalid tag', async () => {
			renderComponent();
			await openCard('common.tags');
			fireEvent.change(
				screen.getByRole('combobox', {
					name: 'components.tagCardButton.tagNameLabel'
				}),
				{target: {value: 'test'}}
			);
			expect(
				screen.getByRole('button', {name: 'common.add'})
			).not.toBeDisabled();
			fireEvent.change(
				screen.getByRole('combobox', {
					name: 'components.tagCardButton.tagNameLabel'
				}),
				{target: {value: ''}}
			);
			expect(screen.getByRole('button', {name: 'common.add'})).toBeDisabled();
		});

		it('passes the id prop to the autocomplete input', async () => {
			renderComponent({id: 'custom-test-id'});
			await openCard('common.tags');
			const input = screen.getByRole('combobox', {
				name: 'components.tagCardButton.tagNameLabel'
			});
			expect(input).toHaveAttribute('id', 'custom-test-id');
		});

		describe('The tag list it shows', () => {
			it('has one tag per tag in props', async () => {
				renderComponent({tags: ['test1', 'test2']});
				await openCard('components.tagCardButton.tagsWithCount');
				expect(screen.getByRole('button', {name: 'test1'})).toBeVisible();
				expect(screen.getByRole('button', {name: 'test2'})).toBeVisible();
			});

			it('passes through color changes', async () => {
				const onChangeColor = jest.fn();

				renderComponent({onChangeColor, tags: ['test']});
				await openCard('components.tagCardButton.tagsWithCount');
				fireEvent.click(screen.getByRole('button', {name: 'test'}));
				expect(onChangeColor).not.toHaveBeenCalled();
				fireEvent.click(screen.getByRole('checkbox', {name: 'colors.red'}));
				expect(onChangeColor.mock.calls).toEqual([['test', 'red']]);
			});

			it('passes through removals', async () => {
				const onRemove = jest.fn();

				renderComponent({onRemove, tags: ['test']});
				await openCard('components.tagCardButton.tagsWithCount');
				fireEvent.click(screen.getByRole('button', {name: 'test'}));
				expect(onRemove).not.toHaveBeenCalled();
				fireEvent.click(screen.getByRole('button', {name: 'common.remove'}));
				expect(onRemove.mock.calls).toEqual([['test']]);
			});
		});
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
