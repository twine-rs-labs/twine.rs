export interface LegacyToolbarCommandReference {
	name: string;
	scope: string;
}

interface ValidatedToolbarControl {
	disabled: boolean;
	iconOnly: boolean;
	label: string;
}

export interface ValidatedLegacyToolbarButton extends ValidatedToolbarControl {
	command: LegacyToolbarCommandReference;
	icon?: string;
	type: 'button';
}

export interface ValidatedLegacyToolbarSeparator {
	type: 'separator';
}

export interface ValidatedLegacyToolbarMenu extends ValidatedToolbarControl {
	icon: string;
	items: Array<ValidatedLegacyToolbarButton | ValidatedLegacyToolbarSeparator>;
	type: 'menu';
}

export type ValidatedLegacyToolbarDescriptor =
	ValidatedLegacyToolbarButton | ValidatedLegacyToolbarMenu;

export interface LegacyToolbarValidationOptions {
	commandNames: Iterable<string>;
	commandScope: string;
}

export class InvalidLegacyToolbarDescriptorError extends Error {
	readonly path: string;

	constructor(path: string, reason: string) {
		super(`Invalid legacy toolbar descriptor at ${path}: ${reason}`);
		this.name = 'InvalidLegacyToolbarDescriptorError';
		this.path = path;
	}
}

const allowedIconMimeTypes = new Set([
	'image/gif',
	'image/jpeg',
	'image/png',
	'image/svg+xml',
	'image/webp'
]);

function descriptorError(path: string, reason: string): never {
	throw new InvalidLegacyToolbarDescriptorError(path, reason);
}

function recordValue(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		descriptorError(path, 'expected an object');
	}

	return value as Record<string, unknown>;
}

function assertOnlyKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
	path: string
) {
	const allowed = new Set(keys);
	const unsupported = Object.keys(value).find(key => !allowed.has(key));

	if (unsupported) {
		descriptorError(`${path}.${unsupported}`, 'property is not supported');
	}
}

function hasControlCharacter(value: string, allowWhitespace = false) {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);

		if (
			code === 0x7f ||
			(code < 0x20 &&
				(!allowWhitespace || (code !== 0x09 && code !== 0x0a && code !== 0x0d)))
		) {
			return true;
		}
	}

	return false;
}

function requiredLabel(value: unknown, path: string) {
	if (typeof value !== 'string' || value.trim().length === 0) {
		descriptorError(path, 'expected a non-empty string');
	}

	if (hasControlCharacter(value, true)) {
		descriptorError(path, 'control characters are not allowed');
	}

	if (/<\/?[a-z][^>]*>/iu.test(value)) {
		descriptorError(path, 'HTML is not allowed');
	}

	return value;
}

function optionalBoolean(value: unknown, path: string) {
	if (value === undefined) {
		return false;
	}

	if (typeof value !== 'boolean') {
		descriptorError(path, 'expected a boolean');
	}

	return value;
}

function requiredIcon(value: unknown, path: string) {
	if (typeof value !== 'string') {
		descriptorError(path, 'expected an image data URL');
	}

	if (hasControlCharacter(value)) {
		descriptorError(path, 'control characters are not allowed');
	}

	const match = /^data:([^;,]+)(?:;charset=[^;,]+)?(?:;base64)?,(.+)$/iu.exec(
		value
	);

	if (!match || !allowedIconMimeTypes.has(match[1].toLowerCase())) {
		descriptorError(
			path,
			'expected a GIF, JPEG, PNG, SVG, or WebP image data URL'
		);
	}

	return value;
}

function commandReference(
	value: unknown,
	path: string,
	commandNames: ReadonlySet<string>,
	commandScope: string
): LegacyToolbarCommandReference {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		hasControlCharacter(value)
	) {
		descriptorError(path, 'expected a non-empty command name');
	}

	if (!commandNames.has(value)) {
		descriptorError(path, `command "${value}" is not defined in this scope`);
	}

	return {name: value, scope: commandScope};
}

