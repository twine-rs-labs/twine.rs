import * as React from 'react';
import classNames from 'classnames';
import {TablerIcon} from './tabler-icon';
import './design-system.css';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	children?: React.ReactNode;
	variant?: ButtonVariant;
	size?: ButtonSize;
	icon?: string;
	iconRight?: string;
	loading?: boolean;
	block?: boolean;
	disabled?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			block = false,
			children,
			className,
			disabled = false,
			icon,
			iconRight,
			loading = false,
			size = 'md',
			type = 'button',
			variant = 'default',
			...rest
		},
		ref
	) => (
		<button
			aria-busy={loading || undefined}
			className={classNames(
				'tw-btn',
				`tw-btn--${variant}`,
				size !== 'md' && `tw-btn--${size}`,
				block && 'tw-btn--block',
				className
			)}
			disabled={disabled || loading}
			ref={ref}
			type={type}
			{...rest}
		>
			{loading ? (
				<span className="tw-btn__spin" aria-hidden />
			) : (
				icon && <TablerIcon className="tw-ds-icon" icon={icon} />
			)}
			{children && <span>{children}</span>}
			{iconRight && !loading && (
				<TablerIcon className="tw-ds-icon" icon={iconRight} />
			)}
		</button>
	)
);

Button.displayName = 'Button';
