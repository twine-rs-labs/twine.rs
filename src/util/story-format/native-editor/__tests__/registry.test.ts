import {
	fakeLoadedStoryFormat,
	fakeStoryFormatProperties
} from '../../../../test-util';
import {resolveNativeStoryFormatEditorIntegration} from '../registry';

describe('native story format editor registry', () => {
	it('matches only the exact bundled Harlowe 3.3.9 identity', () => {
		const properties = fakeStoryFormatProperties();

		properties.name = 'Harlowe';
		properties.version = '3.3.9';
		const format = fakeLoadedStoryFormat(
			{
				name: 'Harlowe',
				url: 'story-formats/harlowe-3.3.9/format.js',
				userAdded: false,
				version: '3.3.9'
			},
			properties
		);

		expect(resolveNativeStoryFormatEditorIntegration(format)).toMatchObject({
			dialect: {
				family: 'harlowe',
				id: 'harlowe-3.3.9',
				version: '3.3.9'
			},
			ownsSyntax: true,
			type: 'native'
		});
		expect(resolveNativeStoryFormatEditorIntegration(format)).toBe(
			resolveNativeStoryFormatEditorIntegration(format)
		);
	});

	it('lazy-loads the dialect provider only when requested', async () => {
		const properties = fakeStoryFormatProperties();

		properties.name = 'Harlowe';
		properties.version = '3.3.9';
		const format = fakeLoadedStoryFormat(
			{
				name: 'Harlowe',
				url: 'story-formats/harlowe-3.3.9/format.js',
				userAdded: false,
				version: '3.3.9'
			},
			properties
		);
		const integration = resolveNativeStoryFormatEditorIntegration(format);

		expect(integration).toBeDefined();
		await expect(integration!.loadProvider()).resolves.toMatchObject({
			default: {
				dialect: {
					family: 'harlowe',
					id: 'harlowe-3.3.9',
					version: '3.3.9'
				}
			}
		});
	});

	it.each([
		{
			name: 'user format with the same visible identity',
			overrides: {userAdded: true}
		},
		{
			name: 'different bundled version',
			overrides: {
				url: 'story-formats/harlowe-3.3.8/format.js',
				version: '3.3.8'
			}
		},
		{
			name: 'custom URL named Harlowe',
			overrides: {url: 'https://example.invalid/harlowe/format.js'}
		}
	])('does not match $name', ({overrides}) => {
		const properties = fakeStoryFormatProperties();

		properties.name = 'Harlowe';
		properties.version = overrides.version ?? '3.3.9';
		const format = fakeLoadedStoryFormat(
			{
				name: 'Harlowe',
				url: 'story-formats/harlowe-3.3.9/format.js',
				userAdded: false,
				version: '3.3.9',
				...overrides
			},
			properties
		);

		expect(resolveNativeStoryFormatEditorIntegration(format)).toBeUndefined();
	});
});
