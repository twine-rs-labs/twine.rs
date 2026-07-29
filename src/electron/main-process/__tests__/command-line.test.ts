import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
	commandLineHelpRequested,
	commandLineHelpText,
	commandLineOpenPaths,
	consumeCommandLineOpenPaths,
	parseCommandLine,
	queueCommandLineOpenPaths,
	setCommandLineOpenRequestNotifier
} from '../command-line';

describe('command-line helpers', () => {
	afterEach(() => {
		consumeCommandLineOpenPaths();
		setCommandLineOpenRequestNotifier(undefined);
	});

	it('detects help flags', () => {
		expect(commandLineHelpRequested(['--help'])).toBe(true);
		expect(commandLineHelpRequested(['-h'])).toBe(true);
		expect(commandLineHelpRequested(['story.twine.rs'])).toBe(false);
	});

	it('only exposes boolean options when explicitly provided', () => {
		expect(parseCommandLine([])).not.toHaveProperty(
			'disableHardwareAcceleration'
		);
		expect(parseCommandLine([])).not.toHaveProperty('help');
		expect(
			parseCommandLine(['--disableHardwareAcceleration'])
				.disableHardwareAcceleration
		).toBe(true);
		expect(
			parseCommandLine(['--disableHardwareAcceleration=false'])
				.disableHardwareAcceleration
		).toBe(false);
	});

	it('returns usage text with supported app prefs', () => {
		const helpText = commandLineHelpText();

		expect(helpText).toContain('Twine RS desktop');
		expect(helpText).toContain('Usage:');
		expect(helpText).toContain('twine-rs [options] [project-folder...]');
		expect(helpText).toContain('Deprecated compatibility option; ignored.');
		expect(helpText).toContain('project-folder');
		expect(helpText).toContain('(5–1440 minutes)');
		expect(helpText).toContain('(1–500 backups)');
		expect(helpText).toContain('--help, -h');
	});

	it('keeps the canonical desktop guide aligned with help and package names', () => {
		const repositoryRoot = resolve(__dirname, '../../../..');
		const guide = readFileSync(
			resolve(repositoryRoot, 'docs/user/desktop-command-line.md'),
			'utf8'
		);
		const platformDecision = readFileSync(
			resolve(
				repositoryRoot,
				'docs/decisions/0005-platform-and-distribution.md'
			),
			'utf8'
		);
		const packageJson = JSON.parse(
			readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8')
		) as {name: string; productName: string};

		expect(guide).toContain(`\`\`\`text\n${commandLineHelpText()}\n\`\`\``);
		expect(guide).toContain(
			`"/Applications/${packageJson.productName}.app/Contents/MacOS/${packageJson.productName}" --help`
		);
		expect(guide).toContain(
			`& "C:\\Program Files\\${packageJson.productName}\\${packageJson.productName}.exe" --help`
		);
		expect(guide).toContain(`${packageJson.name} --help`);
		expect(platformDecision).toContain(
			`\`${packageJson.name}\` is the generated\nusage name and Linux packaged executable`
		);
		expect(platformDecision).toContain(
			`macOS packaged executable is\n\`${packageJson.productName}\` inside \`${packageJson.productName}.app\``
		);
		expect(platformDecision).toContain(
			`Windows packaged executable is\n\`${packageJson.productName}.exe\``
		);
		expect(platformDecision).toContain(
			'platform executable with `--help` or `-h`'
		);
		expect(platformDecision).not.toContain('`twine --help`');
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
		expect(
			commandLineOpenPaths(
				['--scratchAssetStrategy', 'copy', 'project.twine.rs'],
				'/tmp/root'
			)
		).toEqual(['/tmp/root/project.twine.rs']);
		expect(
			commandLineOpenPaths(
				['--scratchAssetStrategy=link', 'project.twine.rs'],
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

	it('notifies the renderer when a new open request is queued after startup', () => {
		const notify = jest.fn();

		queueCommandLineOpenPaths(['/tmp/startup.twine.rs']);
		setCommandLineOpenRequestNotifier(notify);
		queueCommandLineOpenPaths(['/tmp/finder.twine.rs']);

		expect(notify).toHaveBeenCalledTimes(1);
		expect(consumeCommandLineOpenPaths()).toEqual([
			'/tmp/startup.twine.rs',
			'/tmp/finder.twine.rs'
		]);
	});
});
