import * as React from 'react';
import classNames from 'classnames';
import {Tooltip, TooltipProps} from '../tooltip';
import {TablerIcon} from './tabler-icon';
import './design-system.css';

export interface IconButtonProps extends Omit<
	React.ButtonHTMLAttributes<HTMLButtonElement>,
	'aria-label'
> {
	icon: string;
	label: string;
	active?: boolean;
	solid?: boolean;
	size?: 'sm' | 'md';
	disabled?: boolean;
	tooltipPosition?: TooltipProps['position'];
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
	(
		{
			active = false,
			'aria-pressed': ariaPressed,
			className,
			disabled = false,
			icon,
			label,
			size = 'md',
			solid = false,
			tooltipPosition,
			type = 'button',
			...rest
		},
		ref
	) => {
		const [button, setButton] = React.useState<HTMLButtonElement | null>(null);

		React.useImperativeHandle(ref, () => button as HTMLButtonElement, [button]);

		return (
			<>
				<button
					aria-label={label}
					aria-pressed={ariaPressed ?? (active || undefined)}
					className={classNames(
						'tw-iconbtn',
						active && 'tw-iconbtn--active',
						solid && 'tw-iconbtn--solid',
						size === 'sm' && 'tw-iconbtn--sm',
						className
					)}
					disabled={disabled}
					ref={setButton}
					type={type}
					{...rest}
				>
					<TablerIcon className="tw-ds-icon" icon={icon} />
				</button>
				<Tooltip anchor={button} label={label} position={tooltipPosition} />
			</>
		);
	}
);

IconButton.displayName = 'IconButton';
