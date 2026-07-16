import * as React from 'react';
import {CSSTransition} from 'react-transition-group';
import {Placement} from '@popperjs/core';
import {usePopper, UsePopperOptions} from '../../util/use-popper';
import './tooltip.css';

export interface TooltipProps {
	anchor: HTMLElement | null;
	label: string;
	position?: Placement;
}

// This component is intentionally limited in functionality. It should *only* be
// used to duplicate content that is only perceivable by screen readers or other
// assistive technology, e.g. through an `aria-label` attribute. The one use
// case right now in the app are icon-only buttons.
//
// Content in these components is *not* accessible to screen readers and should
// not be. That content should be placed in an `aria-label` attribute instead.

export const Tooltip: React.FC<TooltipProps> = props => {
	const {anchor, label, position = 'top'} = props;
	const [tooltipEl, setTooltipEl] = React.useState<HTMLDivElement | null>(null);
	const [arrowEl, setArrowEl] = React.useState<HTMLDivElement | null>(null);
	const tooltipRef = React.useRef<HTMLDivElement | null>(null);
	const [visible, setVisible] = React.useState(false);
	const appearTimeout = React.useRef<number | undefined>(undefined);
	const popperOptions = React.useMemo<UsePopperOptions>(
		() => ({
			modifiers: [{name: 'arrow', options: {element: arrowEl}}, {name: 'flip'}],
			placement: position,
			strategy: 'fixed'
		}),
		[arrowEl, position]
	);
	const setTooltip = React.useCallback((element: HTMLDivElement | null) => {
		tooltipRef.current = element;
		setTooltipEl(element);
	}, []);
	const {styles, attributes} = usePopper(anchor, tooltipEl, popperOptions);

	React.useEffect(() => {
		const handleOnEnter = () => {
			window.clearTimeout(appearTimeout.current);
			appearTimeout.current = window.setTimeout(() => setVisible(true), 500);
		};
		const handleOnLeave = () => {
			window.clearTimeout(appearTimeout.current);
			setVisible(false);
		};

		if (anchor) {
			anchor.addEventListener('pointerenter', handleOnEnter);
			anchor.addEventListener('pointerleave', handleOnLeave);
			anchor.addEventListener('focus', handleOnEnter);
			anchor.addEventListener('blur', handleOnLeave);
			return () => {
				window.clearTimeout(appearTimeout.current);
				anchor.removeEventListener('pointerenter', handleOnEnter);
				anchor.removeEventListener('pointerleave', handleOnLeave);
				anchor.removeEventListener('focus', handleOnEnter);
				anchor.removeEventListener('blur', handleOnLeave);
			};
		}
	}, [anchor]);

	return (
		<CSSTransition
			classNames="fade-in-out"
			in={visible}
			mountOnEnter
			nodeRef={tooltipRef}
			timeout={200}
			unmountOnExit
		>
			<div
				aria-hidden
				className="tooltip"
				ref={setTooltip}
				role="tooltip"
				style={styles.popper}
				{...attributes.popper}
			>
				<div className="tooltip-arrow" ref={setArrowEl} style={styles.arrow} />
				<div className="tooltip-label">{label}</div>
			</div>
		</CSSTransition>
	);
};
