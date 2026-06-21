import * as React from 'react';

export interface SegmentOption {
	value: string;
	label: string;
	/** Tabler icon name (without `ti-`). */
	icon?: string;
}

/**
 * Segmented control — twine.rs uses it for the Text | Graph | Split mode
 * switch and for density toggles. The active segment gets the twine
 * gradient underline.
 *
 * @startingPoint section="Forms" subtitle="Mode switch / segmented control" viewport="700x90"
 */
export interface SegmentedControlProps {
	/** Options as plain strings or `{value,label,icon}`. */
	options: Array<string | SegmentOption>;
	/** Selected value. */
	value: string;
	/** Called with the newly selected value. */
	onChange?: (value: string) => void;
	/** @default "md" */
	size?: 'sm' | 'md';
	className?: string;
}

export declare function SegmentedControl(
	props: SegmentedControlProps
): React.JSX.Element;
