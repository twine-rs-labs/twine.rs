import {extractStoryFormatProperties} from '../story-format-source';

describe('extractStoryFormatProperties()', () => {
	it('parses a standard window.storyFormat() manifest', () => {
		const source =
			'window.storyFormat({"name":"Harlowe","version":"3.3.9","author":"Leon"});';
		const properties = extractStoryFormatProperties(source);

		expect(properties.name).toBe('Harlowe');
		expect(properties.version).toBe('3.3.9');
		expect(properties.author).toBe('Leon');
	});

	it('parses a this.storyFormat() variant with surrounding whitespace', () => {
		const source = '\n  this.storyFormat ( {"name":"X","version":"1.0.0"} ) ;\n';

		expect(extractStoryFormatProperties(source).name).toBe('X');
	});

	it('handles braces and quotes inside string values', () => {
		const source =
			'window.storyFormat({"name":"Snowman","version":"2.1.1","description":"A {minimal} \\"format\\" } here"});';
		const properties = extractStoryFormatProperties(source);

		expect(properties.name).toBe('Snowman');
		expect(properties.description).toBe('A {minimal} "format" } here');
	});

	it('throws when there is no storyFormat() call', () => {
		expect(() => extractStoryFormatProperties('console.log("nope");')).toThrow(
			/not a Twine story format/i
		);
	});

	it('throws when the manifest is missing a name or version', () => {
		expect(() =>
			extractStoryFormatProperties('window.storyFormat({"name":"NoVersion"});')
		).toThrow(/missing a name or version/i);
	});

	it('throws when the manifest is not valid JSON', () => {
		expect(() =>
			extractStoryFormatProperties('window.storyFormat({name: NaN});')
		).toThrow(/not valid JSON/i);
	});
});
