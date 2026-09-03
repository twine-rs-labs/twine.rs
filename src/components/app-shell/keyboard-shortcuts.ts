import type {PrefsState} from '../../store/prefs';

type KeybindingPreset = PrefsState['keybindingPreset'];
type Platform = 'mac' | 'other';

export type ShortcutCommandId =
	| 'build.play'
	| 'build.screen'
	| 'build.test'
	| 'nav.current-story'
	| 'nav.library'
	| 'nav.new-project'
	| 'nav.settings';

export interface KeyboardShortcut {
	altKey?: boolean;
	ctrlKey?: boolean;
	key: string;
	metaKey?: boolean;
	primaryKey?: boolean;
	shiftKey?: boolean;
}

/** The shell-owned binding which opens and closes the command palette. */
export const commandPaletteKeybinding: KeyboardShortcut = {
	key: 'k',
	primaryKey: true
};

const shortcuts: Record<
	KeybindingPreset,
	Partial<Record<ShortcutCommandId, KeyboardShortcut>>
> = {
	default: {
		'build.play': {key: 'Enter', primaryKey: true},
		'build.screen': {altKey: true, key: 'b', primaryKey: true},
		'build.test': {key: 'Enter', primaryKey: true, shiftKey: true},
		'nav.current-story': {altKey: true, key: 'e', primaryKey: true},
		'nav.library': {altKey: true, key: 'l', primaryKey: true},
		'nav.new-project': {altKey: true, key: 'n', primaryKey: true},
		'nav.settings': {key: ',', primaryKey: true}
	},
	emacs: {
		'build.play': {ctrlKey: true, key: 'p'},
		'build.screen': {ctrlKey: true, key: 'b'},
		'build.test': {ctrlKey: true, key: 't', shiftKey: true},
		'nav.current-story': {ctrlKey: true, key: 'e'},
		'nav.library': {ctrlKey: true, key: 'l'},
		'nav.new-project': {ctrlKey: true, key: 'n'},
		'nav.settings': {ctrlKey: true, key: ','}
	},
	vim: {
		'build.play': {altKey: true, key: 'p'},
		'build.screen': {altKey: true, key: 'b'},
		'build.test': {altKey: true, key: 't'},
		'nav.current-story': {altKey: true, key: 'e'},
		'nav.library': {altKey: true, key: 'l'},
		'nav.new-project': {altKey: true, key: 'n'},
		'nav.settings': {altKey: true, key: ','}
	}
};

function currentPlatform(): Platform {
	return /Mac|iPhone|iPad|iPod/i.test(window.navigator.platform)
		? 'mac'
		: 'other';
}

export function editableTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	return (
		target.isContentEditable ||
		target.tagName === 'INPUT' ||
		target.tagName === 'TEXTAREA' ||
		target.tagName === 'SELECT'
	);
}

export function dialogTarget(target: EventTarget | null) {
	return (
		target instanceof HTMLElement &&
		Boolean(target.closest('[role="dialog"], [aria-modal="true"]'))
	);
}

function matchesModifier(
	event: KeyboardEvent,
	shortcut: KeyboardShortcut,
	platform: Platform
) {
	if (shortcut.primaryKey) {
		const primaryPressed = platform === 'mac' ? event.metaKey : event.ctrlKey;
		const alternatePrimaryPressed =
			platform === 'mac' ? event.ctrlKey : event.metaKey;

		return (
			primaryPressed &&
			!alternatePrimaryPressed &&
			event.altKey === !!shortcut.altKey &&
			event.shiftKey === !!shortcut.shiftKey
		);
	}

	return (
		event.altKey === !!shortcut.altKey &&
		event.ctrlKey === !!shortcut.ctrlKey &&
		event.metaKey === !!shortcut.metaKey &&
		event.shiftKey === !!shortcut.shiftKey
	);
}

export function matchesKeyboardShortcut(
	event: KeyboardEvent,
	shortcut: KeyboardShortcut,
	platform = currentPlatform()
) {
	const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
	const shortcutKey =
		shortcut.key.length === 1 ? shortcut.key.toLowerCase() : shortcut.key;

	return key === shortcutKey && matchesModifier(event, shortcut, platform);
}

export function normalizedKeybinding(shortcut: KeyboardShortcut) {
	const key = shortcut.key.toLocaleLowerCase();
	const common = {
		altKey: !!shortcut.altKey,
		key,
		shiftKey: !!shortcut.shiftKey
	};

	if (shortcut.primaryKey) {
		return [
			JSON.stringify({...common, ctrlKey: false, metaKey: true}),
			JSON.stringify({...common, ctrlKey: true, metaKey: false})
		];
	}

	return [
		JSON.stringify({
			...common,
			ctrlKey: !!shortcut.ctrlKey,
			metaKey: !!shortcut.metaKey
		})
	];
}

export function labelForShortcut(
	shortcut: KeyboardShortcut,
	platform: Platform
) {
	const modifiers: string[] = [];
	const key =
		shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;

	if (shortcut.primaryKey) {
		modifiers.push(platform === 'mac' ? '⌘' : 'Ctrl');
	}

	if (shortcut.ctrlKey) {
		modifiers.push('Ctrl');
	}

	if (shortcut.metaKey) {
		modifiers.push(platform === 'mac' ? '⌘' : 'Meta');
	}

	if (shortcut.altKey) {
		modifiers.push(platform === 'mac' ? '⌥' : 'Alt');
	}

	if (shortcut.shiftKey) {
		modifiers.push(platform === 'mac' ? '⇧' : 'Shift');
	}

	return [...modifiers, key].join(' ');
}

export function keybindingForCommand(
	commandId: ShortcutCommandId,
	preset: KeybindingPreset
) {
	return shortcuts[preset][commandId];
}

export function shortcutLabel(
	commandId: ShortcutCommandId,
	preset: KeybindingPreset,
	platform = currentPlatform()
) {
	const shortcut = keybindingForCommand(commandId, preset);

	return shortcut ? labelForShortcut(shortcut, platform) : undefined;
}

export function commandIdForKeyboardEvent(
	event: KeyboardEvent,
	preset: KeybindingPreset,
	platform = currentPlatform()
) {
	if (event.isComposing) {
		return undefined;
	}
	if (editableTarget(event.target)) {
		return undefined;
	}

	for (const [commandId, shortcut] of Object.entries(shortcuts[preset])) {
		if (shortcut && matchesKeyboardShortcut(event, shortcut, platform)) {
			return commandId as ShortcutCommandId;
		}
	}

	return undefined;
}
