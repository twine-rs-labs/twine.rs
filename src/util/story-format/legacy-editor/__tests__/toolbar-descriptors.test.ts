import {
	InvalidLegacyToolbarDescriptorError,
	validateToolbarDescriptors
} from '../toolbar-descriptors';

const icon = 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E';
const options = {
	commandNames: ['bold', 'italic'],
	commandScope: 'chapbook@2.3.1:editor-1'
};

describe('validateToolbarDescriptors()', () => {
	it('validates documented controls and binds commands to their scope', () => {
		expect(
			validateToolbarDescriptors(
				[
					{
						command: 'bold',
						icon,
						iconOnly: true,
						label: 'Bold',
						type: 'button'
					},
					{
						disabled: true,
						icon,
						items: [
							{
								command: 'italic',
								disabled: true,
								label: 'Italic',
								type: 'button'
							},
							{type: 'separator'}
						],
						label: 'Styles',
						type: 'menu'
					}
				],
				options
			)
		).toEqual([
			{
				command: {
					name: 'bold',
					scope: 'chapbook@2.3.1:editor-1'
				},
				disabled: false,
				icon,
				iconOnly: true,
				label: 'Bold',
				type: 'button'
			},
			{
				disabled: true,
				icon,
				iconOnly: false,
				items: [
					{
						command: {
							name: 'italic',
							scope: 'chapbook@2.3.1:editor-1'
						},
						disabled: true,
						iconOnly: false,
						label: 'Italic',
						type: 'button'
					},
					{type: 'separator'}
				],
				label: 'Styles',
				type: 'menu'
			}
		]);
	});

	it.each([undefined, null, {}, 'button'])(
		'rejects a non-array toolbar value: %p',
		value => {
			expect(() => validateToolbarDescriptors(value, options)).toThrow(
				InvalidLegacyToolbarDescriptorError
			);
		}
	);

	it.each([
		{
			item: {type: 'separator'},
			reason: 'expected "button" or "menu"'
		},
		{
			item: {
				icon,
				items: [{type: 'menu'}],
				label: 'Nested',
				type: 'menu'
			},
			reason: 'expected "button" or "separator"'
		},
		{
			item: {
				command: 'bold',
				icon,
				label: 'Menu item',
				type: 'button'
			},
			menuItem: true,
			reason: 'property is not supported'
		},
		{
			item: {
				command: 'bold',
				icon,
				label: 'Bold',
				onClick: () => undefined,
				type: 'button'
			},
			reason: 'property is not supported'
		}
	])('rejects undocumented descriptor shapes', ({item, menuItem, reason}) => {
		const value = menuItem
			? [{icon, items: [item], label: 'Menu', type: 'menu'}]
			: [item];

		expect(() => validateToolbarDescriptors(value, options)).toThrow(reason);
	});

	it.each([
		['https://example.com/icon.svg'],
		['javascript:alert(1)'],
		['data:text/html,%3Csvg%3E'],
		['data:image/bmp;base64,AAAA'],
		['data:image/svg+xml,']
	])('rejects unsafe or unsupported icon URL %s', unsafeIcon => {
		expect(() =>
			validateToolbarDescriptors(
				[
					{
						command: 'bold',
						icon: unsafeIcon,
						label: 'Bold',
						type: 'button'
					}
				],
				options
			)
		).toThrow('expected a GIF, JPEG, PNG, SVG, or WebP image data URL');
	});

	it('requires icons on top-level buttons and menus', () => {
		expect(() =>
			validateToolbarDescriptors(
				[{command: 'bold', label: 'Bold', type: 'button'}],
				options
			)
		).toThrow('expected an image data URL');
		expect(() =>
			validateToolbarDescriptors(
				[{items: [], label: 'Menu', type: 'menu'}],
				options
			)
		).toThrow('expected an image data URL');
	});

	it.each([
		['', 'expected a non-empty string'],
		['<strong>Bold</strong>', 'HTML is not allowed'],
		['Bad\u0000Label', 'control characters are not allowed']
	])('rejects invalid label %p', (label, reason) => {
		expect(() =>
			validateToolbarDescriptors(
				[{command: 'bold', icon, label, type: 'button'}],
				options
			)
		).toThrow(reason);
	});

	it('validates disabled and icon-only states', () => {
		expect(() =>
			validateToolbarDescriptors(
				[
					{
						command: 'bold',
						disabled: 'yes',
						icon,
						label: 'Bold',
						type: 'button'
					}
				],
				options
			)
		).toThrow('expected a boolean');
		expect(() =>
			validateToolbarDescriptors(
				[
					{
						command: 'bold',
						icon,
						iconOnly: 1,
						label: 'Bold',
						type: 'button'
					}
				],
				options
			)
		).toThrow('expected a boolean');
	});

	it('rejects commands outside the toolbar scope', () => {
		expect(() =>
			validateToolbarDescriptors(
				[{command: 'undo', icon, label: 'Undo', type: 'button'}],
				options
			)
		).toThrow('command "undo" is not defined in this scope');
	});

	it('rejects an empty command scope', () => {
		expect(() =>
			validateToolbarDescriptors(
				[{command: 'bold', icon, label: 'Bold', type: 'button'}],
				{...options, commandScope: ''}
			)
		).toThrow('expected a non-empty scope');
	});
});
