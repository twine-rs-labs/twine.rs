import * as React from 'react';
import classNames from 'classnames';
import {TablerIcon} from './tabler-icon';
import './design-system.css';

export interface IconButtonProps
	extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
	icon: string;
	label: string;
	active?: boolean;
	solid?: boolean;
	size?: 'sm' | 'md';
	disabled?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
	(
		{
			active = false,
			className,
			disabled = false,
			icon,
			label,
			size = 'md',
			solid = false,
			...rest
		},
		ref
	) => (
		<button
			aria-label={label}
			aria-pressed={active || undefined}
			className={classNames(
				'tw-iconbtn',
				active && 'tw-iconbtn--active',
				solid && 'tw-iconbtn--solid',
				size === 'sm' && 'tw-iconbtn--sm',
				className
			)}
			disabled={disabled}
			ref={ref}
			title={label}
			{...rest}
		>
			<TablerIcon className="tw-ds-icon" icon={icon} />
		</button>
	)
);

IconButton.displayName = 'IconButton';

