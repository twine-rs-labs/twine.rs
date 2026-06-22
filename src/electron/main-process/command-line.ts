import minimist from 'minimist';
import {resolve} from 'path';

const pendingOpenPaths = new Set<string>();

const minimistOptions = {
	alias: {h: 'help'},
	boolean: ['disableHardwareAcceleration', 'help'],
	string: [
		'backupCadenceMinutes',
		'backupFolderPath',
		'backupRetentionLimit',
		'scratchFileCleanupAge',
		'scratchFolderPath',
		'storyLibraryFolderPath'
	]
};

function parseCommandLine(argv: string[]) {
	return minimist(argv, minimistOptions);
}

export function commandLineHelpRequested(argv: string[]) {
	const args = parseCommandLine(argv);

	return !!args.help;
}

export function commandLineHelpText(appName = 'Twine RS') {
	return [
		`${appName} desktop`,
		'',
		'Usage:',
		'  twine-rs [options] [project-folder...]',
		'',
		'Options:',
		'  --help, -h                         Show this help text.',
		'  --storyLibraryFolderPath=<path>     Use a custom story library folder.',
		'  --backupFolderPath=<path>           Use a custom backup folder.',
		'  --backupCadenceMinutes=<minutes>    Set scheduled backup cadence.',
		'  --backupRetentionLimit=<count>      Set scheduled backup retention.',
		'  --scratchFolderPath=<path>          Use a custom preview/cache folder.',
		'  --scratchFileCleanupAge=<minutes>   Set preview/cache cleanup age.',
		'  --disableHardwareAcceleration       Disable hardware acceleration.',
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
	for (const path of paths) {
		if (path.trim() !== '') {
			pendingOpenPaths.add(resolve(path));
		}
	}
}

export function consumeCommandLineOpenPaths() {
	const paths = [...pendingOpenPaths];

	pendingOpenPaths.clear();

	return paths;
}
