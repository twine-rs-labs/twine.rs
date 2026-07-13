import {
	registerPerformanceEditorOwner,
	rendererMemoryOwnerSnapshot,
	unregisterPerformanceEditorOwner,
	updatePerformanceEditorOwner
} from '../performance-memory-owners';

describe('renderer memory owners', () => {
	beforeEach(() => {
		(window as any).twinePerformanceNative = {};
		unregisterPerformanceEditorOwner('one');
		unregisterPerformanceEditorOwner('two');
	});

	afterEach(() => {
		delete (window as any).twinePerformanceNative;
	});

	it('tracks and releases active editor document capacity', () => {
		registerPerformanceEditorOwner('one', 'abc');
		registerPerformanceEditorOwner('two', 'de');

		expect(rendererMemoryOwnerSnapshot()).toEqual({
			activeEditorCount: 2,
			editorDocumentBytes: 10
		});

		updatePerformanceEditorOwner('one', 'abcdef');
		unregisterPerformanceEditorOwner('two');
		expect(rendererMemoryOwnerSnapshot()).toEqual({
			activeEditorCount: 1,
			editorDocumentBytes: 12
		});

		unregisterPerformanceEditorOwner('one');
		expect(rendererMemoryOwnerSnapshot()).toEqual({
			activeEditorCount: 0,
			editorDocumentBytes: 0
		});
	});
});
