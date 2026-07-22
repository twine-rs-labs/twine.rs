import {
	assertHtmlImportWithinBudget,
	assertImportFileSize,
	assertImportTextSize,
	assertTweePassageCount,
	cumulativeImportBytes
} from '../import-limits';

describe('import limits', () => {
	it('accepts file sizes at the boundary and rejects larger files', () => {
		expect(() => assertImportFileSize(8, 8)).not.toThrow();
		expect(() => assertImportFileSize(9, 8)).toThrow('Import source exceeds');
	});

	it('counts UTF-8 bytes without allocating an encoded copy', () => {
		expect(() => assertImportTextSize('éé', 4)).not.toThrow();
		expect(() => assertImportTextSize('ééa', 4)).toThrow(
			'Import source exceeds'
		);
	});

	it('caps aggregate imported source bytes', () => {
		expect(cumulativeImportBytes(4, 4, 8)).toBe(8);
		expect(() => cumulativeImportBytes(4, 5, 8)).toThrow('aggregate limit');
	});

	it('rejects HTML passage and nesting budgets before DOM parsing', () => {
		expect(() =>
			assertHtmlImportWithinBudget(
				'<tw-storydata><tw-passagedata></tw-passagedata><tw-passagedata></tw-passagedata></tw-storydata>',
				{maxPassages: 1}
			)
		).toThrow('more than 1 passages');
		expect(() =>
			assertHtmlImportWithinBudget('<div><section><p>x</p></section></div>', {
				maxNestingDepth: 2
			})
		).toThrow('nesting exceeds 2 levels');
	});

	it('rejects excessive sibling elements and empty stories', () => {
		expect(() =>
			assertHtmlImportWithinBudget('<i></i><i></i>', {maxElements: 1})
		).toThrow('more than 1 element tags');
		expect(() =>
			assertHtmlImportWithinBudget(
				'<tw-storydata></tw-storydata><tw-storydata></tw-storydata>',
				{maxStories: 1}
			)
		).toThrow('more than 1 stories');
	});

	it('does not honor self-closing syntax on ordinary HTML elements', () => {
		expect(() =>
			assertHtmlImportWithinBudget('<div/><span/>x', {maxNestingDepth: 1})
		).toThrow('nesting exceeds 1 levels');
		expect(() =>
			assertHtmlImportWithinBudget('<svg><path/><path/></svg>', {
				maxNestingDepth: 1
			})
		).not.toThrow();
	});

	it('counts closing tags that HTML error recovery can turn into elements', () => {
		expect(() =>
			assertHtmlImportWithinBudget('</br></br>', {maxElements: 1})
		).toThrow('more than 1 element tags');
		expect(() =>
			assertHtmlImportWithinBudget('</p></p>', {maxElements: 1})
		).toThrow('more than 1 element tags');
	});

	it('does not count markup-like text in raw HTML elements as nesting', () => {
		expect(() =>
			assertHtmlImportWithinBudget(
				'<script>const template = "<div><div><div>";</script>',
				{maxNestingDepth: 1}
			)
		).not.toThrow();
	});

	it('does not treat comment syntax inside raw text as a document comment', () => {
		for (const element of ['script', 'xmp']) {
			expect(() =>
				assertHtmlImportWithinBudget(
					`<${element}><!--</${element}><tw-storydata></tw-storydata><tw-storydata></tw-storydata>`,
					{maxStories: 1}
				)
			).toThrow('more than 1 stories');
		}
	});

	it('recognizes abrupt and bang-closed HTML comments', () => {
		for (const comment of ['<!-->', '<!--x--!>']) {
			expect(() =>
				assertHtmlImportWithinBudget(
					`${comment}<tw-storydata></tw-storydata><tw-storydata></tw-storydata>`,
					{maxStories: 1}
				)
			).toThrow('more than 1 stories');
		}
	});

	it('rejects Twee passage budgets', () => {
		expect(() =>
			assertTweePassageCount(':: one\ntext\n:: two\ntext', 1)
		).toThrow('more than 1 passages');
	});
});
