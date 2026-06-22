export type DesignSystemHue =
	| 'red'
	| 'orange'
	| 'yellow'
	| 'green'
	| 'teal'
	| 'cyan'
	| 'blue'
	| 'purple';

export const hueToToken: Record<DesignSystemHue, string> = {
	red: 'var(--sem-error)',
	orange: 'var(--sem-dirty)',
	yellow: 'var(--sem-warn)',
	green: 'var(--sem-saved)',
	teal: 'var(--sem-generated)',
	cyan: 'var(--sem-var)',
	blue: 'var(--sem-link)',
	purple: 'var(--sem-tag)'
};

export function colorToCss(color: string) {
	return hueToToken[color as DesignSystemHue] ?? color;
}
