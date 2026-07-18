import {
	harloweMacroDefinitionsByName,
	harloweTokenAt,
	parseHarloweDocument
} from '../parser';

describe('Harlowe 3.3.9 native parser', () => {
	it('uses the bundled grammar for nested markup and macro code', () => {
		const parsed = parseHarloweDocument(
			"(if: $visits > 1)[Hello, ''again''.]",
			[],
			[]
		);

		expect(parsed.tree.children.map(token => token.type)).toEqual([
			'macro',
			'hook'
		]);
		expect(parsed.referenceTokens.variable).toHaveLength(1);
		expect(parsed.referenceTokens.variable[0]).toMatchObject({
			name: 'visits',
			text: '$visits',
			type: 'variable'
		});
		expect(
			parsed.styleRanges.some(range =>
				range.className.includes('harlowe-3-macroName-changer')
			)
		).toBe(true);
		expect(
			parsed.styleRanges.some(range =>
				range.className.includes('harlowe-3-bold')
			)
		).toBe(true);
	});

	it('classifies passage/tag strings and parser errors', () => {
		const parsed = parseHarloweDocument(
			'(goto: "Hallway") (metadata: "urgent", true) (not-a-macro: 1)',
			['Hallway'],
			['urgent']
		);
		const classes = parsed.styleRanges.map(range => range.className).join(' ');

		expect(classes).toContain('harlowe-3-passageString');
		expect(classes).toContain('harlowe-3-tagString');
		expect(classes).toContain('harlowe-3-error');
	});

	it('keeps exact macro aliases and token lookup', () => {
		expect(harloweMacroDefinitionsByName.v6mprint).toMatchObject({
			name: 'verbatim-print',
			returnType: 'Command'
		});

		const parsed = parseHarloweDocument('$one and $two');

		expect(harloweTokenAt(parsed, 1)).toMatchObject({
			name: 'one',
			type: 'variable'
		});
	});
});
