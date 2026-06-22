export type AppCommandGroup = 'Navigation' | 'Build' | 'Story' | 'Toolbar';

export interface AppCommand {
	disabled?: boolean;
	group: AppCommandGroup;
	icon?: string;
	id: string;
	keywords?: string[];
	label: string;
	run: () => Promise<void> | void;
	shortcut?: string;
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
