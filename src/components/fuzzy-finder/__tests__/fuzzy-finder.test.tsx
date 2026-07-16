import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {FuzzyFinder, FuzzyFinderProps} from '../fuzzy-finder';

describe('FuzzyFinder', () => {
	function renderComponent(props?: Partial<FuzzyFinderProps>) {
		return render(
			<FuzzyFinder
				noResultsText="mock-no-results"
				onChangeSearch={jest.fn()}
				onClose={jest.fn()}
				onSelectResult={jest.fn()}
				prompt="mock-prompt"
				results={[{detail: 'result-1-detail', heading: 'result-2-heading'}]}
				search="mock-search"
				{...props}
			/>
		);
	}

	it('displays a prompt', () => {
		renderComponent({prompt: 'test-prompt'});
		expect(screen.getByText('test-prompt')).toBeInTheDocument();
	});

	it('displays a text field with the search prop as value', () => {
		renderComponent({search: 'test-search'});
		expect(screen.getByRole('textbox')).toHaveValue('test-search');
	});

	// jsdom doesn't seem to implement focus in a way that works for these tests.
	it.todo('focuses the text field when initially mounted');
	it.todo('provides keyboard shortcuts');

	it('calls the onChangeSearch prop when the text field is changed', () => {
		const onChangeSearch = jest.fn();

		renderComponent({onChangeSearch});
		expect(onChangeSearch).not.toHaveBeenCalled();
		fireEvent.change(screen.getByRole('textbox'), {
			target: {value: 'test-change'}
		});
		expect(onChangeSearch.mock.calls).toEqual([['test-change']]);
	});

	it('displays a close button which calls the onClose prop', () => {
		const onClose = jest.fn();

		renderComponent({onClose});
		expect(onClose).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole('button', {name: 'Close'}));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('displays a result for every entry in the results prop', () => {
		renderComponent({
			results: [
				{detail: 'test-detail-1', heading: 'test-heading-1'},
				{detail: 'test-detail-2', heading: 'test-heading-2'}
			]
		});

		expect(screen.getByText('test-detail-1')).toBeInTheDocument();
		expect(screen.getByText('test-detail-2')).toBeInTheDocument();
	});

	it('displays the noResultsText prop if there are no results', () => {
		renderComponent({
			noResultsText: 'test-no-results',
			results: []
		});
		expect(screen.getByText('test-no-results')).toBeInTheDocument();
	});

	it("doesn't display the noResultsText prop if there are results", () => {
		renderComponent({
			noResultsText: 'test-no-results',
			results: [{detail: 'test-detail-1', heading: 'test-heading-1'}]
		});
		expect(screen.queryByText('test-no-results')).not.toBeInTheDocument();
	});

	it('calls the onSelectResult prop with the array index when a result is clicked', () => {
		const onSelectResult = jest.fn();

		renderComponent({
			onSelectResult,
			results: [{detail: 'test-detail-1', heading: 'test-heading-1'}]
		});
		expect(onSelectResult).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText('test-detail-1'));
		expect(onSelectResult.mock.calls).toEqual([[0]]);
	});

	it('uses the current result count for keyboard navigation after rerendering', () => {
		const onSelectResult = jest.fn();
		const commonProps = {
			noResultsText: 'mock-no-results',
			onChangeSearch: jest.fn(),
			onClose: jest.fn(),
			onSelectResult,
			prompt: 'mock-prompt',
			search: 'mock-search'
		};
		const {rerender} = render(
			<FuzzyFinder
				{...commonProps}
				results={[{detail: 'result-1', heading: 'Result 1'}]}
			/>
		);
		const input = screen.getByRole('textbox');

		input.focus();
		rerender(
			<FuzzyFinder
				{...commonProps}
				results={[
					{detail: 'result-1', heading: 'Result 1'},
					{detail: 'result-2', heading: 'Result 2'}
				]}
			/>
		);
		fireEvent.keyDown(input, {code: 'ArrowDown', key: 'ArrowDown'});
		fireEvent.keyDown(input, {code: 'Enter', key: 'Enter'});

		expect(onSelectResult).toHaveBeenCalledWith(1);
	});

	it('cleans up a replaced callback ref and the ref attached after it', () => {
		const firstCleanup = jest.fn();
		const secondCleanup = jest.fn();
		const firstRef: React.RefCallback<HTMLDivElement> = jest.fn(element => {
			if (element) {
				return firstCleanup;
			}
		});
		const secondRef: React.RefCallback<HTMLDivElement> = jest.fn(element => {
			if (element) {
				return secondCleanup;
			}
		});
		const commonProps = {
			noResultsText: 'mock-no-results',
			onChangeSearch: jest.fn(),
			onClose: jest.fn(),
			onSelectResult: jest.fn(),
			prompt: 'mock-prompt',
			results: [],
			search: ''
		};
		const {rerender, unmount} = render(
			<FuzzyFinder {...commonProps} ref={firstRef} />
		);

		rerender(<FuzzyFinder {...commonProps} ref={secondRef} />);
		expect(firstCleanup).toHaveBeenCalledTimes(1);
		expect(firstRef).not.toHaveBeenCalledWith(null);
		expect(secondCleanup).not.toHaveBeenCalled();

		unmount();
		expect(firstCleanup).toHaveBeenCalledTimes(1);
		expect(secondCleanup).toHaveBeenCalledTimes(1);
		expect(secondRef).not.toHaveBeenCalledWith(null);
	});

	it('forwards null on detach when a callback ref has no cleanup', () => {
		const ref = jest.fn<
			ReturnType<React.RefCallback<HTMLDivElement>>,
			Parameters<React.RefCallback<HTMLDivElement>>
		>();
		const {unmount} = render(
			<FuzzyFinder
				noResultsText="mock-no-results"
				onChangeSearch={jest.fn()}
				onClose={jest.fn()}
				onSelectResult={jest.fn()}
				prompt="mock-prompt"
				ref={ref}
				results={[]}
				search=""
			/>
		);

		expect(ref).toHaveBeenCalledTimes(1);
		expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLDivElement);
		unmount();
		expect(ref).toHaveBeenCalledTimes(2);
		expect(ref).toHaveBeenLastCalledWith(null);
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
