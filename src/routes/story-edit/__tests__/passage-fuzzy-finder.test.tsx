import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {FakeStateProvider, fakeStory, StoryInspector} from '../../../test-util';
import {
	PassageFuzzyFinder,
	PassageFuzzyFinderProps
} from '../passage-fuzzy-finder';

describe('PassageFuzzyFinder', () => {
	function renderComponent(
		props?: Partial<PassageFuzzyFinderProps>,
		story = fakeStory()
	) {
		return render(
			<FakeStateProvider stories={[story]}>
				<PassageFuzzyFinder
					onClose={jest.fn()}
					onOpen={jest.fn()}
					open
					setCenter={jest.fn()}
					story={story}
					{...props}
				/>
				<StoryInspector />
			</FakeStateProvider>
		);
	}

	describe('When closed', () => {
		// Can't figure out how to trigger this in jsdom.

		it.todo('calls the onOpen prop when the P key is pressed');
	});

	describe('When open', () => {
		it('calls the onClose prop when the fuzzy finder is closed', () => {
			const onClose = jest.fn();

			renderComponent({onClose});
			expect(onClose).not.toHaveBeenCalled();
			fireEvent.click(screen.getByRole('button', {name: 'Close'}));
			expect(onClose).toHaveBeenCalledTimes(1);
		});

		it('updates results based on what the user enters', async () => {
			const story = fakeStory(1);

			story.passages[0].name = 'a name';
			story.passages[0].text = 'text';
			renderComponent({}, story);
			fireEvent.change(screen.getByRole('textbox'), {target: {value: 'a'}});
			expect(
				await screen.findByRole('button', {name: 'a name a name'})
			).toBeInTheDocument();
		});

		describe('When a result is selected', () => {
			it('centers the view on a passage and selects it when a result is selected', async () => {
				const setCenter = jest.fn();
				const story = fakeStory(1);

				story.passages[0].name = 'a name';
				story.passages[0].selected = false;
				story.passages[0].text = 'text';
				renderComponent({setCenter}, story);
				fireEvent.change(screen.getByRole('textbox'), {target: {value: 'a'}});
				expect(setCenter).not.toHaveBeenCalled();
				fireEvent.click(
					await screen.findByRole('button', {name: 'a name a name'})
				);
				expect(setCenter.mock.calls).toEqual([[story.passages[0]]]);
			});

			it('uses explicit graph reveal instead of scroll centering when available', async () => {
				const onRevealPassageInGraph = jest.fn();
				const setCenter = jest.fn();
				const story = fakeStory(1);

				story.passages[0].name = 'a name';
				story.passages[0].selected = false;
				story.passages[0].text = 'text';
				renderComponent({onRevealPassageInGraph, setCenter}, story);
				fireEvent.change(screen.getByRole('textbox'), {target: {value: 'a'}});
				fireEvent.click(
					await screen.findByRole('button', {name: 'a name a name'})
				);
				expect(onRevealPassageInGraph).toHaveBeenCalledWith(story.passages[0]);
				expect(setCenter).not.toHaveBeenCalled();
			});

			it('calls the onClose prop', async () => {
				const onClose = jest.fn();
				const story = fakeStory(1);

				story.passages[0].name = 'a name';
				story.passages[0].selected = false;
				story.passages[0].text = 'text';
				renderComponent({onClose}, story);
				fireEvent.change(screen.getByRole('textbox'), {target: {value: 'a'}});
				expect(onClose).not.toHaveBeenCalled();
				fireEvent.click(
					await screen.findByRole('button', {name: 'a name a name'})
				);
				expect(onClose).toHaveBeenCalledTimes(1);
			});

			it('tests a result from the search row action', async () => {
				const onTestPassage = jest.fn();
				const story = fakeStory(1);

				story.passages[0].name = 'a name';
				story.passages[0].text = 'text';
				renderComponent({onTestPassage}, story);
				fireEvent.change(screen.getByRole('textbox'), {target: {value: 'a'}});
				fireEvent.click(
					await screen.findByRole('button', {name: 'Test "a name" From Here'})
				);

				expect(onTestPassage).toHaveBeenCalledWith(story.passages[0]);
			});

			it('disables and marks the matching result while a launch is pending', async () => {
				const onTestPassage = jest.fn();
				const story = fakeStory(1);

				story.passages[0].name = 'a name';
				story.passages[0].text = 'text';
				renderComponent(
					{
						onTestPassage,
						testPassagePending: true,
						testPassagePendingId: story.passages[0].id
					},
					story
				);
				fireEvent.change(screen.getByRole('textbox'), {target: {value: 'a'}});
				const action = await screen.findByRole('button', {
					name: 'Test "a name" From Here'
				});

				expect(action).toBeDisabled();
				expect(action).toHaveAttribute('aria-busy', 'true');
				fireEvent.click(action);
				expect(onTestPassage).not.toHaveBeenCalled();
			});
		});
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
