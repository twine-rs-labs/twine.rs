import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {useStoriesContext} from '../../store/stories';
import {
	FakeStateProvider,
	FakeStateProviderProps,
	fakeStory,
	StoryInspector
} from '../../test-util';
import {StoryStylesheetDialog} from '../story-stylesheet';

const TestStoryStylesheetDialog = () => {
	const {stories} = useStoriesContext();

	return (
		<StoryStylesheetDialog
			collapsed={false}
			onChangeCollapsed={jest.fn()}
			onChangeHighlighted={jest.fn()}
			onChangeMaximized={jest.fn()}
			onChangeProps={jest.fn()}
			onClose={jest.fn()}
			storyId={stories[0].id}
		/>
	);
};

describe('<StoryStylesheetDialog>', () => {
	function renderComponent(contexts?: FakeStateProviderProps) {
		return render(
			<FakeStateProvider {...contexts}>
				<TestStoryStylesheetDialog />
				<StoryInspector />
			</FakeStateProvider>
		);
	}

	it('displays a dialog that can be maximized', () => {
		renderComponent();
		expect(screen.getByLabelText('common.maximize')).toBeInTheDocument();
	});

	it("displays the story's stylesheet", () => {
		const story = fakeStory();

		story.stylesheet = 'mock-story-stylesheet';
		renderComponent({stories: [story]});
		expect(
			screen.getByLabelText('dialogs.storyStylesheet.editorLabel')
		).toHaveTextContent('mock-story-stylesheet');
	});

	it("changes the story's stylesheet as edits are made", async () => {
		const {container} = renderComponent();
		const content = container.querySelector('.cm-content')!;

		content.textContent = 'mock-change';
		fireEvent.input(content);
		await waitFor(() =>
			expect(
				screen.getByTestId('story-inspector-stylesheet-default')
			).toHaveTextContent('mock-change')
		);
	});

	it('uses the code editor font preferences', () => {
		renderComponent({
			prefs: {
				codeEditorFontFamily: 'mock-font-family',
				codeEditorFontScale: 2,
				passageEditorFontFamily: 'incorrect-font-family',
				passageEditorFontScale: 1.75
			}
		});

		const editor = screen
			.getByTestId('story-stylesheet-dialog-code-area')
			.closest('.source-editor') as HTMLElement;

		expect(editor.style.getPropertyValue('--source-editor-font-family')).toBe(
			'mock-font-family'
		);
		expect(editor.style.getPropertyValue('--source-editor-font-size')).toBe(
			'26px'
		);
	});

	it('sets the source editor to CSS mode', () => {
		const {container} = renderComponent();

		expect(container.querySelector('.cm-foldGutter')).toBeInTheDocument();
	});

	it('blinks the cursor if that preference is not set', () => {
		renderComponent({prefs: {editorCursorBlinks: true}});
		expect(document.querySelector('.source-editor')).not.toHaveClass(
			'source-editor--static-cursor'
		);
	});

	it("doesn't blink the cursor if that preference is set", () => {
		renderComponent({prefs: {editorCursorBlinks: false}});
		expect(document.querySelector('.source-editor')).toHaveClass(
			'source-editor--static-cursor'
		);
	});

	it('renders its source editor', () => {
		renderComponent();
		expect(
			screen.getByTestId('story-stylesheet-dialog-code-area')
		).toBeInTheDocument();
	});

	it('shows undo, redo, and indent buttons', () => {
		renderComponent();
		expect(
			screen.getByRole('button', {name: 'common.undo'})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: 'common.redo'})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: 'components.indentButtons.indent'})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {
				name: 'components.indentButtons.unindent'
			})
		).toBeInTheDocument();
	});

	it('indents and unindents code with its indent buttons', async () => {
		const story = fakeStory();

		story.stylesheet = 'body { color: red; }';

		renderComponent({stories: [story]});
		fireEvent.click(
			screen.getByRole('button', {
				name: 'components.indentButtons.indent'
			})
		);
		await waitFor(() =>
			expect(
				screen.getByTestId('story-inspector-stylesheet-default').textContent
			).toBe('  body { color: red; }')
		);

		fireEvent.click(
			screen.getByRole('button', {
				name: 'components.indentButtons.unindent'
			})
		);
		await waitFor(() =>
			expect(
				screen.getByTestId('story-inspector-stylesheet-default').textContent
			).toBe('body { color: red; }')
		);
	});

	it('undoes and redoes changes with the undo/redo buttons', async () => {
		const story = fakeStory();

		story.stylesheet = 'body { color: red; }';
		const {container} = renderComponent({stories: [story]});
		const content = container.querySelector('.cm-content')!;

		content.textContent = 'body { color: blue; }';
		fireEvent.input(content);
		const undo = screen.getByRole('button', {name: 'common.undo'});

		await waitFor(() => expect(undo).toBeEnabled());
		fireEvent.click(undo);
		await waitFor(() =>
			expect(
				screen.getByTestId('story-inspector-stylesheet-default')
			).toHaveTextContent('body { color: red; }')
		);

		const redo = screen.getByRole('button', {name: 'common.redo'});

		await waitFor(() => expect(redo).toBeEnabled());
		fireEvent.click(redo);
		await waitFor(() =>
			expect(
				screen.getByTestId('story-inspector-stylesheet-default')
			).toHaveTextContent('body { color: blue; }')
		);
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
