import {render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {SourceEditor} from '../source-editor';

describe('<SourceEditor>', () => {
	afterEach(() => {
		window.localStorage.clear();
		jest.restoreAllMocks();
	});

	it('clamps restored selections to the current document', () => {
		window.localStorage.setItem(
			'twine-source-editor-story-start',
			JSON.stringify({
				anchor: 999,
				head: 1000,
				scrollLeft: 0,
				scrollTop: 0
			})
		);

		expect(() =>
			render(
				<SourceEditor
					id="story-start-editor"
					label="Passage text"
					memoryKey="story-start"
					onChange={jest.fn()}
					value="Short"
				/>
			)
		).not.toThrow();

		expect(
			screen.getByRole('textbox', {name: 'Passage text'})
		).toBeInTheDocument();
	});

	it('highlights Harlowe and SugarCube macros without marking parenthesized prose', async () => {
		const {container} = render(
			<SourceEditor
				id="story-start-editor"
				label="Passage text"
				onChange={jest.fn()}
				value={
					'(if: true)[Shown]\n' +
					'<<=Story.name>>\n' +
					'<</if>>\n' +
					'$object.properties\n' +
					'(you have to force yourself)'
				}
			/>
		);

		await waitFor(() =>
			expect(container.querySelectorAll('.cm-twine-macro')).toHaveLength(3)
		);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-macro')).map(element =>
				element.textContent?.trim()
			)
		).toEqual(['(if:', '<<=Story.name>>', '<</if>>']);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-variable')).map(
				element => element.textContent?.trim()
			)
		).toContain('$object.properties');
		expect(container).toHaveTextContent('(you have to force yourself)');
		expect(
			Array.from(container.querySelectorAll('.cm-twine-macro')).some(element =>
				element.textContent?.includes('(you')
			)
		).toBe(false);
	});

	it('toggles the editor search panel when requested without an explicit query', async () => {
		const {container, rerender} = render(
			<SourceEditor
				id="story-start-editor"
				label="Passage text"
				onChange={jest.fn()}
				value="Find this text"
			/>
		);

		rerender(
			<SourceEditor
				id="story-start-editor"
				label="Passage text"
				onChange={jest.fn()}
				searchRequestKey={1}
				value="Find this text"
			/>
		);

		await waitFor(() =>
			expect(container.querySelector('.cm-search')).toBeInTheDocument()
		);

		rerender(
			<SourceEditor
				id="story-start-editor"
				label="Passage text"
				onChange={jest.fn()}
				searchRequestKey={2}
				value="Find this text"
			/>
		);

		await waitFor(() =>
			expect(container.querySelector('.cm-search')).not.toBeInTheDocument()
		);
	});
});
