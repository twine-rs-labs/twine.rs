import {act, fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {
	FakeStateProvider,
	FakeStateProviderProps,
	fakeStory,
	StoryInspector
} from '../../../test-util';
import {StoreCoreProjectHost} from '../../../core/project-host';
import {StoryTextPanel} from '../story-text-panel';

jest.mock('../../../components/control/source-editor', () => ({
	SourceEditor: (props: {
		id: string;
		label: string;
		onChange: (value: string) => void;
		value: string;
	}) => (
		<textarea
			aria-label={props.label}
			data-testid={props.id}
			onChange={event => props.onChange(event.currentTarget.value)}
			value={props.value}
		/>
	)
}));

describe('<StoryTextPanel>', () => {
	let applyStoryCommandSpy: jest.SpyInstance;

	function renderComponent(contexts?: FakeStateProviderProps) {
		const story = contexts?.stories?.[0] ?? fakeStory(2);

		render(
			<FakeStateProvider {...contexts} stories={[story]}>
				<StoryTextPanel
					selectedPassageId={story.passages[0]?.id}
					story={story}
				/>
				<StoryInspector />
			</FakeStateProvider>
		);

		return story;
	}

	beforeEach(() => {
		jest.useFakeTimers();
		applyStoryCommandSpy = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'applyStoryCommand'
		);
	});

	afterEach(() => {
		act(() => jest.runOnlyPendingTimers());
		applyStoryCommandSpy.mockRestore();
		jest.useRealTimers();
	});

	it('updates passage text through the core project host', () => {
		const story = renderComponent();

		fireEvent.change(
			screen.getByLabelText('dialogs.passageEdit.passageTextEditorLabel'),
			{target: {value: 'mock-passage-change'}}
		);
		act(() => jest.advanceTimersByTime(300));

		expect(
			screen.getByTestId(`passage-${story.passages[0].id}`)
		).toHaveTextContent('mock-passage-change');
		expect(applyStoryCommandSpy).toHaveBeenCalledWith({
			passage_id: story.passages[0].id,
			story_id: story.id,
			text: 'mock-passage-change',
			type: 'updatePassageText'
		});
	});

	it("updates the story's JavaScript through the core project host", () => {
		const story = renderComponent();

		fireEvent.click(
			screen.getByRole('tab', {name: 'routes.storyEdit.toolbar.javaScript'})
		);
		fireEvent.change(
			screen.getByLabelText('dialogs.passageEdit.passageTextEditorLabel'),
			{target: {value: 'mock-script-change'}}
		);
		act(() => jest.advanceTimersByTime(300));

		expect(
			screen.getByTestId('story-inspector-javascript-default')
		).toHaveTextContent('mock-script-change');
		expect(applyStoryCommandSpy).toHaveBeenCalledWith({
			script: 'mock-script-change',
			story_id: story.id,
			type: 'updateStoryScript'
		});
	});

	it("updates the story's stylesheet through the core project host", () => {
		const story = renderComponent();

		fireEvent.click(
			screen.getByRole('tab', {name: 'routes.storyEdit.toolbar.stylesheet'})
		);
		fireEvent.change(
			screen.getByLabelText('dialogs.passageEdit.passageTextEditorLabel'),
			{target: {value: 'mock-stylesheet-change'}}
		);
		act(() => jest.advanceTimersByTime(300));

		expect(
			screen.getByTestId('story-inspector-stylesheet-default')
		).toHaveTextContent('mock-stylesheet-change');
		expect(applyStoryCommandSpy).toHaveBeenCalledWith({
			story_id: story.id,
			stylesheet: 'mock-stylesheet-change',
			type: 'updateStoryStylesheet'
		});
	});
});
