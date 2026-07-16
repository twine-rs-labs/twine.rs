import * as React from 'react';

interface CSSTransitionProps {
	children?: React.ReactNode;
	in?: boolean;
	nodeRef?: React.RefObject<HTMLElement | null>;
}

export const CSSTransition: React.FC<CSSTransitionProps> = props => (
	<>{props.in && props.children}</>
);

// Force children in.

export const TransitionGroup: React.FC<React.PropsWithChildren> = ({
	children
}) => (
	<>
		{React.Children.map(children, child => {
			const childNode = child as React.ReactElement<{in?: boolean}>;

			return React.cloneElement(childNode, {in: true});
		})}
	</>
);
