import * as React from 'react';
import classNames from 'classnames';
import './design-system.css';

export interface SwitchProps {
	checked: boolean;
	onChange?: (checked: boolean) => void;
	label?: string;
	disabled?: boolean;
	className?: string;
}

export const Switch: React.FC<SwitchProps> = ({
	checked,
	className,
	disabled = false,
	label,
	onChange
}) => (
	<label
		className={classNames(
			'tw-switch',
			disabled && 'tw-switch--disabled',
			className
		)}
	>
		<input
			checked={checked}
			disabled={disabled}
			onChange={event => onChange?.(event.target.checked)}
			type="checkbox"
		/>
		<span className="tw-switch__track">
			<span className="tw-switch__thumb" />
		</span>
		{label && <span>{label}</span>}
	</label>
);
