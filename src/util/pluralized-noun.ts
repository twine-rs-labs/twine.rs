/** Returns the noun form that agrees with a numeric count. */
export function pluralizedNoun(
	count: number,
	singular: string,
	plural = `${singular}s`
) {
	return count === 1 ? singular : plural;
}
