import {readFile} from 'fs-extra';
import {getUserCss} from '../user-css';

jest.mock('fs-extra');

describe('getUserCss', () => {
	const readFileMock = readFile as jest.Mock;

	it("returns the contents of user.css in the user's Twine directory", async () => {
		readFileMock.mockReturnValue('mock-css');

		expect(await getUserCss()).toBe('mock-css');
		expect(readFileMock.mock.calls).toEqual([
			[
				'mock-electron-app-path-documents/mock-electron-app-name/electron.userCss.filename',
				'utf8'
			]
		]);
	});

	it('silently returns undefined if user.css is missing', async () => {
		const warnSpy = jest
			.spyOn(global.console, 'warn')
			.mockImplementation(() => {});

		readFileMock.mockRejectedValue(
			Object.assign(new Error('missing'), {code: 'ENOENT'})
		);

		expect(await getUserCss()).toBeUndefined();
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('warns and returns undefined if user.css could not be read for another reason', async () => {
		const warnSpy = jest
			.spyOn(global.console, 'warn')
			.mockImplementation(() => {});

		readFileMock.mockRejectedValue(
			Object.assign(new Error('permission denied'), {code: 'EACCES'})
		);

		expect(await getUserCss()).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledWith(
			'Error while loading user CSS, skipping: permission denied'
		);
	});
});
