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
import {StoryJavaScriptDialog} from '../story-javascript';

const TestStoryJavaScriptDialog = () => {
	const {stories} = useStoriesContext();

	return (
		<StoryJavaScriptDialog
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

describe('<StoryJavaScriptDialog>', () => {
	function renderComponent(contexts?: FakeStateProviderProps) {
		return render(
			<FakeStateProvider {...contexts}>
				<TestStoryJavaScriptDialog />
				<StoryInspector />
			</FakeStateProvider>
		);
	}

	it('displays a dialog that can be maximized', () => {
		renderComponent();
		expect(screen.getByLabelText('common.maximize')).toBeInTheDocument();
	});

	it("displays the story's JavaScript", () => {
		const story = fakeStory();

		story.script = 'mock-story-javascript';

		renderComponent({stories: [story]});

		expect(
			screen.getByLabelText('dialogs.storyJavaScript.editorLabel')
		).toHaveTextContent('mock-story-javascript');
	});

	it("changes the story's JavaScript as edits are made", async () => {
		const {container} = renderComponent();
		const content = container.querySelector('.cm-content')!;

		content.textContent = 'mock-change';
		fireEvent.input(content);
		await waitFor(() =>
			expect(
				screen.getByTestId('story-inspector-javascript-default')
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
			.getByTestId('story-javascript-dialog-code-area')
			.closest('.source-editor') as HTMLElement;

		expect(editor.style.getPropertyValue('--source-editor-font-family')).toBe(
			'mock-font-family'
		);
		expect(editor.style.getPropertyValue('--source-editor-font-size')).toBe(
			'26px'
		);
	});

	it('sets the source editor to JavaScript mode', () => {
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
			screen.getByTestId('story-javascript-dialog-code-area')
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

		story.script = 'const value = 1;';

		renderComponent({stories: [story]});
		fireEvent.click(
			screen.getByRole('button', {
				name: 'components.indentButtons.indent'
			})
		);
		await waitFor(() =>
			expect(
				screen.getByTestId('story-inspector-javascript-default').textContent
			).toBe('  const value = 1;')
		);

		fireEvent.click(
			screen.getByRole('button', {
				name: 'components.indentButtons.unindent'
			})
		);
		await waitFor(() =>
			expect(
				screen.getByTestId('story-inspector-javascript-default').textContent
			).toBe('const value = 1;')
		);
	});

	it('undoes and redoes changes with the undo/redo buttons', async () => {
		const story = fakeStory();

		story.script = 'before();';
		const {container} = renderComponent({stories: [story]});
		const content = container.querySelector('.cm-content')!;

		content.textContent = 'after();';
		fireEvent.input(content);
		const undo = screen.getByRole('button', {name: 'common.undo'});

		await waitFor(() => expect(undo).toBeEnabled());
		fireEvent.click(undo);
		await waitFor(() =>
			expect(
				screen.getByTestId('story-inspector-javascript-default')
			).toHaveTextContent('before();')
		);

		const redo = screen.getByRole('button', {name: 'common.redo'});

		await waitFor(() => expect(redo).toBeEnabled());
		fireEvent.click(redo);
		await waitFor(() =>
			expect(
				screen.getByTestId('story-inspector-javascript-default')
			).toHaveTextContent('after();')
		);
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
