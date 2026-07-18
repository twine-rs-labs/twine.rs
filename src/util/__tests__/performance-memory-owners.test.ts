import {
	registerPerformanceEditorOwner,
	rendererMemoryOwnerSnapshot,
	selectPerformanceEditorText,
	unregisterPerformanceEditorOwner,
	updatePerformanceEditorOwner
} from '../performance-memory-owners';

describe('renderer memory owners', () => {
	const noRetainedObjects = {
		retainedEditorViewCount: 0,
		retainedLegacyDocumentServiceCount: 0,
		retainedLegacyModeAdapterCount: 0,
		retainedLegacyToolbarDescriptorSetCount: 0,
		retainedLegacyToolbarFacadeCount: 0
	};

	beforeEach(() => {
		(window as any).twinePerformanceNative = {};
		unregisterPerformanceEditorOwner('one');
		unregisterPerformanceEditorOwner('two');
	});

	afterEach(() => {
		delete (window as any).twinePerformanceNative;
	});

	it('tracks and releases active editor document capacity', () => {
		const selectText = jest.fn(() => true);

		registerPerformanceEditorOwner('one', 'abc');
		registerPerformanceEditorOwner('two', 'de', {selectText});

		expect(rendererMemoryOwnerSnapshot()).toEqual({
			activeEditorCount: 2,
			editorDocumentBytes: 10,
			...noRetainedObjects
		});

		updatePerformanceEditorOwner('one', 'abcdef');
		updatePerformanceEditorOwner('two', 'def');
		expect(selectPerformanceEditorText('two', 'de')).toBe(true);
		expect(selectText).toHaveBeenCalledWith('de');
		expect(selectPerformanceEditorText('missing', 'de')).toBe(false);
		unregisterPerformanceEditorOwner('two');
		expect(rendererMemoryOwnerSnapshot()).toEqual({
			activeEditorCount: 1,
			editorDocumentBytes: 12,
			...noRetainedObjects
		});

		unregisterPerformanceEditorOwner('one');
		expect(rendererMemoryOwnerSnapshot()).toEqual({
			activeEditorCount: 0,
			editorDocumentBytes: 0,
			...noRetainedObjects
		});
	});
});
