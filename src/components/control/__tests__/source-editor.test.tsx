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
					'(set:_secret_thought to "secretly harbor")\n' +
					'<<=Story.name>>\n' +
					'<</if>>\n' +
					'$object.properties\n' +
					'// the keeper watches from the stair\n' +
					'(you have to force yourself)\n' +
					'She said "not a code string."'
				}
			/>
		);

		await waitFor(() =>
			expect(container.querySelectorAll('.cm-twine-macro')).toHaveLength(8)
		);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-macro')).map(element =>
				element.textContent?.trim()
			)
		).toEqual([
			'(if:',
			')',
			'(set:',
			')',
			'<<=Story.name',
			'>>',
			'<</if',
			'>>'
		]);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-string')).map(
				element => element.textContent
			)
		).toEqual(['"secretly harbor"', '"not a code string."']);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-comment')).map(
				element => element.textContent
			)
		).toEqual(['// the keeper watches from the stair']);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-variable')).map(
				element => element.textContent?.trim()
			)
		).toContain('$object.properties');
		expect(
			Array.from(container.querySelectorAll('.cm-twine-variable')).map(
				element => element.textContent?.trim()
			)
		).toContain('_secret_thought');
		expect(container).toHaveTextContent('(you have to force yourself)');
		expect(
			Array.from(container.querySelectorAll('.cm-twine-macro')).some(element =>
				element.textContent?.includes('(you')
			)
		).toBe(false);
	});

	it('highlights Chapbook and Snowman syntax with the shared Twine palette', async () => {
		const {container} = render(
			<SourceEditor
				id="story-start-editor"
				label="Passage text"
				onChange={jest.fn()}
				value={
					'{embed passage: "Lamp Room"}\n' +
					'{{ config.debug }}\n' +
					'<% if (s.lampLit) { %><%= "Glow" %><% } %>\n' +
					'[[Proof Link]]'
				}
			/>
		);

		await waitFor(() =>
			expect(container.querySelectorAll('.cm-twine-macro')).toHaveLength(10)
		);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-macro')).map(element =>
				element.textContent?.trim()
			)
		).toEqual([
			'{embed passage:',
			'}',
			'{{',
			'}}',
			'<%',
			'%>',
			'<%=',
			'%>',
			'<%',
			'%>'
		]);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-string')).map(
				element => element.textContent
			)
		).toEqual(['"Lamp Room"', '"Glow"']);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-link')).map(
				element => element.textContent
			)
		).toEqual(['[[Proof Link]]']);
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

	it('wraps passage prose without showing a fold gutter', async () => {
		const {container, rerender} = render(
			<SourceEditor
				id="story-start-editor"
				label="Passage text"
				onChange={jest.fn()}
				value="A very long passage line should wrap instead of forcing a horizontal scrollbar."
			/>
		);

		await waitFor(() =>
			expect(container.querySelector('.cm-lineWrapping')).toBeInTheDocument()
		);
		expect(container.querySelector('.cm-foldGutter')).not.toBeInTheDocument();

		rerender(
			<SourceEditor
				id="story-start-editor"
				label="Passage text"
				language="css"
				onChange={jest.fn()}
				value=".story { color: red; }"
			/>
		);

		await waitFor(() =>
			expect(container.querySelector('.cm-foldGutter')).toBeInTheDocument()
		);
	});
});
