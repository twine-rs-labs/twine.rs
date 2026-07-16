import * as React from 'react';
import {CSSTransition, TransitionGroup} from 'react-transition-group';
import {Passage} from '../../store/stories';
import {PassageCard, PassageCardProps} from './passage-card';
import '../../styles/animations.css';

export interface PassageCardGroupProps extends Omit<
	PassageCardProps,
	'passage'
> {
	passages: Passage[];
}

const TransitionedPassageCard: React.FC<PassageCardProps & {in?: boolean}> = ({
	in: inProp,
	...props
}) => {
	const nodeRef = React.useRef<HTMLDivElement>(null);

	return (
		<CSSTransition classNames="pop" in={inProp} nodeRef={nodeRef} timeout={200}>
			<PassageCard ref={nodeRef} {...props} />
		</CSSTransition>
	);
};

export const PassageCardGroup: React.FC<PassageCardGroupProps> = React.memo(
	props => {
		const {passages, ...cardProps} = props;

		// Passages must be sorted so that tabbing around follows a logical pattern.

		const sortedPassages = React.useMemo(
			() =>
				[...passages].sort((a, b) => {
					if (a.top !== b.top) {
						return a.top - b.top;
					}

					return a.left - b.left;
				}),
			[passages]
		);

		return (
			<TransitionGroup component={null}>
				{sortedPassages.map(passage => (
					<TransitionedPassageCard
						key={passage.id}
						passage={passage}
						{...cardProps}
					/>
				))}
			</TransitionGroup>
		);
	}
);

PassageCardGroup.displayName = 'PassageCardGroup';
