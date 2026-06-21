import * as React from 'react';
import classNames from 'classnames';
import {Select} from '../design-system';
import './text-select.css';

export interface SelectOption {
	disabled?: boolean;
	label: string;
	value: string;
}

export interface TextSelectProps {
	children: React.ReactNode;
	onChange?: React.ChangeEventHandler<HTMLSelectElement>;
	options: SelectOption[];
	orientation?: 'horizontal' | 'vertical';
	value: string;
}

export const TextSelect: React.FC<TextSelectProps> = props => {
	const {children, onChange, options, orientation, value} = props;
	const className = classNames(
		'text-select',
		`orientation-${orientation ?? 'horizontal'}`
	);
	const handleChange = React.useCallback(
		(nextValue: string) => {
			onChange?.({
				currentTarget: {value: nextValue},
				target: {value: nextValue}
			} as React.ChangeEvent<HTMLSelectElement>);
		},
		[onChange]
	);

	return (
		<span className={className}>
			<label>
				<span className="text-select-label">{children}</span>
				<span className="text-select-control">
					<Select
						ariaLabel={typeof children === 'string' ? children : undefined}
						onChange={handleChange}
						options={options}
						value={value}
					/>
				</span>
			</label>
		</span>
	);
};
