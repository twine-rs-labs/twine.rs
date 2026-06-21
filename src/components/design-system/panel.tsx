import * as React from 'react';
import classNames from 'classnames';
import {TablerIcon} from './tabler-icon';
import './design-system.css';

export interface PanelProps extends React.HTMLAttributes<HTMLElement> {
	title?: string;
	icon?: string;
	count?: number | string;
	actions?: React.ReactNode;
	pad?: boolean;
	flush?: boolean;
	bodyClassName?: string;
	children?: React.ReactNode;
}

export const Panel: React.FC<PanelProps> = ({
	actions,
	bodyClassName,
	children,
	className,
	count,
	flush = false,
	icon,
	pad = false,
	title,
	...rest
}) => (
	<section
		className={classNames('tw-panel', flush && 'tw-panel--flush', className)}
		{...rest}
	>
		{(title || actions) && (
			<header className="tw-panel__head">
				{icon && (
					<span className="tw-panel__icon">
						<TablerIcon className="tw-ds-icon" icon={icon} />
					</span>
				)}
				{title && <span className="tw-panel__title">{title}</span>}
				{count != null && <span className="tw-panel__count">{count}</span>}
				{actions && <span className="tw-panel__actions">{actions}</span>}
			</header>
		)}
		<div
			className={classNames(
				'tw-panel__body',
				pad && 'tw-panel__body--pad',
				bodyClassName
			)}
		>
			{children}
		</div>
	</section>
);

