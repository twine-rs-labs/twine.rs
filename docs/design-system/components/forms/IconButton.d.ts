import * as React from 'react';

/**
 * Icon-only button for repeated toolbar tools. Always provide `label`
 * (used as the accessible name and the tooltip). Use sparingly — the
 * design system prefers text-labelled buttons for clarity.
 */
export interface IconButtonProps
	extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
	/** Tabler icon name (without the `ti-` prefix). */
	icon: string;
	/** Accessible name + tooltip text. Required. */
	label: string;
	/** Toggle / selected state. @default false */
	active?: boolean;
	/** Render as a filled raised control rather than a flat one. @default false */
	solid?: boolean;
	/** @default "md" */
	size?: 'sm' | 'md';
	disabled?: boolean;
}

export declare function IconButton(props: IconButtonProps): React.JSX.Element;
