import {pathToFileURL} from 'url';
import path from 'path';
import {
	assertPreviewIpcEvent,
	previewIpcRegistrar,
	previewRendererEntryUrl
} from '../preview-ipc-security';
import {assertTrustedIpcEvent} from '../ipc-security';

function eventFor(url: string, subframe = false) {
	const mainFrame = {url};
	const senderFrame = subframe ? {url} : mainFrame;

	return {
		sender: {mainFrame},
		senderFrame
	};
}

describe('preview IPC security', () => {
	it('admits only the exact top-level packaged preview entry', () => {
		expect(() =>
			assertPreviewIpcEvent(eventFor(previewRendererEntryUrl()))
		).not.toThrow();
		expect(() =>
			assertPreviewIpcEvent(eventFor(`${previewRendererEntryUrl()}#runtime`))
		).not.toThrow();
		expect(() =>
			assertPreviewIpcEvent(
				eventFor(`${previewRendererEntryUrl()}?session=other`)
			)
		).toThrow('untrusted renderer origin');
		expect(() =>
			assertPreviewIpcEvent(eventFor(previewRendererEntryUrl(), true))
		).toThrow('untrusted renderer frame');
	});

	it('does not make the preview entry trusted by general application IPC', () => {
		expect(() =>
			assertTrustedIpcEvent(eventFor(previewRendererEntryUrl()))
		).toThrow('untrusted renderer origin');
	});

	it('wraps both invoke and event endpoints with the same exact gate', () => {
		const raw = {handle: jest.fn(), on: jest.fn()};
		const registrar = previewIpcRegistrar(raw);
		const handled = jest.fn().mockReturnValue('state');
		const listened = jest.fn();

		registrar.handle('preview-state', handled);
		registrar.on('preview-ready', listened);
		const invoke = raw.handle.mock.calls[0][1];
		const notify = raw.on.mock.calls[0][1];

		expect(invoke(eventFor(previewRendererEntryUrl()), 'argument')).toBe(
			'state'
		);
		expect(handled).toHaveBeenCalledWith(
			expect.objectContaining({sender: expect.any(Object)}),
			'argument'
		);
		expect(() =>
			notify(
				eventFor(
					pathToFileURL(
						path.resolve(__dirname, '../../../../../renderer/index.html')
					).toString()
				)
			)
		).toThrow('untrusted renderer origin');
		expect(listened).not.toHaveBeenCalled();
	});
});
