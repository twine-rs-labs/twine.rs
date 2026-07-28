import {win32} from 'path';
import {createFilesystemPathComparer} from '../filesystem-path-comparer';

describe('filesystem path comparer', () => {
	it('treats Windows extended-length paths as aliases of regular paths', () => {
		const comparer = createFilesystemPathComparer(win32, {
			caseInsensitive: true,
			namespaced: true
		});
		const libraryPath = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\library';
		const projectPath = win32.join(
			libraryPath,
			'Projects',
			'moon-castle.twine.rs'
		);
		const extendedProjectPath = win32.toNamespacedPath(projectPath);

		expect(comparer.contains(libraryPath, extendedProjectPath)).toBe(true);
		expect(comparer.relative(libraryPath, extendedProjectPath)).toBe(
			'Projects\\moon-castle.twine.rs'
		);
		expect(comparer.key(projectPath)).toBe(comparer.key(extendedProjectPath));
	});

	it('normalizes Windows UNC namespaces without matching sibling paths', () => {
		const comparer = createFilesystemPathComparer(win32, {
			caseInsensitive: true,
			namespaced: true
		});
		const libraryPath = '\\\\server\\share\\Twine';
		const projectPath = '\\\\?\\UNC\\server\\share\\Twine\\Projects\\Story';
		const siblingPath = '\\\\?\\UNC\\server\\share\\Twine-Archive\\Story';

		expect(comparer.contains(libraryPath, projectPath)).toBe(true);
		expect(comparer.contains(libraryPath, siblingPath)).toBe(false);
		expect(comparer.key('C:\\TWINE\\Story')).toBe(
			comparer.key('\\\\?\\c:\\twine\\story')
		);
	});
});
