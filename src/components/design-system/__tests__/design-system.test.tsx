import * as React from 'react';
import {axe} from 'jest-axe';
import {fireEvent, render, screen} from '@testing-library/react';
import {
	Badge,
	Button,
	Checkbox,
	IconButton,
	Input,
	Panel,
	PassageNode,
	SegmentedControl,
	Select,
	Switch,
	Tag,
	TablerIcon
} from '..';

describe('design-system primitives', () => {
	it('renders buttons with variants, icons, loading state, and block sizing', () => {
		const {container} = render(
			<Button block icon="package-export" loading variant="primary">
				Export HTML
			</Button>
		);
		const button = screen.getByRole('button', {name: 'Export HTML'});

		expect(button).toHaveClass('tw-btn--primary');
		expect(button).toHaveClass('tw-btn--block');
		expect(button).toBeDisabled();
		expect(button).toHaveAttribute('aria-busy', 'true');
		expect(container.querySelector('.tw-btn__spin')).toBeInTheDocument();
	});

	it('resolves Tabler icon names from the DS kebab-case contract', () => {
		const {container} = render(<TablerIcon icon="package-export" />);

		expect(
			container.querySelector('[data-icon-name="package-export"]')
		).toBeInTheDocument();
		expect(container.querySelector('svg')).toBeInTheDocument();
	});

	it('renders icon buttons with accessible names and toggle state', () => {
		render(<IconButton active icon="grid-dots" label="Snap to grid" solid />);

		const button = screen.getByRole('button', {name: 'Snap to grid'});
		expect(button).toHaveAttribute('title', 'Snap to grid');
		expect(button).toHaveAttribute('aria-pressed', 'true');
		expect(button).toHaveClass('tw-iconbtn--active');
		expect(button).toHaveClass('tw-iconbtn--solid');
	});

	it('renders inputs with labels, keyboard hints, and invalid state', () => {
		const onChange = jest.fn();

		render(
			<Input
				icon="search"
				invalid
				kbd="Cmd K"
				label="Project Name"
				onChange={onChange}
			/>
		);
		const input = screen.getByLabelText('Project Name');

		fireEvent.change(input, {target: {value: 'Lighthouse'}});
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(input).toHaveAttribute('aria-invalid', 'true');
		expect(screen.getByText('Cmd K')).toBeInTheDocument();
	});

	it('returns selected values from selects', () => {
		const onChange = jest.fn();

		render(
			<Select
				onChange={onChange}
				options={[
					{label: 'Last Modified', value: 'modified'},
					{label: 'Name', value: 'name'}
				]}
				value="modified"
			/>
		);
		fireEvent.change(screen.getByRole('combobox'), {
			target: {value: 'name'}
		});
		expect(onChange).toHaveBeenCalledWith('name');
	});

	it('returns selected values from segmented controls', () => {
		const onChange = jest.fn();

		render(
			<SegmentedControl
				onChange={onChange}
				options={[
					{value: 'text', label: 'Text', icon: 'file-text'},
					{value: 'graph', label: 'Graph', icon: 'binary-tree'}
				]}
				value="text"
			/>
		);
		expect(screen.getByRole('tab', {name: 'Text'})).toHaveAttribute(
			'aria-selected',
			'true'
		);
		fireEvent.click(screen.getByRole('tab', {name: 'Graph'}));
		expect(onChange).toHaveBeenCalledWith('graph');
	});

	it('returns checked values from switches and checkboxes', () => {
		const onSwitchChange = jest.fn();
		const onCheckboxChange = jest.fn();

		render(
			<>
				<Switch
					checked={false}
					label="Snap to grid"
					onChange={onSwitchChange}
				/>
				<Checkbox
					checked={false}
					indeterminate
					label="3 of 8 selected"
					onChange={onCheckboxChange}
				/>
			</>
		);
		const switchInput = screen.getByLabelText('Snap to grid');
		const checkboxInput = screen.getByLabelText(
			'3 of 8 selected'
		) as HTMLInputElement;

		expect(checkboxInput.indeterminate).toBe(true);
		expect(checkboxInput).toHaveAttribute('aria-checked', 'mixed');
		fireEvent.click(switchInput);
		fireEvent.click(checkboxInput);
		expect(onSwitchChange).toHaveBeenCalledWith(true);
		expect(onCheckboxChange).toHaveBeenCalledWith(true);
	});

	it('renders badges and tags with semantic styling', () => {
		const onClick = jest.fn();
		const onRemove = jest.fn();

		render(
			<>
				<Badge dot icon="unlink" mono tone="error">
					3 broken
				</Badge>
				<Tag color="purple" onClick={onClick} onRemove={onRemove}>
					night
				</Tag>
			</>
		);
		expect(screen.getByText('3 broken')).toHaveClass('tw-badge--error');
		expect(screen.getByText('3 broken')).toHaveClass('tw-badge--mono');
		fireEvent.click(screen.getByRole('button', {name: 'Remove tag'}));
		expect(onRemove).toHaveBeenCalledTimes(1);
		expect(onClick).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole('button', {name: /night/}));
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it('renders panel anatomy', () => {
		const {container} = render(
			<Panel
				actions={<IconButton icon="refresh" label="Recheck" size="sm" />}
				bodyClassName="custom-body"
				count={4}
				icon="alert-triangle"
				pad
				title="Diagnostics"
			>
				Rows
			</Panel>
		);

		expect(screen.getByText('Diagnostics')).toHaveClass('tw-panel__title');
		expect(screen.getByText('4')).toHaveClass('tw-panel__count');
		expect(screen.getByRole('button', {name: 'Recheck'})).toBeInTheDocument();
		expect(container.querySelector('.custom-body')).toHaveClass(
			'tw-panel__body--pad'
		);
	});

	it('renders passage nodes with graph state', () => {
		const onClick = jest.fn();

		render(
			<PassageNode
				accent="red"
				broken={1}
				excerpt="The path forks."
				links={3}
				onClick={onClick}
				selected
				start
				tags={['green', 'purple']}
				title="Forest Entrance"
			/>
		);

		const node = screen.getByRole('button', {name: /Forest Entrance/});
		expect(node).toHaveClass('tw-node--selected');
		expect(node).toHaveClass('tw-node--start');
		expect(screen.getByText('The path forks.')).toBeInTheDocument();
		expect(screen.getByText('3')).toBeInTheDocument();
		expect(screen.getByText('1')).toBeInTheDocument();
		fireEvent.click(node);
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it('is accessible as a primitive specimen', async () => {
		const {container} = render(
			<Panel title="Specimen" pad>
				<Button icon="plus">New Passage</Button>
				<IconButton icon="player-play" label="Play" />
				<Input label="Project Name" placeholder="Untitled Story" />
				<Switch checked label="Snap to grid" />
				<Checkbox checked label="Match Case" />
				<Badge tone="saved">Saved</Badge>
				<Tag>intro</Tag>
				<PassageNode title="Start" />
			</Panel>
		);

		expect(await axe(container)).toHaveNoViolations();
	});
});
