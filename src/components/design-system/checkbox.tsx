import * as React from 'react';
import classNames from 'classnames';
import {TablerIcon} from './tabler-icon';
import './design-system.css';

export interface CheckboxProps {
	checked: boolean;
	indeterminate?: boolean;
	onChange?: (checked: boolean) => void;
	label?: string;
	disabled?: boolean;
	className?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
	checked,
	className,
	disabled = false,
	indeterminate = false,
	label,
	onChange
}) => {
	const inputRef = React.useRef<HTMLInputElement>(null);

	React.useEffect(() => {
		if (inputRef.current) {
			inputRef.current.indeterminate = indeterminate;
		}
	}, [indeterminate]);

	return (
		<label
			className={classNames(
				'tw-check',
				disabled && 'tw-check--disabled',
				className
			)}
		>
			<input
				aria-checked={indeterminate ? 'mixed' : checked}
				checked={checked}
				disabled={disabled}
				onChange={event => onChange?.(event.target.checked)}
				ref={inputRef}
				type="checkbox"
			/>
			<span className="tw-check__box">
				<TablerIcon
					className="tw-ds-icon"
					icon={indeterminate ? 'minus' : 'check'}
				/>
			</span>
			{label && <span>{label}</span>}
		</label>
	);
};

