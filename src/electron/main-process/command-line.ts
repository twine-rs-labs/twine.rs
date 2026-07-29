import minimist from 'minimist';
import {resolve} from 'path';

const pendingOpenPaths = new Set<string>();
let commandLineOpenRequestNotifier: (() => void) | undefined;

interface CommandLineOption {
	aliases?: string[];
	appPrefOverride: boolean;
	bounds?: {
		max: number;
		min: number;
		unit: string;
	};
	deprecated?: boolean;
	description: string;
	name: string;
	type: 'boolean' | 'string';
	valueSyntax?: string;
}

export const commandLineOptions: CommandLineOption[] = [
	{
		aliases: ['h'],
		appPrefOverride: false,
		description: 'Show this help text',
		name: 'help',
		type: 'boolean'
	},
	{
		appPrefOverride: true,
		description: 'Use a custom story library folder',
		name: 'storyLibraryFolderPath',
		type: 'string',
		valueSyntax: '=<path>'
	},
	{
		appPrefOverride: true,
		description: 'Use a custom backup folder',
		name: 'backupFolderPath',
		type: 'string',
		valueSyntax: '=<path>'
	},
	{
		appPrefOverride: true,
		bounds: {max: 1440, min: 5, unit: 'minutes'},
		description: 'Set scheduled backup cadence',
		name: 'backupCadenceMinutes',
		type: 'string',
		valueSyntax: '=<minutes>'
	},
	{
		appPrefOverride: true,
		bounds: {max: 500, min: 1, unit: 'backups'},
		description: 'Set scheduled backup retention',
		name: 'backupRetentionLimit',
		type: 'string',
		valueSyntax: '=<count>'
	},
	{
		appPrefOverride: false,
		deprecated: true,
		description: 'compatibility option; ignored',
		name: 'scratchAssetStrategy',
		type: 'string',
		valueSyntax: '=<link|copy>'
	},
	{
		appPrefOverride: true,
		description: 'Use a custom preview/cache folder',
		name: 'scratchFolderPath',
		type: 'string',
		valueSyntax: '=<path>'
	},
	{
		appPrefOverride: true,
		description: 'Set preview/cache cleanup age',
		name: 'scratchFileCleanupAge',
		type: 'string',
		valueSyntax: '=<minutes>'
	},
	{
		appPrefOverride: true,
		description: 'Disable hardware acceleration',
		name: 'disableHardwareAcceleration',
		type: 'boolean'
	}
];

export const commandLineAppPrefOverrideNames: readonly string[] = Object.freeze(
	commandLineOptions
		.filter(option => option.appPrefOverride)
		.map(option => option.name)
);

const minimistOptions = {
	alias: Object.fromEntries(
		commandLineOptions.flatMap(
			option => option.aliases?.map(alias => [alias, option.name]) ?? []
		)
	),
	boolean: commandLineOptions
		.filter(option => option.type === 'boolean')
		.map(option => option.name),
	string: commandLineOptions
		.filter(option => option.type === 'string')
		.map(option => option.name)
};

function optionWasProvided(argv: string[], option: CommandLineOption) {
	const longPrefix = `--${option.name}`;
	const aliases = option.aliases ?? [];

	return argv.some(
		arg =>
			arg === longPrefix ||
			arg.startsWith(`${longPrefix}=`) ||
			aliases.some(alias => arg === `-${alias}`)
	);
}

export function parseCommandLine(argv: string[]) {
	const parsed = minimist(argv, minimistOptions);

	// minimist supplies false for every absent boolean. Remove those defaults so
	// callers can distinguish "not provided" from an explicit false value.
	for (const option of commandLineOptions) {
		if (option.type === 'boolean' && !optionWasProvided(argv, option)) {
			delete parsed[option.name];

			for (const alias of option.aliases ?? []) {
				delete parsed[alias];
			}
		}
	}

	return parsed;
}

export function commandLineHelpRequested(argv: string[]) {
	const args = parseCommandLine(argv);

	return !!args.help;
}

export function commandLineHelpText(appName = 'Twine RS') {
	const labels = commandLineOptions.map(option =>
		[
			`--${option.name}${option.valueSyntax ?? ''}`,
			...(option.aliases?.map(alias => `-${alias}`) ?? [])
		].join(', ')
	);
	const labelWidth = Math.max(...labels.map(label => label.length)) + 2;
	const optionLines = commandLineOptions.map((option, index) => {
		const bounds = option.bounds
			? ` (${option.bounds.min}–${option.bounds.max} ${option.bounds.unit})`
			: '';
		const deprecated = option.deprecated ? 'Deprecated ' : '';

		return `  ${labels[index].padEnd(labelWidth)}${deprecated}${option.description}${bounds}.`;
	});

	return [
		`${appName} desktop`,
		'',
		'Usage:',
		'  twine-rs [options] [project-folder...]',
		'',
		'Options:',
		...optionLines,
		'',
		'Open:',
		'  Pass one or more .twine.rs project folders to open them on startup.'
	].join('\n');
}

export function commandLineOpenPaths(argv: string[], cwd = process.cwd()) {
	const args = parseCommandLine(argv);

	return args._.filter((value): value is string => typeof value === 'string')
		.filter(value => value.trim() !== '')
		.map(value => resolve(cwd, value));
}

export function queueCommandLineOpenPaths(paths: string[]) {
	let queuedPath = false;

	for (const path of paths) {
		if (path.trim() !== '') {
			pendingOpenPaths.add(resolve(path));
			queuedPath = true;
		}
	}

	if (queuedPath) {
		commandLineOpenRequestNotifier?.();
	}
}

export function setCommandLineOpenRequestNotifier(
	notifier: (() => void) | undefined
) {
	commandLineOpenRequestNotifier = notifier;
}

export function consumeCommandLineOpenPaths() {
	const paths = [...pendingOpenPaths];

	pendingOpenPaths.clear();

	return paths;
}
