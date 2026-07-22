import {importStories, importStoriesAsync} from '../import';
import {publishStory} from '../publish';
import {TWINE_RS_STORY_GRAPH_HTML_ATTRIBUTE} from '../story-graph-metadata';
import {resolveStoryFormatEditorIntegration} from '../story-format';
import {
	fakeAppInfo,
	fakeLoadedStoryFormat,
	minimalLegacyEditorFormatProperties
} from '../../test-util';

const testHtml = `
<tw-storydata name="Test" startnode="1" zoom="1.5" creator="Twine" creator-version="2.0.11" ifid="3AE380EE-4B34-4D0D-A8E2-BE624EB271C9" format="SugarCube" options="" hidden><tw-tag name="my-tag" color="purple" /><style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">* { color: red }
* { color: blue }</style><script role="script" id="twine-user-script" type="text/twine-javascript">alert('hi');</script><tw-passagedata pid="1" name="Untitled Passage" tags="foo bar" position="450,250" size="100,100">This is some text.

[[1]]</tw-passagedata>
<tw-passagedata pid="2" name="1" tags="" position="600,200" size="200,200">This is another &lt;&lt;passage&gt;&gt;.</tw-passagedata>
<tw-passagedata pid="3" name="&lt;hi&gt;" tags="" position="700,300">Another passage.</tw-passagedata>
</tw-storydata>
`;

const bareTestHtml = '<tw-storydata name="Test" hidden></tw-storydata>';
const expectedRoundTripMetadataDifferences = new Set([
	'creator',
	'creator-version',
	TWINE_RS_STORY_GRAPH_HTML_ATTRIBUTE
]);

function storyDataElement(html: string) {
	const container = document.createElement('div');

	container.innerHTML = html;

	const storyData = container.querySelector('tw-storydata');

	if (!storyData) {
		throw new Error('HTML has no <tw-storydata> element');
	}

	return storyData;
}

function comparableAttributes(
	element: Element,
	ignoredAttributes = expectedRoundTripMetadataDifferences
) {
	return Object.fromEntries(
		element
			.getAttributeNames()
			.filter(name => !ignoredAttributes.has(name))
			.sort()
			.map(name => [name, element.getAttribute(name)])
	);
}

function comparableStoryData(html: string) {
	const storyData = storyDataElement(html);

	return {
		attributes: comparableAttributes(storyData),
		passages: Array.from(storyData.querySelectorAll('tw-passagedata')).map(
			passage => ({
				attributes: comparableAttributes(passage, new Set()),
				text: passage.textContent
			})
		),
		script: storyData.querySelector('[role="script"]')?.textContent ?? '',
		stylesheet:
			storyData.querySelector('[role="stylesheet"]')?.textContent ?? '',
		tagColors: Array.from(storyData.querySelectorAll('tw-tag')).map(tag => ({
			color: tag.getAttribute('color'),
			name: tag.getAttribute('name')
		}))
	};
}

