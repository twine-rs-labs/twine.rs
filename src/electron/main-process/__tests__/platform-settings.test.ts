import {getAppPref, setAppPref} from '../app-prefs';
import {
	backupCadenceMs,
	nativeAppPlatformSettings,
	updateNativeAppPlatformSettings
} from '../platform-settings';

jest.mock('../app-prefs');

describe('platform settings', () => {
	const getAppPrefMock = getAppPref as jest.Mock;
	const setAppPrefMock = setAppPref as jest.Mock;

	beforeEach(() => {
		getAppPrefMock.mockReturnValue(undefined);
		setAppPrefMock.mockResolvedValue(undefined);
	});

	it('returns normalized defaults for unset app prefs', () => {
		expect(nativeAppPlatformSettings()).toEqual({
			backupCadenceMinutes: 20,
			backupLastReviewedTime: 0,
			backupReminderDays: 7,
			backupRetentionLimit: 10,
			cacheCleanupDays: 3,
			externalEditorCommand: '',
			fullscreenPersistence: true,
			lastWindowFullscreen: false,
			linkHandlingMode: 'system'
		});
		expect(backupCadenceMs()).toBe(20 * 60 * 1000);
	});

	it('coerces persisted or CLI values into safe platform settings', () => {
		getAppPrefMock.mockImplementation(name => {
			switch (name) {
				case 'backupCadenceMinutes':
					return '30';
				case 'backupRetentionLimit':
					return '0';
				case 'backupReminderDays':
					return 999;
				case 'scratchFileCleanupAge':
					return 60 * 24 * 14;
				case 'fullscreenPersistence':
					return 'false';
				case 'lastWindowFullscreen':
					return true;
				case 'linkHandlingMode':
					return 'block';
				case 'externalEditorCommand':
					return 'code --wait';
				default:
					return undefined;
			}
		});

		expect(nativeAppPlatformSettings()).toEqual(
			expect.objectContaining({
				backupCadenceMinutes: 30,
				backupReminderDays: 365,
				backupRetentionLimit: 1,
				cacheCleanupDays: 14,
				externalEditorCommand: 'code --wait',
				fullscreenPersistence: false,
				lastWindowFullscreen: true,
				linkHandlingMode: 'block'
			})
		);
	});

	it('persists updates through app prefs', async () => {
		await updateNativeAppPlatformSettings({
			backupCadenceMinutes: 2,
			cacheCleanupDays: 7,
			externalEditorCommand: ' code --wait ',
			linkHandlingMode: 'block'
		});

		expect(setAppPrefMock).toHaveBeenCalledWith('backupCadenceMinutes', 5);
		expect(setAppPrefMock).toHaveBeenCalledWith(
			'scratchFileCleanupAge',
			7 * 24 * 60
		);
		expect(setAppPrefMock).toHaveBeenCalledWith(
			'externalEditorCommand',
			'code --wait'
		);
		expect(setAppPrefMock).toHaveBeenCalledWith('linkHandlingMode', 'block');
		expect(setAppPrefMock).not.toHaveBeenCalledWith(
			'scratchAssetStrategy',
			expect.anything()
		);
	});
});
