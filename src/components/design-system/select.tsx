import * as React from 'react';
import classNames from 'classnames';
import {TablerIcon} from './tabler-icon';
import './design-system.css';

export interface SelectOption {
	value: string;
	label: string;
}

export interface SelectProps {
	options: Array<string | SelectOption>;
	value: string;
	onChange?: (value: string) => void;
	size?: 'sm' | 'md';
	block?: boolean;
	disabled?: boolean;
	className?: string;
}

export const Select: React.FC<SelectProps> = ({
	block = false,
	className,
	disabled = false,
	onChange,
	options,
	size = 'md',
	value
}) => (
	<div
		className={classNames(
			'tw-select',
			size === 'sm' && 'tw-select--sm',
			block && 'tw-select--block',
			className
		)}
	>
		<select
			disabled={disabled}
			onChange={event => onChange?.(event.target.value)}
			value={value}
		>
			{options.map(option => {
				const optionValue = typeof option === 'string' ? option : option.value;
				const optionLabel = typeof option === 'string' ? option : option.label;

				return (
					<option key={optionValue} value={optionValue}>
						{optionLabel}
					</option>
				);
			})}
		</select>
		<span className="tw-select__chev">
			<TablerIcon className="tw-ds-icon" icon="chevron-down" />
		</span>
	</div>
);