describe('importStories', () => {
	it('creates a JavaScript object representation of HTML data', () => {
		const result = importStories(testHtml);

		expect(result.length).toBe(1);
		expect(typeof result[0].id).toBe('string');
		expect(result[0]).toEqual(
			expect.objectContaining({
				ifid: '3AE380EE-4B34-4D0D-A8E2-BE624EB271C9',
				name: 'Test',
				script: "alert('hi');",
				startPassage: result[0].passages[0].id,
				storyFormat: 'SugarCube',
				stylesheet: '* { color: red }\n* { color: blue }',
				tagColors: {
					'my-tag': 'purple'
				},
				zoom: 1.5
			})
		);
		expect(result[0].passages.length).toBe(3);
		result[0].passages.forEach(p => expect(typeof p.id).toBe('string'));
		expect(result[0].passages[0]).toEqual(
			expect.objectContaining({
				left: 450,
				name: 'Untitled Passage',
				tags: ['foo', 'bar'],
				text: 'This is some text.\n\n[[1]]',
				top: 250
			})
		);
		expect(result[0].passages[1]).toEqual(
			expect.objectContaining({
				height: 200,
				left: 600,
				name: '1',
				tags: [],
				text: 'This is another <<passage>>.',
				top: 200,
				width: 200
			})
		);
		expect(result[0].passages[2]).toEqual(
			expect.objectContaining({
				left: 700,
				name: '<hi>',
				tags: [],
				text: 'Another passage.',
				top: 300
			})
		);
	});

	it('handles malformed HTML data', () => {
		let result = importStories('');

		expect(result).toEqual([]);
		result = importStories('<tw-storydata></tw-storydata>');
		expect(typeof result[0].id).toBe('string');
		expect(result[0]).toEqual(
			expect.objectContaining({
				passages: [],
				tagColors: {}
			})
		);
	});

	it.todo('handles malformed passage size attributes');
	it.todo('handles malformed passage position attributes');

	it('handles HTML data without expected attributes', () => {
		const result = importStories(bareTestHtml);

		expect(result.length).toBe(1);
		expect(typeof result[0].id).toBe('string');
		expect(result[0]).toEqual(
			expect.objectContaining({
				name: 'Test',
				passages: [],
				script: '',
				stylesheet: '',
				tagColors: {}
			})
		);
	});

	it('preserves each story format in mixed Twine HTML', () => {
		const result = importStories(`
			<tw-storydata name="Harlowe Story" format="Harlowe" format-version="3.3.9" hidden>
				<tw-passagedata pid="1" name="Start">(print: "hi")</tw-passagedata>
			</tw-storydata>
			<tw-storydata name="SugarCube Story" format="SugarCube" format-version="2.37.3" hidden>
				<tw-passagedata pid="1" name="Start">&lt;&lt;set $score to 1&gt;&gt;</tw-passagedata>
			</tw-storydata>
		`);

		expect(result.map(story => story.storyFormat)).toEqual([
			'Harlowe',
			'SugarCube'
		]);
		expect(result.map(story => story.storyFormatVersion)).toEqual([
			'3.3.9',
			'2.37.3'
		]);
	});

	it('does not execute editor integration embedded in imported published HTML', () => {
		delete (window as any).importedEditorIntegrationExecuted;
		const [story] = importStories(`
			<script>
				window.importedEditorIntegrationExecuted = true;
				window.storyFormat({
					name: 'Embedded Format',
					version: '9.9.9',
					editorExtensions: {twine: {'*': {codeMirror: {}}}}
				});
			</script>
			<tw-storydata name="Older Story" format="Chapbook" format-version="1.2.3" hidden>
				<tw-passagedata pid="1" name="Start">Hello</tw-passagedata>
			</tw-storydata>
		`);

		expect((window as any).importedEditorIntegrationExecuted).toBeUndefined();
		expect(story).toEqual(
			expect.objectContaining({
				storyFormat: 'Chapbook',
				storyFormatVersion: '1.2.3'
			})
		);
		expect(story.passages[0].name).toBe('Start');

		const installedProperties = minimalLegacyEditorFormatProperties();

		installedProperties.name = 'Chapbook';
		installedProperties.version = '1.2.3';
		const installed = fakeLoadedStoryFormat(
			{name: 'Chapbook', version: '1.2.3'},
			installedProperties
		);
		const integration = resolveStoryFormatEditorIntegration(installed, {
			twineVersion: '2.10.0'
		});

		expect(integration.type).toBe('adapted-legacy');
		if (integration.type === 'adapted-legacy') {
			expect(integration.codeMirror.commands).toHaveProperty('insertMarker');
		}
	});

	it('infers SugarCube when imported story data omits format attributes', () => {
		const result = importStories(`
			<tw-storydata name="Trigaea-like" hidden>
				<tw-passagedata pid="1" name="Start">&lt;&lt;set $visited to true&gt;&gt;</tw-passagedata>
			</tw-storydata>
		`);

		expect(result[0]).toEqual(
			expect.objectContaining({
				storyFormat: 'SugarCube',
				storyFormatVersion: ''
			})
		);
	});

	it('exports imported SugarCube HTML with only expected metadata differences', () => {
		const sourceHtml = `
			<tw-storydata name="Trigaea" startnode="1" creator="Twine" creator-version="2.10.0" ifid="TRIGAEA-IFID" format="SugarCube" format-version="2.37.3" options="" tags="demo restored" zoom="1.25" hidden>
				<tw-tag name="earth" color="green"></tw-tag>
				<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">body { color: #123; }</style>
				<script role="script" id="twine-user-script" type="text/twine-javascript">State.variables.ready = true;</script>
				<tw-passagedata pid="1" name="Start" tags="earth hub" position="100,200" size="140,120">Welcome to [[Field]].

&lt;&lt;set $visited to true&gt;&gt;</tw-passagedata>
				<tw-passagedata pid="2" name="Field" tags="" position="320,240" size="160,110">&lt;&lt;if $visited&gt;&gt;The field remembers.&lt;&lt;/if&gt;&gt;</tw-passagedata>
			</tw-storydata>
		`;
		const [story] = importStories(sourceHtml);
		const exportedHtml = publishStory(
			story,
			fakeAppInfo({name: 'twine.rs', version: '0.1.0'}),
			{includeStoryGraph: true}
		);
		const exportedStoryData = storyDataElement(exportedHtml);

		expect(
			exportedStoryData.getAttribute(TWINE_RS_STORY_GRAPH_HTML_ATTRIBUTE)
		).toBeTruthy();
		expect(comparableStoryData(exportedHtml)).toEqual(
			comparableStoryData(sourceHtml)
		);
	});

	it("allows setting the story's creation date manually", () => {
		const forceDate = new Date(Date.parse('January 1, 1987'));
		const result = importStories(testHtml, forceDate);

		expect(result[0].lastUpdate).toBe(forceDate);
	});

	it('applies twine.rs StoryData graph metadata over normal passage positions', () => {
		const metadata = {
			schema: 'twine.rs/story-graph/v1',
			kind: 'storyGraph',
			graph: {
				passages: {
					'old-id': {
						id: 'old-id',
						name: 'Untitled Passage',
						bounds: {
							height: 180,
							left: 123,
							top: 456,
							width: 240
						}
					}
				}
			}
		};
		const result = importStories(`
			<tw-storydata name="Test" ${TWINE_RS_STORY_GRAPH_HTML_ATTRIBUTE}='${JSON.stringify(
				metadata
			)}' hidden>
				<tw-passagedata pid="1" name="Untitled Passage" position="0,0" size="100,100">Text</tw-passagedata>
			</tw-storydata>
		`);

		expect(result[0].passages[0]).toEqual(
			expect.objectContaining({
				height: 180,
				left: 123,
				top: 456,
				width: 240
			})
		);
	});

	it('links passages to their parent story', () => {
		const result = importStories(testHtml);

		expect(
			result.every(story =>
				story.passages.every(passage => passage.story === story.id)
			)
		).toBe(true);
	});

	it('asynchronously imports the same story shape', async () => {
		await expect(importStoriesAsync(testHtml)).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'Test',
					passages: expect.arrayContaining([
						expect.objectContaining({
							name: 'Untitled Passage',
							text: 'This is some text.\n\n[[1]]'
						})
					])
				})
			])
		);
	});

	it('rejects excessive HTML tag attributes without splitting them', async () => {
		const tags = Array.from({length: 257}, (_, index) => `tag-${index}`).join(
			' '
		);
		const source = `<tw-storydata name="Tagged"><tw-passagedata name="Start" tags="${tags}"></tw-passagedata></tw-storydata>`;

		expect(() => importStories(source)).toThrow('more than 256 tags');
		await expect(importStoriesAsync(source)).rejects.toThrow(
			'more than 256 tags'
		);
	});

	it('imports only outermost story elements from deeply nested malformed HTML', async () => {
		const depth = 256;
		const source = `${Array.from(
			{length: depth},
			(_, index) => `<tw-storydata name="Story ${index}">`
		).join('')}${'</tw-storydata>'.repeat(depth)}`;

		expect(importStories(source)).toEqual([
			expect.objectContaining({name: 'Story 0'})
		]);
		await expect(importStoriesAsync(source)).resolves.toEqual([
			expect.objectContaining({name: 'Story 0'})
		]);
	});

	it('yields between large passage batches during async import', async () => {
		const originalRequestIdleCallback = window.requestIdleCallback;
		const idleSpy = jest.fn((callback: IdleRequestCallback) => {
			window.setTimeout(
				() =>
					callback({
						didTimeout: false,
						timeRemaining: () => 16
					} as IdleDeadline),
				0
			);

			return 1;
		});
		const passages = Array.from(
			{length: 5},
			(_, index) =>
				`<tw-passagedata pid="${index + 1}" name="Passage ${
					index + 1
				}">Text ${index + 1}</tw-passagedata>`
		).join('');

		window.requestIdleCallback = idleSpy;

		try {
			const result = await importStoriesAsync(
				`<tw-storydata name="Chunky" startnode="1">${passages}</tw-storydata>`,
				undefined,
				{passageBatchSize: 2}
			);

			expect(result[0].passages).toHaveLength(5);
			expect(idleSpy).toHaveBeenCalledTimes(4);
		} finally {
			window.requestIdleCallback = originalRequestIdleCallback;
		}
	});
});
