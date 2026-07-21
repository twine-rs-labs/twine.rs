import {pathToFileURL} from 'url';
import path from 'path';
import {assertTrustedIpcEvent, trustedIpcRegistrar} from '../ipc-security';

function trustedUrl() {
	return pathToFileURL(
		path.resolve(__dirname, '../../../../../renderer/index.html')
	).toString();
}

function eventFor(url: string, subframe = false) {
	const mainFrame = {url};

	return {
		sender: {mainFrame},
		senderFrame: subframe ? {url} : mainFrame
	};
}

describe('Electron IPC trust boundary', () => {
	it('accepts only the bundled top-level renderer', () => {
		expect(() => assertTrustedIpcEvent(eventFor(trustedUrl()))).not.toThrow();
		expect(() =>
			assertTrustedIpcEvent(eventFor(`${trustedUrl()}#/stories/story-1`))
		).not.toThrow();
		expect(() =>
			assertTrustedIpcEvent(eventFor('https://attacker.example/'))
		).toThrow('untrusted renderer origin');
		expect(() =>
			assertTrustedIpcEvent(
				eventFor(trustedUrl().replace('index.html', 'index2.html'))
			)
		).toThrow('untrusted renderer origin');
		expect(() => assertTrustedIpcEvent(eventFor(trustedUrl(), true))).toThrow(
			'untrusted renderer frame'
		);
	});

	it('checks invoke and send listeners before calling application code', async () => {
		const raw = {handle: jest.fn(), on: jest.fn()};
		const secure = trustedIpcRegistrar(raw);
		const invoked = jest.fn();
		const sent = jest.fn();

		secure.handle('invoke', invoked);
		secure.on('send', sent);
		const invokeListener = raw.handle.mock.calls[0][1];
		const sendListener = raw.on.mock.calls[0][1];

		expect(() => invokeListener(eventFor('https://attacker.example/'))).toThrow(
			'untrusted renderer origin'
		);
		expect(() => sendListener(eventFor('https://attacker.example/'))).toThrow(
			'untrusted renderer origin'
		);
		expect(invoked).not.toHaveBeenCalled();
		expect(sent).not.toHaveBeenCalled();
	});
});
