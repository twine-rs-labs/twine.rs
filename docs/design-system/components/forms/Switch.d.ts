import * as React from 'react';

/** On/off toggle for boolean settings. */
export interface SwitchProps {
	checked: boolean;
	onChange?: (checked: boolean) => void;
	/** Optional trailing label. */
	label?: string;
	disabled?: boolean;
	className?: string;
}

export declare function Switch(props: SwitchProps): React.JSX.Element;
