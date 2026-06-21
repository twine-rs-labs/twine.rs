import * as React from 'react';
import classNames from 'classnames';
import {TablerIcon} from './tabler-icon';
import './design-system.css';

export type BadgeTone =
	| 'neutral'
	| 'link'
	| 'tag'
	| 'var'
	| 'warn'
	| 'error'
	| 'dirty'
	| 'saved'
	| 'generated'
	| 'build';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
	children?: React.ReactNode;
	tone?: BadgeTone;
	icon?: string;
	dot?: boolean;
	mono?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
	children,
	className,
	dot = false,
	icon,
	mono = false,
	tone = 'neutral',
	...rest
}) => (
	<span
		className={classNames(
			'tw-badge',
			`tw-badge--${tone}`,
			mono && 'tw-badge--mono',
			className
		)}
		{...rest}
	>
		{dot && <span className="tw-badge__dot" />}
		{icon && <TablerIcon className="tw-ds-icon" icon={icon} />}
		{children}
	</span>
);

