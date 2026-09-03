import {
	commandPaletteKeybinding,
	normalizedKeybinding,
	type KeyboardShortcut
} from './keyboard-shortcuts';

export type AppCommandGroup = 'Navigation' | 'Build' | 'Story' | 'Toolbar';

export interface AppCommandExecutionContext {
	/** Restores the element that opened the palette, if it is still mounted. */
	restoreFocus: () => void;
}

export interface AppCommand {
	disabled?: boolean;
	disabledReason?: string;
	group: AppCommandGroup;
	icon?: string;
	id: string;
	keywords?: string[];
	keybinding?: KeyboardShortcut;
	label: string;
	/** Higher values are shown first. */
	priority?: number;
	run: (context?: AppCommandExecutionContext) => Promise<void> | void;
	/** Stable identity for the context represented by this row. */
	contextKey?: string;
	/** Explicit ordering within a priority. */
	order?: number;
	shortcut?: string;
}

export function commandIdSegment(value: string) {
	return `s-${Array.from(value, character =>
		character.codePointAt(0)?.toString(16)
	).join('-')}`;
}

export interface AppCommandContribution {
	commands: AppCommand[];
	getCommands?: () => AppCommand[];
	owner: string;
}

export function commandIsDisabled(command: AppCommand) {
	return Boolean(command.disabled || command.disabledReason);
}

const namespacedId = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const reservedKeybindings = new Set(
	normalizedKeybinding(commandPaletteKeybinding)
);

function normalizedShortcut(shortcut: string) {
	return shortcut.replace(/\s+/g, '').toLocaleLowerCase();
}

export function validateCommandContribution(
	contribution: AppCommandContribution
) {
	const ids = new Set<string>();
	const shortcuts = new Set<string>();
	const keybindings = new Set<string>();

	for (const command of contribution.commands) {
		if (!namespacedId.test(command.id)) {
			throw new Error(`Command id must be namespaced: ${command.id}`);
		}
		if (ids.has(command.id)) {
			throw new Error(`Duplicate command id: ${command.id}`);
		}
		ids.add(command.id);
		if (command.shortcut) {
			const shortcut = normalizedShortcut(command.shortcut);
			if (shortcuts.has(shortcut)) {
				throw new Error(`Duplicate command shortcut: ${command.shortcut}`);
			}
			shortcuts.add(shortcut);
		}
		if (command.keybinding) {
			for (const keybinding of normalizedKeybinding(command.keybinding)) {
				if (reservedKeybindings.has(keybinding)) {
					throw new Error(`Reserved command keybinding: ${command.id}`);
				}
				if (keybindings.has(keybinding))
					throw new Error(`Duplicate command keybinding: ${command.id}`);
				keybindings.add(keybinding);
			}
		}
	}
}

/** Combines the shell's canonical commands with lifecycle contributions. */
export function composeAppCommands(
	baseCommands: AppCommand[],
	contributions: Iterable<AppCommandContribution>
) {
	const entries = [
		{commands: baseCommands, owner: 'app-shell'},
		...Array.from(contributions)
	];
	const ids = new Set<string>();
	const shortcuts = new Set<string>();
	const keybindings = new Set<string>();
	const commands: Array<AppCommand & {__index: number; __owner: string}> = [];

	for (const entry of entries) {
		validateCommandContribution(entry);
		for (const command of entry.commands) {
			if (ids.has(command.id))
				throw new Error(`Duplicate command id: ${command.id}`);
			ids.add(command.id);
			if (command.shortcut) {
				const shortcut = normalizedShortcut(command.shortcut);
				if (shortcuts.has(shortcut)) {
					throw new Error(`Duplicate command shortcut: ${command.shortcut}`);
				}
				shortcuts.add(shortcut);
			}
			if (command.keybinding) {
				for (const keybinding of normalizedKeybinding(command.keybinding)) {
					if (reservedKeybindings.has(keybinding)) {
						throw new Error(`Reserved command keybinding: ${command.id}`);
					}
					if (keybindings.has(keybinding))
						throw new Error(`Duplicate command keybinding: ${command.id}`);
					keybindings.add(keybinding);
				}
			}
			commands.push({
				...command,
				disabled: commandIsDisabled(command),
				__index: commands.length,
				__owner: entry.owner
			});
		}
	}

	return commands
		.sort((left, right) => {
			const priority = (right.priority ?? 0) - (left.priority ?? 0);
			if (priority) return priority;
			if (left.order !== undefined || right.order !== undefined) {
				const order =
					(left.order ?? Number.MAX_SAFE_INTEGER) -
					(right.order ?? Number.MAX_SAFE_INTEGER);
				if (order) return order;
			}
			if (left.order === undefined && right.order === undefined) {
				return left.__index - right.__index;
			}
			return (
				left.__owner.localeCompare(right.__owner) ||
				left.id.localeCompare(right.id)
			);
		})
		.map(({__index: internalIndex, __owner: internalOwner, ...command}) => {
			void internalIndex;
			void internalOwner;
			return command;
		});
}

export function commandMatches(command: AppCommand, query: string) {
	const normalizedQuery = query.trim().toLocaleLowerCase();

	if (!normalizedQuery) {
		return true;
	}

	const haystack = [
		command.group,
		command.id,
		command.label,
		...(command.keywords ?? [])
	]
		.join(' ')
		.toLocaleLowerCase();

	return normalizedQuery.split(/\s+/).every(part => haystack.includes(part));
}
