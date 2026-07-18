import type {SourceEditorDocumentChange} from '../../../components/control/source-editor';
import {
	countDelimiterLines,
	delimiterDelta,
	legacyDocumentUpdateStrategy,
	nextDelimiterState,
	shouldAcceptAuthoritativeText
} from '../editor-window';

function change(
	document: string,
	edits: SourceEditorDocumentChange['edits']
): SourceEditorDocumentChange {
	return {document, edits};
}

describe('legacy mode delimiter tracking', () => {
	it('counts only complete delimiter lines', () => {
		expect(countDelimiterLines('--\ntext\n--')).toBe(1);
		expect(countDelimiterLines('prefix --\n---\n-- suffix')).toBe(0);
		expect(countDelimiterLines('--\r\ntext')).toBe(0);
		expect(countDelimiterLines('text\n--\r\nmore')).toBe(1);
	});

	it('tracks delimiter insertion and removal from changed line regions', () => {
		expect(
			delimiterDelta(
				'text',
				change('text\n--', [
					{from: 4, fromNew: 4, insert: '\n--', to: 4, toNew: 7}
				])
			)
		).toBe(1);
		expect(
			delimiterDelta(
				'text\n--',
				change('text', [{from: 4, fromNew: 4, insert: '', to: 7, toNew: 4}])
			)
		).toBe(-1);
	});

	it('does no full-document accounting for unrelated line edits', () => {
		const before = '--\nalpha\nomega';
		const after = '--\nalpha!\nomega';

		expect(
			delimiterDelta(
				before,
				change(after, [{from: 8, fromNew: 8, insert: '!', to: 8, toNew: 9}])
			)
		).toBe(0);
	});

	it('verifies apparent delimiter transitions before recreating the adapter', () => {
		const conservativeChange = change('head\n--\nalpha!', [
			{from: 5, fromNew: 8, insert: 'a', to: 7, toNew: 9}
		]);

		expect(delimiterDelta('head\n--\nalpha', conservativeChange)).toBe(-1);
		expect(
			nextDelimiterState(1, 'head\n--\nalpha', conservativeChange)
		).toEqual({
			count: 1,
			presenceChanged: false
		});
		expect(
			nextDelimiterState(
				1,
				'head\n--\nalpha',
				change('head\nalpha', [
					{from: 5, fromNew: 5, insert: '', to: 8, toNew: 5}
				])
			)
		).toEqual({count: 0, presenceChanged: true});
	});

	it('preserves only Chapbook lookAhead snapshots between delimiter transitions', () => {
		expect(
			legacyDocumentUpdateStrategy('chapbook-delimiter-presence', false)
		).toBe('preserve-look-ahead');
		expect(
			legacyDocumentUpdateStrategy('chapbook-delimiter-presence', true)
		).toBe('replace-document');
		expect(legacyDocumentUpdateStrategy('current-document', false)).toBe(
			'replace-document'
		);
	});

	it('rejects stale authoritative echoes while newer local text is expected', () => {
		expect(shouldAcceptAuthoritativeText('latest', 'older')).toBe(false);
		expect(shouldAcceptAuthoritativeText('latest', 'latest')).toBe(true);
		expect(shouldAcceptAuthoritativeText(undefined, 'external')).toBe(true);
	});
});
