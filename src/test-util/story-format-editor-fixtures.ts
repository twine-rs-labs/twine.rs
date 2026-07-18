import type {StoryFormatProperties} from '../store/story-formats';

const testIcon =
	'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E';

export function minimalLegacyEditorFormatProperties(): StoryFormatProperties {
	return {
		name: 'Minimal Legacy Editor',
		source: '<tw-storydata>{{STORY_DATA}}</tw-storydata>',
		version: '1.0.0',
		editorExtensions: {
			twine: {
				'^2.0.0': {
					codeMirror: {
						commands: {
							insertMarker(editor) {
								editor.replaceSelection('[marker]');
							}
						},
						mode: () => ({
							token(stream) {
								stream.skipToEnd();
								return 'keyword';
							}
						}),
						toolbar: () => [
							{
								command: 'insertMarker',
								icon: testIcon,
								label: 'Insert marker',
								type: 'button'
							}
						]
					}
				}
			}
		}
	};
}

export function unsupportedLegacyEditorFormatProperties(): StoryFormatProperties {
	return {
		name: 'Unsupported Legacy Editor',
		source: '<tw-storydata>{{STORY_DATA}}</tw-storydata>',
		version: '1.0.0',
		editorExtensions: {
			twine: {
				'^2.0.0': {
					codeMirror: {
						mode: () => ({
							token(stream) {
								void (stream as unknown as {lineOracle: unknown}).lineOracle;
								stream.skipToEnd();
								return 'keyword';
							}
						})
					}
				}
			}
		}
	};
}
