import * as React from 'react';

export interface SelectOption {
	value: string;
	label: string;
}

/** Native dropdown select styled for the workbench. */
export interface SelectProps {
	options: Array<string | SelectOption>;
	value: string;
	onChange?: (value: string) => void;
	/** @default "md" */
	size?: 'sm' | 'md';
	block?: boolean;
	disabled?: boolean;
	className?: string;
}

export declare function Select(props: SelectProps): React.JSX.Element;
