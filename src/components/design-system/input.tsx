import * as React from 'react';
import classNames from 'classnames';
import {TablerIcon} from './tabler-icon';
import './design-system.css';

let inputId = 0;

function nextInputId() {
	inputId += 1;
	return `tw-in-${inputId}`;
}

export interface InputProps extends Omit<
	React.InputHTMLAttributes<HTMLInputElement>,
	'size'
> {
	label?: string;
	icon?: string;
	kbd?: string;
	invalid?: boolean;
	mono?: boolean;
	block?: boolean;
	disabled?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
	(
		{
			block = false,
			className,
			disabled = false,
			icon,
			id,
			invalid = false,
			kbd,
			label,
			mono = false,
			...rest
		},
		ref
	) => {
		const generatedId = React.useMemo(
			() => id ?? (label ? nextInputId() : undefined),
			[id, label]
		);
		const field = (
			<div
				aria-disabled={disabled || undefined}
				className={classNames(
					'tw-input',
					invalid && 'tw-input--invalid',
					mono && 'tw-input--mono',
					className
				)}
			>
				{icon && <TablerIcon className="tw-ds-icon" icon={icon} />}
				<input
					aria-invalid={invalid || undefined}
					disabled={disabled}
					id={generatedId}
					ref={ref}
					{...rest}
				/>
				{kbd && <span className="tw-input__kbd">{kbd}</span>}
			</div>
		);

		if (!label) {
			return block ? (
				<div className="tw-field tw-field--block">{field}</div>
			) : (
				field
			);
		}

		return (
			<div className={classNames('tw-field', block && 'tw-field--block')}>
				<label className="tw-field__label" htmlFor={generatedId}>
					{label}
				</label>
				{field}
			</div>
		);
	}
);

Input.displayName = 'Input';
