import {shell} from 'electron';
import {openExternalUrl, validatedExternalUrl} from '../external-url';

jest.mock('electron');

describe('external URLs', () => {
	const openExternalMock = shell.openExternal as jest.Mock;

	it('opens credential-free HTTPS URLs', async () => {
		await openExternalUrl('https://example.com/download?platform=desktop');

		expect(openExternalMock).toHaveBeenCalledWith(
			'https://example.com/download?platform=desktop'
		);
	});

	it.each([
		'file:///tmp/story.html',
		'data:text/html,test',
		'javascript:alert(1)',
		'mailto:person@example.com',
		'custom-handler://open',
		'https://user:secret@example.com/download',
		'not a URL'
	])('rejects unsafe external URL %s', async url => {
		expect(() => validatedExternalUrl(url)).toThrow(/Blocked/);
		await expect(openExternalUrl(url)).rejects.toThrow(/Blocked/);
		expect(openExternalMock).not.toHaveBeenCalled();
	});
});
