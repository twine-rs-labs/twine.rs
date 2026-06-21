import * as React from 'react';

/**
 * Single-line text input. Optional leading Tabler icon, a label above,
 * and a trailing keyboard-hint chip (e.g. a search field's shortcut).
 */
export interface InputProps
	extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
	/** Label rendered above the field. */
	label?: string;
	/** Leading Tabler icon name (without `ti-`). */
	icon?: string;
	/** Trailing keyboard-hint chip, e.g. "⌘K". */
	kbd?: string;
	/** Error styling. @default false */
	invalid?: boolean;
	/** Monospace value (paths, IDs). @default false */
	mono?: boolean;
	/** Fill container width. @default false */
	block?: boolean;
	disabled?: boolean;
}

export declare function Input(props: InputProps): React.JSX.Element;
