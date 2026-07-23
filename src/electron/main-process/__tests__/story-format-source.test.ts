import {readFileSync} from 'fs';
import {resolve} from 'path';
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
		const source =
			'\n  this.storyFormat ( {"name":"X","version":"1.0.0"} ) ;\n';

		expect(extractStoryFormatProperties(source).name).toBe('X');
	});

	it('handles braces and quotes inside string values', () => {
		const source =
			'window.storyFormat({"name":"Snowman","version":"2.1.1","description":"A {minimal} \\"format\\" } here"});';
		const properties = extractStoryFormatProperties(source);

		expect(properties.name).toBe('Snowman');
		expect(properties.description).toBe('A {minimal} "format" } here');
	});

	it('omits a legacy setup function without evaluating it', () => {
		(globalThis as any).storyFormatSetupExecuted = false;
		const source = `window.storyFormat({"name":"Harlowe","version":"3.3.9","source":"<html></html>","setup": function() {
			globalThis.storyFormatSetupExecuted = true;
			return {"nested": "value"};
		}});`;
		const properties = extractStoryFormatProperties(source);

		expect(properties).toEqual({
			name: 'Harlowe',
			source: '<html></html>',
			version: '3.3.9'
		});
		expect((globalThis as any).storyFormatSetupExecuted).toBe(false);
	});

	it('does not mistake setup-like text inside a string for executable setup', () => {
		const source = `window.storyFormat(${JSON.stringify({
			description: 'literal ,"setup": function() text',
			name: 'Safe',
			source: '<html></html>',
			version: '1.0.0'
		})});`;

		expect(extractStoryFormatProperties(source).description).toContain(
			'"setup": function()'
		);
	});

	it('parses the bundled Harlowe 3 manifest', () => {
		const properties = extractStoryFormatProperties(
			readFileSync(
				resolve(
					__dirname,
					'../../../../public/story-formats/harlowe-3.3.9/format.js'
				),
				'utf8'
			)
		);

		expect(properties.name).toBe('Harlowe');
		expect(properties.version).toBe('3.3.9');
		expect(properties.source).toContain('{{STORY_DATA}}');
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
