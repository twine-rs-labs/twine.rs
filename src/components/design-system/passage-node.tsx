import * as React from 'react';
import classNames from 'classnames';
import {colorToCss} from './colors';
import {TablerIcon} from './tabler-icon';
import './design-system.css';

export interface PassageNodeProps extends React.HTMLAttributes<HTMLDivElement> {
	title: string;
	excerpt?: string;
	tags?: string[];
	links?: number;
	broken?: number;
	start?: boolean;
	selected?: boolean;
	accent?: string;
}

export const PassageNode: React.FC<PassageNodeProps> = ({
	accent,
	broken = 0,
	className,
	excerpt,
	links = 0,
	onClick,
	onKeyDown,
	selected = false,
	start = false,
	tags = [],
	title,
	...rest
}) => {
	const interactive = !!onClick;

	return (
		<div
			className={classNames(
				'tw-node',
				selected && 'tw-node--selected',
				start && 'tw-node--start',
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
					onClick(event as unknown as React.MouseEvent<HTMLDivElement>);
				}
			}}
			role={interactive ? 'button' : undefined}
			tabIndex={interactive ? 0 : undefined}
			{...rest}
		>
			{accent && (
				<div
					className="tw-node__bar"
					style={{background: colorToCss(accent)}}
				/>
			)}
			<div className="tw-node__body">
				<div className="tw-node__head">
					<span className="tw-node__title">{title}</span>
					{start && (
						<span className="tw-node__start" title="Start passage">
							<TablerIcon className="tw-ds-icon" icon="rocket" />
						</span>
					)}
				</div>
				{excerpt && <div className="tw-node__excerpt">{excerpt}</div>}
				{tags.length > 0 && (
					<div className="tw-node__tags">
						{tags.map((tag, index) => (
							<span
								className="tw-node__tag"
								key={`${tag}-${index}`}
								style={{background: colorToCss(tag)}}
							/>
						))}
					</div>
				)}
				<div className="tw-node__foot">
					<span className="tw-node__stat">
						<TablerIcon className="tw-ds-icon" icon="arrow-up-right" />
						{links}
					</span>
					{broken > 0 && (
						<span className="tw-node__stat tw-node__stat--broken">
							<TablerIcon className="tw-ds-icon" icon="unlink" />
							{broken}
						</span>
					)}
				</div>
			</div>
		</div>
	);
};