function validateButton(
	rawValue: unknown,
	path: string,
	options: {
		commandNames: ReadonlySet<string>;
		commandScope: string;
		inMenu: boolean;
	}
): ValidatedLegacyToolbarButton {
	const value = recordValue(rawValue, path);

	assertOnlyKeys(
		value,
		options.inMenu
			? ['command', 'disabled', 'iconOnly', 'label', 'type']
			: ['command', 'disabled', 'icon', 'iconOnly', 'label', 'type'],
		path
	);

	if (value.type !== 'button') {
		descriptorError(`${path}.type`, 'expected "button"');
	}

	const result: ValidatedLegacyToolbarButton = {
		command: commandReference(
			value.command,
			`${path}.command`,
			options.commandNames,
			options.commandScope
		),
		disabled: optionalBoolean(value.disabled, `${path}.disabled`),
		iconOnly: optionalBoolean(value.iconOnly, `${path}.iconOnly`),
		label: requiredLabel(value.label, `${path}.label`),
		type: 'button'
	};

	if (!options.inMenu) {
		result.icon = requiredIcon(value.icon, `${path}.icon`);
	}

	return result;
}

function validateSeparator(
	rawValue: unknown,
	path: string
): ValidatedLegacyToolbarSeparator {
	const value = recordValue(rawValue, path);

	assertOnlyKeys(value, ['type'], path);

	if (value.type !== 'separator') {
		descriptorError(`${path}.type`, 'expected "separator"');
	}

	return {type: 'separator'};
}

function validateMenu(
	rawValue: unknown,
	path: string,
	commandNames: ReadonlySet<string>,
	commandScope: string
): ValidatedLegacyToolbarMenu {
	const value = recordValue(rawValue, path);

	assertOnlyKeys(
		value,
		['disabled', 'icon', 'iconOnly', 'items', 'label', 'type'],
		path
	);

	if (value.type !== 'menu') {
		descriptorError(`${path}.type`, 'expected "menu"');
	}

	if (!Array.isArray(value.items)) {
		descriptorError(`${path}.items`, 'expected an array');
	}

	return {
		disabled: optionalBoolean(value.disabled, `${path}.disabled`),
		icon: requiredIcon(value.icon, `${path}.icon`),
		iconOnly: optionalBoolean(value.iconOnly, `${path}.iconOnly`),
		items: value.items.map((item, index) => {
			const itemPath = `${path}.items[${index}]`;
			const itemValue = recordValue(item, itemPath);

			switch (itemValue.type) {
				case 'button':
					return validateButton(item, itemPath, {
						commandNames,
						commandScope,
						inMenu: true
					});

				case 'separator':
					return validateSeparator(item, itemPath);

				default:
					return descriptorError(
						`${itemPath}.type`,
						'expected "button" or "separator"'
					);
			}
		}),
		label: requiredLabel(value.label, `${path}.label`),
		type: 'menu'
	};
}

/**
 * Validates untrusted legacy toolbar output and converts command names into
 * references bound to one editor/format scope.
 */
export function validateToolbarDescriptors(
	rawValue: unknown,
	options: LegacyToolbarValidationOptions
): ValidatedLegacyToolbarDescriptor[] {
	if (!Array.isArray(rawValue)) {
		descriptorError('toolbar', 'expected an array');
	}

	if (
		typeof options.commandScope !== 'string' ||
		options.commandScope.trim().length === 0 ||
		hasControlCharacter(options.commandScope)
	) {
		descriptorError('toolbar.commandScope', 'expected a non-empty scope');
	}

	const commandNames = new Set(options.commandNames);

	return rawValue.map((item, index) => {
		const path = `toolbar[${index}]`;
		const value = recordValue(item, path);

		switch (value.type) {
			case 'button':
				return validateButton(item, path, {
					commandNames,
					commandScope: options.commandScope,
					inMenu: false
				});

			case 'menu':
				return validateMenu(item, path, commandNames, options.commandScope);

			default:
				return descriptorError(`${path}.type`, 'expected "button" or "menu"');
		}
	});
}
