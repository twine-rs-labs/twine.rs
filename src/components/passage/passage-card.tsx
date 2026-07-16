import classNames from 'classnames';
import {deviceType} from 'detect-it';
import * as React from 'react';
import {
	DraggableCore as ReactDraggableCore,
	DraggableCoreProps
} from 'react-draggable';
import {useTranslation} from 'react-i18next';
import {CardContent} from '../container/card';
import {SelectableCard} from '../container/card/selectable-card';
import {Passage, TagColors} from '../../store/stories';
import {TagStripe} from '../tag/tag-stripe';
import './passage-card.css';
import {TagBadges} from '../tag/tag-badges';
import {assignRef} from '../../util/assign-ref';

export interface PassageCardProps {
	excerpt?: string;
	isEmpty?: boolean;
	onEdit: (passage: Passage) => void;
	onDeselect: (passage: Passage) => void;
	onDragStart?: DraggableCoreProps['onStart'];
	onDrag?: DraggableCoreProps['onDrag'];
	onDragStop?: DraggableCoreProps['onStop'];
	onSelect: (passage: Passage, exclusive: boolean) => void;
	passage: Passage;
	tagColors: TagColors;
	tagDisplay: 'color' | 'name';
}

const DraggableCore: React.FC<Partial<DraggableCoreProps>> = props =>
	React.createElement(ReactDraggableCore, props);

// Needs to fill a large-sized passage card.
const excerptLength = 400;

export const PassageCard = React.memo(
	React.forwardRef<HTMLDivElement, PassageCardProps>((props, forwardedRef) => {
		const {
			onDeselect,
			onDrag,
			onDragStart,
			onDragStop,
			onEdit,
			onSelect,
			passage,
			excerpt: passageExcerpt = '',
			isEmpty = false,
			tagColors,
			tagDisplay
		} = props;
		const {t} = useTranslation();
		const className = React.useMemo(
			() =>
				classNames('passage-card', {
					empty: isEmpty,
					selected: passage.selected,
					[`tag-display-${tagDisplay}`]: true
				}),
			[isEmpty, passage, tagDisplay]
		);
		const container = React.useRef<HTMLDivElement | null>(null);
		const setContainer = React.useCallback(
			(element: HTMLDivElement | null) => {
				container.current = element;
				const forwardedCleanup = assignRef(forwardedRef, element);

				if (element) {
					return () => {
						container.current = null;
						if (typeof forwardedCleanup === 'function') {
							forwardedCleanup();
						} else {
							assignRef(forwardedRef, null);
						}
					};
				}

				return forwardedCleanup;
			},
			[forwardedRef]
		);
		const excerpt = React.useMemo(() => {
			if (passageExcerpt.length > 0) {
				return passageExcerpt.substring(0, excerptLength);
			}

			return (
				<span className="placeholder">
					{t(
						deviceType === 'touchOnly'
							? 'components.passageCard.placeholderTouch'
							: 'components.passageCard.placeholderClick'
					)}
				</span>
			);
		}, [passageExcerpt, t]);
		const style = React.useMemo(
			() => ({
				height: passage.height,
				left: passage.left,
				top: passage.top,
				width: passage.width
			}),
			[passage.height, passage.left, passage.top, passage.width]
		);
		const handleMouseDown = React.useCallback(
			(event: MouseEvent) => {
				// Shift- or control-clicking toggles our selected status, but doesn't
				// affect any other passage's selected status. If the shift or control key
				// was not held down and we were not already selected, we know the user
				// wants to select only this passage.

				if (event.shiftKey || event.ctrlKey) {
					if (passage.selected) {
						onDeselect(passage);
					} else {
						onSelect(passage, false);
					}
				} else if (!passage.selected) {
					onSelect(passage, true);
				}
			},
			[onDeselect, onSelect, passage]
		);
		const handleEdit = React.useCallback(
			() => onEdit(passage),
			[onEdit, passage]
		);
		const handleSelect = React.useCallback(
			(value: boolean, exclusive: boolean) => {
				onSelect(passage, exclusive);
			},
			[onSelect, passage]
		);

		return (
			<DraggableCore
				nodeRef={container}
				onMouseDown={handleMouseDown}
				onStart={onDragStart}
				onDrag={onDrag}
				onStop={onDragStop}
			>
				<div
					className={className}
					ref={setContainer}
					style={style}
					data-passage-tags={passage.tags.join(' ')}
				>
					<SelectableCard
						highlighted={passage.highlighted}
						label={passage.name}
						onDoubleClick={handleEdit}
						onSelect={handleSelect}
						selected={passage.selected}
					>
						{tagDisplay === 'color' && (
							<TagStripe tagColors={tagColors} tags={passage.tags} />
						)}
						<h2>{passage.name}</h2>
						<CardContent>{excerpt}</CardContent>
						{tagDisplay === 'name' && (
							<TagBadges tagColors={tagColors} tags={passage.tags} />
						)}
					</SelectableCard>
				</div>
			</DraggableCore>
		);
	})
);

PassageCard.displayName = 'PassageCard';
