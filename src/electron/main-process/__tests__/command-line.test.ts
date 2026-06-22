import {
	commandLineHelpRequested,
	commandLineHelpText,
	commandLineOpenPaths,
	consumeCommandLineOpenPaths,
	queueCommandLineOpenPaths
} from '../command-line';

describe('command-line helpers', () => {
	afterEach(() => {
		consumeCommandLineOpenPaths();
	});

	it('detects help flags', () => {
		expect(commandLineHelpRequested(['--help'])).toBe(true);
		expect(commandLineHelpRequested(['-h'])).toBe(true);
		expect(commandLineHelpRequested(['story.twine.rs'])).toBe(false);
	});

	it('returns usage text with supported app prefs', () => {
		expect(commandLineHelpText()).toContain('Twine RS desktop');
		expect(commandLineHelpText()).toContain('Usage:');
		expect(commandLineHelpText()).toContain(
			'twine-rs [options] [project-folder...]'
		);
		expect(commandLineHelpText()).toContain('--backupCadenceMinutes=<minutes>');
		expect(commandLineHelpText()).toContain('project-folder');
	});

	it('resolves positional args as open paths', () => {
		expect(
			commandLineOpenPaths(
				['--backupCadenceMinutes=30', 'one.twine.rs', './two.twine.rs'],
				'/tmp/root'
			)
		).toEqual(['/tmp/root/one.twine.rs', '/tmp/root/two.twine.rs']);
	});

	it('does not treat app-pref values as open paths', () => {
		expect(
			commandLineOpenPaths(
				['--storyLibraryFolderPath', '/tmp/library', 'project.twine.rs'],
				'/tmp/root'
			)
		).toEqual(['/tmp/root/project.twine.rs']);
	});

	it('queues command-line open paths until consumed', () => {
		queueCommandLineOpenPaths(['/tmp/one.twine.rs', '/tmp/two.twine.rs']);
		queueCommandLineOpenPaths(['/tmp/one.twine.rs']);

		expect(consumeCommandLineOpenPaths()).toEqual([
			'/tmp/one.twine.rs',
			'/tmp/two.twine.rs'
		]);
		expect(consumeCommandLineOpenPaths()).toEqual([]);
	});
});
