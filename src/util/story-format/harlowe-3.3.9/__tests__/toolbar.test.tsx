import {act, fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {NativeEditorHost} from '../../native-editor/types';
import {HarloweToolbar, wrapNativeEditorSelections} from '../harlowe-toolbar';
import {
	harloweAlignmentWrapper,
	harloweColour,
	harloweInputBoxSource,
	harloweLinkWrapper,
	harloweVisitComparison
} from '../toolbar-source';

jest.mock('../../../use-popper', () => ({
	usePopper: () => ({attributes: {}, styles: {}})
}));

function editor(
	document: string,
	selections: Array<{anchor: number; head: number}>
) {
	const applyEdits = jest.fn();
	const focus = jest.fn();
	const host: NativeEditorHost = {
		applyEdits,
		focus,
		getSnapshot: () => ({
			document,
			mainSelectionIndex: Math.min(1, selections.length - 1),
			selections
		})
	};

	return {applyEdits, focus, host};
}

describe('Harlowe native toolbar selection transforms', () => {
	it('wraps all selections atomically and preserves direction/main selection', () => {
		const {applyEdits, focus, host} = editor('one two three', [
			{anchor: 3, head: 0},
			{anchor: 8, head: 13}
		]);

		wrapNativeEditorSelections(host, {
			after: "''",
			before: "''",
			placeholder: 'Bold Text'
		});

		expect(applyEdits).toHaveBeenCalledWith(
			[
				{from: 0, insert: "''one''", to: 3},
				{from: 8, insert: "''three''", to: 13}
			],
			[
				{anchor: 5, head: 2},
				{anchor: 14, head: 19}
			],
			1
		);
		expect(focus).toHaveBeenCalled();
	});

	it('selects placeholders inserted at empty cursors', () => {
		const {applyEdits, host} = editor('text', [{anchor: 2, head: 2}]);

		wrapNativeEditorSelections(host, {
			after: ']',
			before: '(if:true)[',
			placeholder: 'Conditional Text'
		});

		expect(applyEdits).toHaveBeenCalledWith(
			[
				{
					from: 2,
					insert: '(if:true)[Conditional Text]',
					to: 2
				}
			],
			[{anchor: 12, head: 28}],
			0
		);
	});

	it('runs dropdown editor transactions after the menu click completes', () => {
		jest.useFakeTimers();
		const {applyEdits, host} = editor('text', [{anchor: 0, head: 4}]);
		const controller = {
			clearFind: jest.fn(),
			find: jest.fn(),
			findNext: jest.fn(),
			getFindResult: () => ({count: 0, index: -1}),
			proofreading: false,
			replaceAll: jest.fn(),
			replaceCurrent: jest.fn(),
			requestPanel: jest.fn(),
			setProofreading: jest.fn(),
			subscribe: () => () => {},
			takeRequestedPanel: jest.fn()
		};

		render(
			<HarloweToolbar
				controller={controller}
				editor={host}
				onChangePreferences={jest.fn()}
				preferences={{
					codeUsesCodeFont: true,
					codingTooltips: true,
					completionsForKeywords: true,
					completionsForMacros: true
				}}
			/>
		);
		fireEvent.click(screen.getByRole('button', {name: 'Styles'}));
		fireEvent.click(screen.getByRole('button', {name: 'Bold [Ctrl+B]'}));
		expect(applyEdits).not.toHaveBeenCalled();

		act(() => jest.runOnlyPendingTimers());
		expect(applyEdits).toHaveBeenCalledWith(
			[{from: 0, insert: "''text''", to: 4}],
			[{anchor: 2, head: 6}],
			0
		);
		jest.useRealTimers();
	});
});

describe('Harlowe 3.3.9 toolbar source parity', () => {
	it('uses compact alignment markup where the legacy panel did', () => {
		expect(
			harloweAlignmentWrapper({
				alignment: 'left',
				placement: 0,
				remainder: true,
				width: 10
			})
		).toEqual({
			after: '',
			before: '<==\n',
			placeholder: 'Aligned Text'
		});
		expect(
			harloweAlignmentWrapper({
				alignment: 'center',
				placement: 5,
				remainder: false,
				width: 5
			}).before
		).toBe('(align:"=><=")[');
	});

	it('serializes opacity and input-box placement like the legacy builders', () => {
		expect(harloweColour('#ffffff', 1)).toBe('#fff');
		expect(harloweColour('#123456', 0)).toBe('transparent');
		expect(harloweColour('#ff0000', 0.5)).toBe('(hsl:0,1,0.5,0.5)');
		expect(
			harloweInputBoxSource({
				binding: '$name',
				forced: false,
				initialText: '',
				placement: 5,
				rows: 3,
				width: 5
			})
		).toBe('(input-box:2bind $name,"=XX=")');
	});

	it('chooses link markup, macro fallbacks, reveal variants, and cycles', () => {
		const base = {
			action: 'goto' as const,
			arrivingTransition: '',
			clickPage: false,
			cycleEnd: 'loop' as const,
			cycleOptions: [],
			departingTransition: '',
			passage: 'Hallway',
			remainder: false,
			revealBehavior: 'link' as const,
			revealedTransition: '',
			text: 'Go',
			transitionTime: 0.8
		};

		expect(harloweLinkWrapper(base).before).toBe('[[Go->Hallway]]');
		expect(harloweLinkWrapper({...base, passage: 'A->B'}).before).toBe(
			'(link-goto:"Go","A->B")'
		);
		expect(
			harloweLinkWrapper({
				...base,
				action: 'reveal',
				revealBehavior: 'link-rerun',
				revealedTransition: 'dissolve'
			})
		).toMatchObject({
			after: ']',
			before: '(t8n:"dissolve")+(link-rerun:"Go")[',
			placeholder: 'Revealed Text'
		});
		expect(
			harloweLinkWrapper({
				...base,
				action: 'cycle',
				cycleEnd: 'remove',
				cycleOptions: ['Wait', 'Leave']
			}).before
		).toBe('(seq-link:"Go","Wait","Leave","")');
	});

	it('reproduces visit comparison shorthand', () => {
		expect(harloweVisitComparison('visits', 'a multiple of', 2)).toBe(
			'visits is an even'
		);
		expect(harloweVisitComparison('visits', 'at least', 3)).toBe('visits >= 3');
	});
});
