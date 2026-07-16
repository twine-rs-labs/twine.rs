const urlScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const windowsDrivePath = /^[a-zA-Z]:\\/;

/**
 * Returns whether a string begins with an RFC 3986 URL scheme. Windows paths
 * using a backslash after the drive letter are treated as filesystem paths.
 */
export function hasUrlScheme(value: string) {
	return !windowsDrivePath.test(value) && urlScheme.test(value);
}
