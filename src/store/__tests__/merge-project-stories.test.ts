import {mergeProjectStories} from '../merge-project-stories';
import {fakeStory} from '../../test-util/fakes';

describe('mergeProjectStories', () => {
	it('reuses a fully hydrated story when its identity is already stable', () => {
		const hydrated = fakeStory(3);
		const shell = {
			...hydrated,
			passages: hydrated.passages.map(passage => ({...passage, text: ''})),
			script: '',
			stylesheet: ''
		};

		const result = mergeProjectStories([shell], [hydrated], {
			preserveExistingText: true
		});

		expect(result[0]).toBe(hydrated);
		expect(result[0].passages[0]).toBe(hydrated.passages[0]);
	});
});
