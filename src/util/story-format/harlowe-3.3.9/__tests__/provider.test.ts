import {CompletionContext} from '@codemirror/autocomplete';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {defaults} from '../../../../store/prefs';
import provider from '../provider';

function createView(document: string) {
	const session = provider.createSession({
		passageNames: ['Hallway'],
		preferences: defaults().storyFormatEditorPreferences['harlowe-3.3.9'],
		tagNames: ['urgent']
	});
	const parent = window.document.createElement('div');
	const view = new EditorView({
		parent,
		state: EditorState.create({
			doc: document,
			extensions: [...session.extensions]
		})
	});

	return {parent, session, view};
}

describe('Harlowe 3.3.9 native CM6 provider', () => {
	it('decorates exact parser tokens and string references', () => {
		const {parent, view} = createView(
			'(if:$visits > 1)[(goto:"Hallway")] (metadata:"urgent",true)'
		);

		expect(
			parent.querySelector('.cm-harlowe-3-macroName-changer')
		).not.toBeNull();
		expect(parent.querySelector('.cm-harlowe-3-variable')).not.toBeNull();
		expect(parent.querySelector('.cm-harlowe-3-passageString')).not.toBeNull();
		expect(parent.querySelector('.cm-harlowe-3-tagString')).not.toBeNull();
		view.dispatch({selection: {anchor: 2}});
		expect(parent.querySelector('.harlowe-native-tooltip')).toHaveTextContent(
			'(if:)'
		);

		view.destroy();
	});

	it('tracks cursor occurrences, proofreading, and scoped find/replace', () => {
		const {parent, session, view} = createView(
			'$name and $name prose (print:"prose")'
		);

		view.dispatch({selection: {anchor: 2}});
		expect(
			parent.querySelectorAll('.cm-harlowe-3-variableOccurrence')
		).toHaveLength(1);

		session.controller.setProofreading(true);
		expect(view.dom).toHaveClass('cm-harlowe-3-proofreading');

		expect(
			session.controller.find({
				matchCase: false,
				query: 'prose',
				scope: 'prose',
				useRegExp: false
			})
		).toMatchObject({count: 2, index: 0});
		expect(
			session.controller.find({
				matchCase: false,
				query: 'prose',
				scope: 'code',
				useRegExp: false
			})
		).toMatchObject({count: 0});
		expect(
			session.controller.find({
				matchCase: false,
				query: 'prose (print:',
				scope: 'prose',
				useRegExp: false
			})
		).toMatchObject({count: 0});
		expect(
			session.controller.find({
				matchCase: false,
				query: 'prose (print:',
				scope: 'code',
				useRegExp: false
			})
		).toMatchObject({count: 0});
		expect(
			session.controller.find({
				matchCase: false,
				query: '\\$name',
				scope: 'code',
				useRegExp: true
			})
		).toMatchObject({count: 2});

		session.controller.replaceAll('$person');
		expect(view.state.doc.toString()).toContain('$person and $person');

		view.destroy();
	});

	it('honors dialect-scoped completion and tooltip preferences', () => {
		const session = provider.createSession({
			passageNames: [],
			preferences: {
				codeUsesCodeFont: false,
				codingTooltips: false,
				completionsForKeywords: false,
				completionsForMacros: false
			},
			tagNames: []
		});

		expect(session.completionSources).toEqual([]);
		expect(session.useCodeFont).toBe(false);
		expect(session.key).toContain('completionsForMacros');
	});

	it('offers the exact legacy macro aliases and keyword vocabulary', async () => {
		const session = provider.createSession({
			passageNames: [],
			preferences: defaults().storyFormatEditorPreferences['harlowe-3.3.9'],
			tagNames: []
		});
		const source = session.completionSources?.[0];

		expect(source).toBeDefined();

		const macroState = EditorState.create({doc: '(v6m'});
		const macroResult = await source?.(
			new CompletionContext(macroState, macroState.doc.length, false)
		);
		const macroLabels = macroResult?.options.map(option => option.label);

		expect(macroLabels).toContain('verbatim-print');
		expect(macroLabels).toContain('v6m-print');
		expect(macroLabels).toContain('sequence-link');

		const keywordState = EditorState.create({doc: '(print:vis)'});
		const keywordResult = await source?.(
			new CompletionContext(keywordState, keywordState.doc.length - 1, false)
		);
		const keywordLabels = keywordResult?.options.map(option => option.label);

		expect(keywordLabels).toEqual(
			expect.arrayContaining([
				'visits',
				'codehook',
				'alphanumeric',
				'transparent',
				'does not match',
				'2bind'
			])
		);
	});
});
