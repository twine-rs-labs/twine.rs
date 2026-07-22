import {version as appVersion} from '../../../../package.json';
import {dialog, shell} from 'electron';
import {checkForUpdate} from '../check-for-update';

jest.mock('electron');

describe('checkForUpdate()', () => {
	const checkUrl = 'mock-check-url';
	const originalFetchDescriptor = Object.getOwnPropertyDescriptor(
		globalThis,
		'fetch'
	);
	const fetchMock = jest.fn<
		ReturnType<typeof globalThis.fetch>,
		Parameters<typeof globalThis.fetch>
	>();
	const openExternalMock = shell.openExternal as jest.Mock;
	const showErrorBoxMock = dialog.showErrorBox as jest.Mock;
	const showMessageBoxMock = dialog.showMessageBox as jest.Mock;
	const responseWithJson = (value: unknown) =>
		({json: jest.fn().mockResolvedValue(value)}) as unknown as Response;

	beforeEach(() => {
		jest.spyOn(console, 'log').mockReturnValue();
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			value: fetchMock,
			writable: true
		});
		process.env.TWINE_RS_UPDATE_URL = checkUrl;
	});

	afterEach(() => {
		delete process.env.TWINE_RS_UPDATE_URL;

		if (originalFetchDescriptor) {
			Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
		} else {
			Reflect.deleteProperty(globalThis, 'fetch');
		}

		jest.restoreAllMocks();
	});

	describe('if no update URL is configured', () => {
		beforeEach(() => delete process.env.TWINE_RS_UPDATE_URL);

		it('shows a dialog saying that the user has the most current version', async () => {
			await checkForUpdate();
			expect(fetchMock).not.toHaveBeenCalled();
			expect(showMessageBoxMock.mock.calls).toEqual([
				[expect.objectContaining({message: 'electron.updateCheck.upToDate'})]
			]);
		});
	});

	describe('if the newest version is older than the current one', () => {
		beforeEach(() => {
			fetchMock.mockResolvedValue(
				responseWithJson({url: 'mock-url', version: '0.0.0'})
			);
		});

		it('shows a dialog saying that the user has the most current version', async () => {
			await checkForUpdate();
			expect(showMessageBoxMock.mock.calls).toEqual([
				[expect.objectContaining({message: 'electron.updateCheck.upToDate'})]
			]);
		});
	});

	describe('if the newest version is the same version as the current one', () => {
		beforeEach(() => {
			fetchMock.mockResolvedValue(
				responseWithJson({url: 'mock-url', version: appVersion})
			);
		});

		it('shows a dialog saying that the user has the most current version', async () => {
			await checkForUpdate();
			expect(showMessageBoxMock.mock.calls).toEqual([
				[expect.objectContaining({message: 'electron.updateCheck.upToDate'})]
			]);
		});
	});

	describe('if the newest version is newer than the current one', () => {
		beforeEach(() => {
			fetchMock.mockResolvedValue(
				responseWithJson({
					url: 'https://updates.example/download',
					version: '999.0.0'
				})
			);
		});

		it('shows a dialog saying a newer version is available', async () => {
			await checkForUpdate();
			expect(showMessageBoxMock.mock.calls).toEqual([
				[
					expect.objectContaining({
						buttons: ['electron.updateCheck.download', 'common.cancel'],
						defaultId: 0,
						icon: 'info',
						message: 'electron.updateCheck.updateAvailable'
					})
				]
			]);
		});

		it('opens the download URL if the user clicks the Download button', async () => {
			showMessageBoxMock.mockResolvedValue({response: 0});
			await checkForUpdate();
			expect(openExternalMock.mock.calls).toEqual([
				['https://updates.example/download']
			]);
		});

		it('takes no action if the user clicks Cancel', async () => {
			showMessageBoxMock.mockResolvedValue({response: 1});
			await checkForUpdate();
			expect(openExternalMock).not.toHaveBeenCalled();
		});

		it('rejects an unsafe download URL from the update response', async () => {
			fetchMock.mockResolvedValueOnce(
				responseWithJson({url: 'file:///tmp/update.pkg', version: '999.0.0'})
			);
			showMessageBoxMock.mockResolvedValue({response: 0});

			await checkForUpdate();

			expect(openExternalMock).not.toHaveBeenCalled();
			expect(showErrorBoxMock).toHaveBeenCalledWith(
				'electron.updateCheck.error',
				'Blocked unsafe external URL.'
			);
		});
	});

	describe('if the update check response is not JSON', () => {
		beforeEach(() => {
			fetchMock.mockResolvedValue({
				json: async () => {
					throw new Error('mock JSON error');
				}
			} as unknown as Response);
		});

		it('shows an error dialog', async () => {
			await checkForUpdate();
			expect(showErrorBoxMock.mock.calls).toEqual([
				['electron.updateCheck.error', 'mock JSON error']
			]);
		});
	});

	describe('if the update check response has no version property', () => {
		beforeEach(() => {
			fetchMock.mockResolvedValue(responseWithJson({}));
		});

		it('shows an error dialog', async () => {
			await checkForUpdate();
			expect(showErrorBoxMock.mock.calls).toEqual([
				[
					'electron.updateCheck.error',
					'Invalid version. Must be a string. Got type "undefined".'
				]
			]);
		});
	});

	describe('if there is an error retrieving the newest version', () => {
		beforeEach(() => {
			fetchMock.mockRejectedValue(new Error('mock error'));
		});

		it('shows an error dialog', async () => {
			await checkForUpdate();
			expect(showErrorBoxMock.mock.calls).toEqual([
				['electron.updateCheck.error', 'mock error']
			]);
		});
	});

	describe('if the native fetch is aborted', () => {
		beforeEach(() => {
			fetchMock.mockRejectedValue(
				new DOMException('This operation was aborted', 'AbortError')
			);
		});

		it('shows an error dialog with the abort reason', async () => {
			await checkForUpdate();
			expect(showErrorBoxMock.mock.calls).toEqual([
				['electron.updateCheck.error', 'This operation was aborted']
			]);
		});
	});
});
