import {posix, win32} from 'path';

type FilesystemPathApi = Pick<
	typeof posix,
	'isAbsolute' | 'relative' | 'resolve' | 'sep' | 'toNamespacedPath'
>;

export interface FilesystemPathComparer {
	contains(parentPath: string, childPath: string): boolean;
	key(filePath: string): string;
	relative(fromPath: string, toPath: string): string;
}

export function createFilesystemPathComparer(
	pathApi: FilesystemPathApi,
	options: {
		caseInsensitive?: boolean;
		namespaced?: boolean;
	} = {}
): FilesystemPathComparer {
	const comparisonPath = (filePath: string) => {
		const resolvedPath = pathApi.resolve(filePath);

		return options.namespaced
			? pathApi.toNamespacedPath(resolvedPath)
			: resolvedPath;
	};
	const relativePath = (fromPath: string, toPath: string) =>
		pathApi.relative(comparisonPath(fromPath), comparisonPath(toPath));

	return {
		contains(parentPath, childPath) {
			const childRelativePath = relativePath(parentPath, childPath);

			return (
				childRelativePath === '' ||
				(childRelativePath !== '..' &&
					!childRelativePath.startsWith(`..${pathApi.sep}`) &&
					!pathApi.isAbsolute(childRelativePath))
			);
		},
		key(filePath) {
			const key = comparisonPath(filePath);

			return options.caseInsensitive ? key.toLowerCase() : key;
		},
		relative: relativePath
	};
}

const windows = process.platform === 'win32';

export const filesystemPathComparer = createFilesystemPathComparer(
	windows ? win32 : posix,
	{
		caseInsensitive: windows,
		namespaced: windows
	}
);
