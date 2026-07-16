import * as React from 'react';
import classnames from 'classnames';
import {CSSTransition, TransitionGroup} from 'react-transition-group';
import {useDialogsContext} from '.';
import {usePrefsContext} from '../../store/prefs';
import {useScrollbarSize} from '../../util/use-scrollbar-size';
import './dialogs.css';

// TODO move this to separate module to avoid circular dep
interface DialogTransitionProps {
	children?: React.ReactNode;
	collapsed: boolean;
	in?: boolean;
	maximized: boolean;
	style?: React.CSSProperties;
}

const DialogTransition: React.FC<DialogTransitionProps> = ({
	children,
	collapsed,
	in: inProp,
	maximized,
	style
}) => {
	const nodeRef = React.useRef<HTMLDivElement>(null);
	const [fixedSize, setFixedSize] = React.useState(false);

	React.useLayoutEffect(() => {
		setFixedSize(
			nodeRef.current?.firstElementChild?.classList.contains('fixed-size') ??
				false
		);
	}, [children]);

	return (
		<CSSTransition classNames="pop" in={inProp} nodeRef={nodeRef} timeout={200}>
			<div
				className={classnames('dialog-transition-shell', {
					collapsed,
					'fixed-size': fixedSize,
					maximized
				})}
				ref={nodeRef}
				style={style}
			>
				{children}
			</div>
		</CSSTransition>
	);
};

export const Dialogs: React.FC = () => {
	const {height, width} = useScrollbarSize();
	const {prefs} = usePrefsContext();
	const {dispatch, dialogs} = useDialogsContext();

	const hasUnmaximized = dialogs.some(dialog => !dialog.maximized);
	const containerStyle: React.CSSProperties = {
		paddingLeft: `calc(100% - (${prefs.dialogWidth}px + 2 * (var(--grid-size))))`,
		marginBottom: height,
		marginRight: width
	};
	const maximizedStyle: React.CSSProperties = {
		marginRight: hasUnmaximized
			? `calc(${prefs.dialogWidth}px + var(--grid-size))`
			: 0
	};

	return (
		<div className="dialogs" style={containerStyle}>
			<TransitionGroup component={null}>
				{dialogs.map((dialog, index) => {
					const managementProps = {
						collapsed: dialog.collapsed,
						highlighted: dialog.highlighted,
						maximized: dialog.maximized,
						onChangeCollapsed: (collapsed: boolean) =>
							dispatch({type: 'setDialogCollapsed', collapsed, index}),
						onChangeHighlighted: (highlighted: boolean) =>
							dispatch({type: 'setDialogHighlighted', highlighted, index}),
						onChangeMaximized: (maximized: boolean) =>
							dispatch({type: 'setDialogMaximized', maximized, index}),
						onChangeProps: (props: Record<string, any>) =>
							dispatch({type: 'setDialogProps', index, props}),
						onClose: () => dispatch({type: 'removeDialog', index})
					};

					return (
						<DialogTransition
							collapsed={dialog.collapsed}
							key={index}
							maximized={dialog.maximized}
							style={dialog.maximized ? maximizedStyle : undefined}
						>
							<dialog.component {...dialog.props} {...managementProps} />
						</DialogTransition>
					);
				})}
			</TransitionGroup>
		</div>
	);
};
