import * as React from 'react';
import classNames from 'classnames';
import {colorToCss, DesignSystemHue} from './colors';
import {TablerIcon} from './tabler-icon';
import './design-system.css';

export type TagColor = DesignSystemHue;

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
	children?: React.ReactNode;
	color?: TagColor | string;
	hash?: boolean;
	onRemove?: () => void;
	onClick?: (e: React.MouseEvent) => void;
}

export const Tag: React.FC<TagProps> = ({
	children,
	className,
	color = 'blue',
	hash = true,
	onClick,
	onKeyDown,
	onRemove,
	...rest
}) => {
	const interactive = !!onClick;

	return (
		<span
			className={classNames(
				'tw-tag',
				interactive && 'tw-tag--button',
				className
			)}
			onClick={onClick}
			onKeyDown={event => {
				onKeyDown?.(event);

				if (
					!event.defaultPrevented &&
					onClick &&
					(event.key === 'Enter' || event.key === ' ')
				) {
					event.preventDefault();
					onClick(event as unknown as React.MouseEvent);
				}
			}}
			role={interactive ? 'button' : undefined}
			tabIndex={interactive ? 0 : undefined}
			{...rest}
		>
			<span
				className="tw-tag__dot"
				style={{background: colorToCss(color)}}
			/>
			{hash && <span className="tw-tag__hash">#</span>}
			{children}
			{onRemove && (
				<button
					aria-label="Remove tag"
					className="tw-tag__x"
					onClick={event => {
						event.stopPropagation();
						onRemove();
					}}
					type="button"
				>
					<TablerIcon className="tw-ds-icon" icon="x" />
				</button>
			)}
		</span>
	);
};

