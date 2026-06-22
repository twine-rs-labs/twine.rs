import * as React from 'react';
import classNames from 'classnames';
import {TablerIcon} from './tabler-icon';
import './design-system.css';

export interface SegmentOption {
	value: string;
	label: string;
	icon?: string;
}

export interface SegmentedControlProps {
	options: Array<string | SegmentOption>;
	value: string;
	onChange?: (value: string) => void;
	size?: 'sm' | 'md';
	className?: string;
}

function normalizeOption(option: string | SegmentOption): SegmentOption {
	return typeof option === 'string' ? {label: option, value: option} : option;
}

export const SegmentedControl: React.FC<SegmentedControlProps> = ({
	className,
	onChange,
	options,
	size = 'md',
	value
}) => (
	<div
		className={classNames('tw-seg', size === 'sm' && 'tw-seg--sm', className)}
		role="tablist"
	>
		{options.map(option => {
			const {icon, label, value: optionValue} = normalizeOption(option);
			const selected = optionValue === value;

			return (
				<button
					aria-selected={selected}
					className={classNames('tw-seg__opt', selected && 'tw-seg__opt--on')}
					key={optionValue}
					onClick={() => onChange?.(optionValue)}
					role="tab"
					type="button"
				>
					{icon && <TablerIcon className="tw-ds-icon" icon={icon} />}
					{label}
				</button>
			);
		})}
	</div>
);
