import * as React from 'react';

/**
 * A passage card as it appears in Graph mode — title, optional excerpt,
 * tag color strips, outgoing-link count and broken-link badge. The start
 * passage gets the twine gradient accent rail.
 *
 * @startingPoint section="Data" subtitle="Graph passage card" viewport="700x180"
 */
export interface PassageNodeProps
	extends React.HTMLAttributes<HTMLDivElement> {
	title: string;
	/** Short body excerpt (clamped to 2 lines). */
	excerpt?: string;
	/** Tag colors (named hue or CSS color) shown as strips. */
	tags?: string[];
	/** Outgoing link count. @default 0 */
	links?: number;
	/** Broken link count; shows a red badge when > 0. @default 0 */
	broken?: number;
	/** Marks this as the start passage. @default false */
	start?: boolean;
	/** Selected state (graph selection). @default false */
	selected?: boolean;
	/** Top accent bar color (named hue or CSS color). */
	accent?: string;
}

export declare function PassageNode(props: PassageNodeProps): React.JSX.Element;
