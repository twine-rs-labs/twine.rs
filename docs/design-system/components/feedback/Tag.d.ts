import * as React from 'react';

export type TagColor =
	| 'red' | 'orange' | 'yellow' | 'green'
	| 'teal' | 'cyan' | 'blue' | 'purple';

/** Passage/story tag chip with a color dot and optional remove button. */
export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
	children?: React.ReactNode;
	/** Named hue or any CSS color for the dot. @default "blue" */
	color?: TagColor | string;
	/** Show the leading `#`. @default true */
	hash?: boolean;
	/** Renders a remove (×) button and calls this when clicked. */
	onRemove?: () => void;
	onClick?: (e: React.MouseEvent) => void;
}

export declare function Tag(props: TagProps): React.JSX.Element;
