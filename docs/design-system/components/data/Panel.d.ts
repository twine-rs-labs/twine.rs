import * as React from 'react';

/**
 * A dock / inspector panel — an uppercase titled header (optional icon,
 * count and action slot) over a scrolling body. The structural building
 * block for twine.rs docks and drawers.
 */
export interface PanelProps extends React.HTMLAttributes<HTMLElement> {
	/** Header title (rendered uppercase). */
	title?: string;
	/** Leading Tabler icon name (without `ti-`). */
	icon?: string;
	/** Count shown next to the title. */
	count?: number | string;
	/** Right-aligned header controls (e.g. IconButtons). */
	actions?: React.ReactNode;
	/** Pad the body. @default false */
	pad?: boolean;
	/** Remove border + radius (for full-bleed docks). @default false */
	flush?: boolean;
	bodyClassName?: string;
	children?: React.ReactNode;
}

export declare function Panel(props: PanelProps): React.JSX.Element;
