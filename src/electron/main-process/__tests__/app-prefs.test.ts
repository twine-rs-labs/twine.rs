import minimist from 'minimist';
import {getAppPref, loadAppPrefs, setAppPref} from '../app-prefs';
import {loadJsonFileSync, saveJsonFile} from '../json-file';

jest.mock('minimist');
jest.mock('../json-file');

beforeEach(() => {
	jest.spyOn(console, 'log').mockReturnValue();
	jest.spyOn(console, 'warn').mockReturnValue();
});

const loadJsonFileSyncMock = loadJsonFileSync as jest.Mock;
const saveJsonFileMock = saveJsonFile as jest.Mock;
const minimistMock = minimist as jest.Mock;

function mockJsonFile(value: any) {
	loadJsonFileSyncMock.mockImplementation((name: string) => {
		if (name === 'app-prefs.json') {
			return value;
		}

		throw new Error(`Loaded incorrect file "${name}"`);
	});
}

describe('loadAppPrefs and getAppPrefs', () => {
	beforeEach(() => {
		mockJsonFile({});
		minimistMock.mockReturnValue({});
	});

	it('loads prefs from command line arguments', () => {
		minimistMock.mockReturnValue({
			scratchFolderPath: 'mock-scratch-folder-path'
		});
		loadAppPrefs();
		expect(getAppPref('scratchFolderPath')).toBe('mock-scratch-folder-path');
	});

	it('loads prefs from the app prefs file', () => {
		mockJsonFile({scratchFolderPath: 'mock-scratch-folder-path'});
		loadAppPrefs();
		expect(getAppPref('scratchFolderPath')).toBe('mock-scratch-folder-path');
	});

	it('prefers command line arguments to values set in the app prefs file', () => {
		mockJsonFile({scratchFolderPath: 'json-path'});
		minimistMock.mockReturnValue({
			scratchFolderPath: 'args-path'
		});
		loadAppPrefs();
		expect(getAppPref('scratchFolderPath')).toBe('args-path');
	});

	it('does not persist a command-line override during an unrelated write', async () => {
		mockJsonFile({
			backupCadenceMinutes: 20,
			scratchFolderPath: 'json-path'
		});
		minimistMock.mockReturnValue({scratchFolderPath: 'args-path'});
		loadAppPrefs();

		expect(getAppPref('scratchFolderPath')).toBe('args-path');
		await setAppPref('backupCadenceMinutes', 30);

		expect(saveJsonFileMock).toHaveBeenLastCalledWith('app-prefs.json', {
			backupCadenceMinutes: 30,
			scratchFolderPath: 'json-path'
		});
		expect(getAppPref('scratchFolderPath')).toBe('args-path');
	});

	it('persists an explicitly updated command-line overridden key', async () => {
		mockJsonFile({scratchFolderPath: 'json-path'});
		minimistMock.mockReturnValue({scratchFolderPath: 'args-path'});
		loadAppPrefs();

		await setAppPref('scratchFolderPath', 'explicit-path');

		expect(getAppPref('scratchFolderPath')).toBe('explicit-path');
		expect(saveJsonFileMock).toHaveBeenLastCalledWith('app-prefs.json', {
			scratchFolderPath: 'explicit-path'
		});
	});

	it('ignores CLI-shaped values for prefs absent from the option schema', () => {
		mockJsonFile({backupReminderDays: 7});
		minimistMock.mockReturnValue({backupReminderDays: 30});
		loadAppPrefs();

		expect(getAppPref('backupReminderDays')).toBe(7);
	});

	it("ignores values in the app prefs file that aren't known prefs", () => {
		mockJsonFile({anUnrecognizedKey: 'fail'});
		loadAppPrefs();
		expect(getAppPref('anUnrecognizedKey' as any)).toBeUndefined();
	});

	it("ignores values in command line arguments that aren't known prefs", () => {
		minimistMock.mockReturnValue({anUnrecognizedKey: 'fail'});
		loadAppPrefs();
		expect(getAppPref('anUnrecognizedKey' as any)).toBeUndefined();
	});

	it('ignores the retired scratch asset strategy from files and arguments', () => {
		mockJsonFile({scratchAssetStrategy: 'link'});
		minimistMock.mockReturnValue({scratchAssetStrategy: 'copy'});
		loadAppPrefs();

		expect(getAppPref('scratchAssetStrategy' as any)).toBeUndefined();
	});

	it('silently treats a missing app prefs file as absent', () => {
		minimistMock.mockReturnValue({
			scratchFolderPath: 'mock-scratch-folder-path'
		});
		loadJsonFileSyncMock.mockImplementation(() => {
			throw Object.assign(new Error('missing'), {code: 'ENOENT'});
		});
		loadAppPrefs();
		expect(getAppPref('scratchFolderPath')).toBe('mock-scratch-folder-path');
		expect(console.warn).not.toHaveBeenCalled();
	});

	it('warns if the app prefs file could not be loaded for another reason', () => {
		const error = Object.assign(new Error('permission denied'), {
			code: 'EACCES'
		});
		loadJsonFileSyncMock.mockImplementation(() => {
			throw error;
		});

		loadAppPrefs();

		expect(console.warn).toHaveBeenCalledWith(
			"Couldn't read app prefs file; continuing",
			error
		);
	});
});

describe('getAppPref', () => {
	// Because this is stored in the module itself, unclear how to test this.
	it.todo('throws an error if it was called before prefs were loaded');
});

describe('setAppPref', () => {
	beforeEach(() => {
		mockJsonFile({});
		minimistMock.mockReturnValue({scratchFolderPath: 'pre-existing'});
	});

	it('resolves after setting a pref', async () => {
		loadAppPrefs();
		await setAppPref('scratchFolderPath', 'mock-change');
		expect(getAppPref('scratchFolderPath')).toBe('mock-change');
	});

	it('resolves after saving changes to the app prefs file', async () => {
		loadAppPrefs();
		expect(saveJsonFileMock).not.toHaveBeenCalled();
		await setAppPref('scratchFolderPath', 'mock-change');
		expect(saveJsonFileMock.mock.calls).toEqual([
			['app-prefs.json', {scratchFolderPath: 'mock-change'}]
		]);
	});

	it('rejects if saving changes fails', async () => {
		saveJsonFileMock.mockRejectedValue(new Error());
		loadAppPrefs();
		await expect(() =>
			setAppPref('scratchFolderPath', 'mock-value')
		).rejects.toBeInstanceOf(Error);
	});

	// Because this is stored in the module itself, unclear how to test this.
	it.todo('rejects if it was called before prefs were loaded');
});
