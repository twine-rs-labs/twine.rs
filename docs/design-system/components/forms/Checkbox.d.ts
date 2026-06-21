import * as React from 'react';

/** Checkbox with checked and indeterminate (mixed) states. */
export interface CheckboxProps {
	checked: boolean;
	/** Render the mixed state (e.g. partial bulk selection). @default false */
	indeterminate?: boolean;
	onChange?: (checked: boolean) => void;
	label?: string;
	disabled?: boolean;
	className?: string;
}

export declare function Checkbox(props: CheckboxProps): React.JSX.Element;
