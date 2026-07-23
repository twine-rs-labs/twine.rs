import {faker} from '@faker-js/faker';
import {render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {FakeStateProvider, fakeStory} from '../../../test-util';
import {
	StoryDetailsDialogStats,
	StoryDetailsDialogStatsProps
} from '../story-stats';

describe('<StoryDetailsDialogStats>', () => {
	async function renderComponent(props?: StoryDetailsDialogStatsProps) {
		const story = props?.story ?? fakeStory();

		const result = render(
			<FakeStateProvider stories={[story]}>
				<StoryDetailsDialogStats story={story} />
			</FakeStateProvider>
		);

		const characterCount = screen.getByText(
			'dialogs.storyDetails.stats.characters'
		).previousElementSibling;

		await waitFor(() => expect(characterCount).not.toHaveTextContent('—'));
		return result;
	}

	it('shows a character count for the story', async () => {
		const story = fakeStory(2);
		const text = faker.lorem.words(50);
		const text2 = faker.lorem.words(50);

		story.passages[0].text = text;
		story.passages[1].text = text2;
		await renderComponent({story});

		const row = screen.getByText(
			'dialogs.storyDetails.stats.characters'
		).parentNode;

		await waitFor(() =>
			expect(row!.querySelectorAll('td')[0].textContent).toBe(
				(text.length + text2.length).toString()
			)
		);
	});

	it('shows a word count for the story', async () => {
		const story = fakeStory(2);
		const text = faker.lorem.words(10);
		const text2 = faker.lorem.words(25);

		story.passages[0].text = text;
		story.passages[1].text = text2;
		await renderComponent({story});

		const row = screen.getByText('dialogs.storyDetails.stats.words').parentNode;

		await waitFor(() =>
			expect(row!.querySelectorAll('td')[0].textContent).toBe('35')
		);
	});

	it('shows a passage count for the story', async () => {
		const passageCount = Math.round(Math.random() * 100);
		const story = fakeStory(passageCount);

		await renderComponent({story});

		const row = screen.getByText(
			'dialogs.storyDetails.stats.passages'
		).parentNode;

		expect(row!.querySelectorAll('td')[0].textContent).toBe(
			passageCount.toString()
		);
	});

	it('shows a distinct link count for the story', async () => {
		const story = fakeStory(2);

		story.passages[0].name = 'a';
		story.passages[0].text = '[[b]] [[b]]';
		story.passages[1].name = 'b';
		story.passages[1].text = '[[a]] [[a]] [[a]]';
		await renderComponent({story});

		const row = screen.getByText('dialogs.storyDetails.stats.links').parentNode;

		await waitFor(() =>
			expect(row!.querySelectorAll('td')[0].textContent).toBe('2')
		);
	});

	it('shows a broken link count for the story', async () => {
		const story = fakeStory(2);

		story.passages[0].name = 'a';
		story.passages[0].text = '[[b]]';
		story.passages[1].name = 'b';
		story.passages[1].text = '[[a]] [[c]]';
		await renderComponent({story});

		const row = screen.getByText(
			'dialogs.storyDetails.stats.brokenLinks'
		).parentNode;

		await waitFor(() =>
			expect(row!.querySelectorAll('td')[0].textContent).toBe('1')
		);
	});

	it('shows the time the story was last updated', async () => {
		await renderComponent();
		expect(
			screen.getByText('dialogs.storyDetails.stats.lastUpdate')
		).toBeInTheDocument();
	});

	it("shows the story's IFID", async () => {
		await renderComponent();
		expect(
			screen.getByText('dialogs.storyDetails.stats.ifid')
		).toBeInTheDocument();
	});

	it('shows a link that explains what an IFID is', async () => {
		await renderComponent();
		expect(
			screen.getByText('dialogs.storyDetails.stats.ifidExplanation')
		).toHaveAttribute('href', 'https://ifdb.org/help-ifid');
	});

	it('is accessible', async () => {
		const {container} = await renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
