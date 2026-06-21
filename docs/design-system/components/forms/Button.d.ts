import * as React from 'react';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * twine.rs action button. Text-labelled commands (Import, Export HTML,
 * Save Layout, Publish). Use `primary` for the single decisive action in
 * a context; `default` for neutral commands; `ghost` for low-emphasis
 * toolbar actions; `danger` for destructive ones.
 *
 * @startingPoint section="Forms" subtitle="Button variants & sizes" viewport="700x120"
 */
export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	/** Button label. */
	children?: React.ReactNode;
	/** Visual emphasis. @default "default" */
	variant?: ButtonVariant;
	/** Control height. @default "md" */
	size?: ButtonSize;
	/** Tabler icon name (without the `ti-` prefix) shown before the label. */
	icon?: string;
	/** Tabler icon name shown after the label. */
	iconRight?: string;
	/** Show a spinner and disable interaction. @default false */
	loading?: boolean;
	/** Stretch to fill the container width. @default false */
	block?: boolean;
	disabled?: boolean;
}

export declare function Button(props: ButtonProps): React.JSX.Element;
