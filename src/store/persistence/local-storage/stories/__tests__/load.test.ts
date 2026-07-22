import {load} from '../load';
import {fakeStory} from '../../../../../test-util';
import {i18n} from '../../../../../util/i18n';

describe('stories local storage load', () => {
	beforeEach(() => window.localStorage.clear());
	afterEach(() => window.localStorage.clear());

	it('resolves to an array of stories', async () => {
		const state = [fakeStory(), fakeStory()];
		const passageIds: string[] = [];

		window.localStorage.setItem(
			'twine-stories',
			`${state[0].id},${state[1].id}`
		);

		state.forEach(story => {
			window.localStorage.setItem(
				`twine-stories-${story.id}`,
				JSON.stringify({...story, passages: undefined})
			);

			story.passages.forEach(passage => {
				passageIds.push(passage.id);
				window.localStorage.setItem(
					`twine-passages-${passage.id}`,
					JSON.stringify(passage)
				);
			});
		});

		window.localStorage.setItem('twine-passages', passageIds.join(','));
		expect(await load()).toEqual(state);
	});

	it('migrates partial records with defaults before locale bootstrap completes', async () => {
		const storyId = 'partial-story';
		const passageId = 'partial-passage';
		const translationSpy = jest.spyOn(i18n, 't');

		window.localStorage.setItem('twine-stories', storyId);
		window.localStorage.setItem(
			`twine-stories-${storyId}`,
			JSON.stringify({id: storyId})
		);
		window.localStorage.setItem('twine-passages', passageId);
		window.localStorage.setItem(
			`twine-passages-${passageId}`,
			JSON.stringify({id: passageId, story: storyId})
		);

		const [story] = await load();

		expect(translationSpy).not.toHaveBeenCalled();
		expect(story).toMatchObject({
			id: storyId,
			name: 'Untitled Story',
			passages: [
				{
					height: 100,
					highlighted: false,
					id: passageId,
					left: 0,
					name: 'Untitled Passage',
					selected: false,
					story: storyId,
					tags: [],
					text: '',
					top: 0,
					width: 100
				}
			]
		});
	});
});
