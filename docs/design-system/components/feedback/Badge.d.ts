import * as React from 'react';

export type BadgeTone =
	| 'neutral'
	| 'link'
	| 'tag'
	| 'var'
	| 'warn'
	| 'error'
	| 'dirty'
	| 'saved'
	| 'generated'
	| 'build';

/**
 * Small status / count pill. Tones map to the semantic role colors, so a
 * "3 broken links" badge reads error-red while "Saved Layout" reads green.
 */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
	children?: React.ReactNode;
	/** Semantic tone. @default "neutral" */
	tone?: BadgeTone;
	/** Leading Tabler icon name (without `ti-`). */
	icon?: string;
	/** Show a leading status dot instead of an icon. @default false */
	dot?: boolean;
	/** Monospace text (counts, IDs). @default false */
	mono?: boolean;
}

export declare function Badge(props: BadgeProps): React.JSX.Element;
