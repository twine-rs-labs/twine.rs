import * as React from 'react';
import {useParams} from 'react-router-dom';
import {
	Badge,
	Button,
	Panel,
	Select,
	TablerIcon
} from '../../components/design-system';
import {
	diagnosticDismissalsChangedEvent,
	diagnosticIdentity,
	loadDismissedDiagnosticIds,
	useCoreProjectHost
} from '../../core';
import {FormatLoader} from '../../store/format-loader';
import {
	formatWithNameAndVersion,
	StoryFormatProperties,
	useStoryFormatsContext
} from '../../store/story-formats';
import {Story, useStoriesContext} from '../../store/stories';
import {usePublishing} from '../../store/use-publishing';
import {useStoryLaunch} from '../../store/use-story-launch';
import {
	StoryBuildPackage,
	StoryBuildTarget,
	StoryBuildFile
} from '../../util/build-package';
import {
	inspectStoryFormatPublishSafety,
	storyFormatCapabilities
} from '../../util/story-format';
import {saveFile} from '../../util/save-file';
import './build-route.css';

type TargetGroup = 'Export' | 'Run';

interface BuildTargetDefinition {
	description: string;
	group: TargetGroup;
	icon: string;
	label: string;
	target: StoryBuildTarget;
}

interface BuildLogEntry {
	line: string;
	time: string;
}

const buildTargets: BuildTargetDefinition[] = [
	{
		description: 'Launch an app-owned iframe preview using the story runtime.',
		group: 'Run',
		icon: 'player-play',
		label: 'Play',
		target: 'play'
	},
	{
		description: 'Launch with debug output and a selected starting passage.',
		group: 'Run',
		icon: 'tool',
		label: 'Test From Selection',
		target: 'test'
	},
	{
		description: 'Build the proofing format for review and editing passes.',
		group: 'Run',
		icon: 'book',
		label: 'Proof',
		target: 'proof'
	},
	{
		description: 'Single-file runtime HTML for sharing or publishing.',
		group: 'Export',
		icon: 'file-code',
		label: 'Export HTML',
		target: 'export-html'
	},
	{
		description: 'Readable Twee source with standard Twine metadata.',
		group: 'Export',
		icon: 'file-text',
		label: 'Export Twee',
		target: 'export-twee'
	},
	{
		description:
			'Normal Twine HTML plus Twee without the twine.rs StoryData graph carrier.',
		group: 'Export',
		icon: 'file-import',
		label: 'Compatibility Export',
		target: 'compatibility-export'
	},
	{
		description: 'Current app story JSON for tooling and inspection.',
		group: 'Export',
		icon: 'braces',
		label: 'Export JSON',
		target: 'export-json'
	},
	{
		description: 'Text report for generated HTML structure and publish markers.',
		group: 'Export',
		icon: 'search',
		label: 'Inspect HTML',
		target: 'inspect-html'
	},
	{
		description: 'Text report for source structure, passages, and metadata.',
		group: 'Export',
		icon: 'list-details',
		label: 'Inspect Source',
		target: 'inspect-source'
	},
	{
		description:
			'Archive descriptor plus HTML, JSON, project-fidelity Twee, and assets.',
		group: 'Export',
		icon: 'file-zip',
		label: 'Package',
		target: 'package'
	},
	{
		description: 'Publish-bound HTML with strict dev-code safety checks.',
		group: 'Export',
		icon: 'upload',
		label: 'Publish',
		target: 'publish'
	}
];

const publishBoundTargets: StoryBuildTarget[] = [
	'publish',
	'export-html',
	'compatibility-export',
	'package'
];

function targetDefinition(target: StoryBuildTarget) {
	return buildTargets.find(definition => definition.target === target)!;
}

function storyForId(stories: Story[], storyId: string | undefined) {
	return stories.find(story => story.id === storyId);
}

function formatStatusLabel(formatProperties?: StoryFormatProperties) {
	if (!formatProperties) {
		return 'Format loading';
	}

	const capabilities = storyFormatCapabilities(formatProperties);

	return capabilities.publishSafe ? 'Publish safe' : 'Review required';
}

function outputToSave(build: StoryBuildPackage): StoryBuildFile | undefined {
	return (
		build.files.find(file => file.role === 'primary') ??
		build.files.find(file => file.role === 'manifest') ??
		build.files[0]
	);
}

function bytesLabel(bytes: number) {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function logTime() {
	return new Date().toLocaleTimeString([], {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
}

export const BuildRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const {stories} = useStoriesContext();
	const story = storyForId(stories, storyId);
	const coreProjectHost = useCoreProjectHost();
	const {formats} = useStoryFormatsContext();
	const {proofStoryPackage, publishStoryPackage} = usePublishing();
	const {playStory, proofStory, testStory} = useStoryLaunch();
	const [target, setTarget] = React.useState<StoryBuildTarget>('export-html');
	const [startPassageId, setStartPassageId] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string>();
	const [build, setBuild] = React.useState<StoryBuildPackage>();
	const [logs, setLogs] = React.useState<BuildLogEntry[]>([
		{
			line: 'Build surface ready. Choose a target to validate outputs.',
			time: logTime()
		}
	]);
	const [dismissalsVersion, setDismissalsVersion] = React.useState(0);
	const definition = targetDefinition(target);
	const storyIndex = React.useMemo(
		() => (story ? coreProjectHost.queryStoryIndex(story.id) : undefined),
		[coreProjectHost, story]
	);
	const dismissedDiagnosticIds = React.useMemo(
		() => (story ? loadDismissedDiagnosticIds(story.id) : new Set<string>()),
		[dismissalsVersion, story]
	);
	const format = React.useMemo(() => {
		if (!story) {
			return undefined;
		}

		try {
			return formatWithNameAndVersion(
				formats,
				story.storyFormat,
				story.storyFormatVersion
			);
		} catch {
			return undefined;
		}
	}, [formats, story]);
	const formatProperties =
		format?.loadState === 'loaded' ? format.properties : undefined;
	const capabilities = formatProperties
		? storyFormatCapabilities(formatProperties)
		: undefined;
	const safety = formatProperties
		? inspectStoryFormatPublishSafety(formatProperties)
		: undefined;
	const safetyIssues =
		publishBoundTargets.includes(target) && safety ? safety.issues : [];
	const missingAssets =
		storyIndex?.assetInventory
			.filter(asset => asset.missing)
			.map(asset => asset.path) ?? [];
	const diagnostics =
		storyIndex?.diagnostics.filter(
			diagnostic => !dismissedDiagnosticIds.has(diagnosticIdentity(diagnostic))
		) ?? [];
	const dismissedDiagnosticCount =
		(storyIndex?.diagnostics.length ?? 0) - diagnostics.length;
	const errorDiagnostics = diagnostics.filter(
		diagnostic => diagnostic.severity === 'error'
	);
	const buildWarningDiagnosticCount =
		build?.report.diagnostics.filter(
			diagnostic => diagnostic.severity === 'warning'
		).length ?? 0;
	const blockingIssueCount =
		errorDiagnostics.length +
		safetyIssues.filter(issue => issue.severity === 'error').length +
		(build?.report.diagnostics.filter(
			diagnostic => diagnostic.severity === 'error'
		).length ?? 0);
	const startPassageOptions =
		story?.passages.map(passage => ({
			label: passage.name,
			value: passage.id
		})) ?? [];

	React.useEffect(() => {
		if (!story) {
			return;
		}

		setStartPassageId(story.startPassage || story.passages[0]?.id || '');
	}, [story]);

	React.useEffect(() => {
		function handleDismissalsChanged() {
			setDismissalsVersion(version => version + 1);
		}

		window.addEventListener(
			diagnosticDismissalsChangedEvent,
			handleDismissalsChanged
		);

		return () =>
			window.removeEventListener(
				diagnosticDismissalsChangedEvent,
				handleDismissalsChanged
			);
	}, []);

	const appendLog = React.useCallback((line: string) => {
		setLogs(current => [...current.slice(-80), {line, time: logTime()}]);
	}, []);

	const buildSelectedTarget = React.useCallback(async () => {
		if (!story) {
			throw new Error('No story is selected.');
		}

		if (target === 'proof') {
			return proofStoryPackage(story.id);
		}

		return publishStoryPackage(story.id, {
			buildTarget: target,
			formatOptions: target === 'test' ? 'debug' : undefined,
			startId: target === 'test' ? startPassageId : undefined
		});
	}, [proofStoryPackage, publishStoryPackage, startPassageId, story, target]);

	const prepareBuild = React.useCallback(async () => {
		setBusy(true);
		setError(undefined);
		appendLog(`Preparing ${definition.label}.`);

		try {
			const nextBuild = await buildSelectedTarget();

			setBuild(nextBuild);
			appendLog(
				`Prepared ${nextBuild.files.length} output file(s), ${nextBuild.assets.length} asset plan item(s).`
			);
			if (nextBuild.report.diagnostics.length > 0) {
				appendLog(
					`${nextBuild.report.diagnostics.length} build diagnostic(s) promoted into the report.`
				);
			}
			return nextBuild;
		} catch (error) {
			const message = (error as Error).message;

			setError(message);
			appendLog(`Failed: ${message}`);
			throw error;
		} finally {
			setBusy(false);
		}
	}, [appendLog, buildSelectedTarget, definition.label]);

	const runTarget = React.useCallback(async () => {
		if (!story) {
			return;
		}

		try {
			await prepareBuild();

			if (target === 'play') {
				await playStory(story.id);
				appendLog('Opened Play preview.');
			} else if (target === 'test') {
				await testStory(story.id, startPassageId);
				appendLog('Opened Test preview.');
			} else if (target === 'proof') {
				await proofStory(story.id);
				appendLog('Opened Proof preview.');
			}
		} catch {
			// prepareBuild already recorded the error.
		}
	}, [
		appendLog,
		playStory,
		prepareBuild,
		proofStory,
		startPassageId,
		story,
		target,
		testStory
	]);

	const savePreparedOutput = React.useCallback(async () => {
		try {
			const nextBuild = await prepareBuild();
			const file = outputToSave(nextBuild);

			if (file) {
				saveFile(file.contents, file.filename, file.mediaType);
				appendLog(`Saved ${file.filename}.`);
			}
		} catch {
			// prepareBuild already recorded the error.
		}
	}, [appendLog, prepareBuild]);

	if (!story) {
		return (
			<div className="build-route__empty">
				No story exists for this Build route.
			</div>
		);
	}

	return (
		<FormatLoader block={false}>
			<div className="build-route">
				<aside className="build-route__targets" aria-label="Build targets">
					<div className="build-route__target-group">Run</div>
					{buildTargets
						.filter(candidate => candidate.group === 'Run')
						.map(candidate => (
							<button
								aria-current={candidate.target === target}
								className="build-route__target"
								key={candidate.target}
								onClick={() => setTarget(candidate.target)}
								type="button"
							>
								<TablerIcon
									className="build-route__target-icon"
									icon={candidate.icon}
								/>
								<span>{candidate.label}</span>
								<span
									className="build-route__target-dot"
									style={{background: 'var(--sem-saved)'}}
								/>
							</button>
						))}
					<div className="build-route__target-group">Export</div>
					{buildTargets
						.filter(candidate => candidate.group === 'Export')
						.map(candidate => {
							const risky =
								publishBoundTargets.includes(candidate.target) &&
								!!safety?.issues.length;

							return (
								<button
									aria-current={candidate.target === target}
									className="build-route__target"
									key={candidate.target}
									onClick={() => setTarget(candidate.target)}
									type="button"
								>
									<TablerIcon
										className="build-route__target-icon"
										icon={candidate.icon}
									/>
									<span>{candidate.label}</span>
									<span
										className="build-route__target-dot"
										style={{
											background: risky ? 'var(--sem-warn)' : 'var(--acc-blue)'
										}}
									/>
								</button>
							);
						})}
				</aside>
				<div className="build-route__main">
					<div className="build-route__detail">
						<div>
							<div className="build-route__hero">
								<div className="build-route__hero-icon">
									<TablerIcon icon={definition.icon} />
								</div>
								<div>
									<h1>{definition.label}</h1>
									<p>{definition.description}</p>
								</div>
							</div>

							<div className="build-route__warning-list">
								{error && (
									<div className="build-route__warning build-route__warning--error">
										<TablerIcon
											className="build-route__warning-icon"
											icon="alert-octagon"
										/>
										<div>
											<div className="build-route__warning-title">
												Last build failed
											</div>
											<div className="build-route__warning-detail">{error}</div>
										</div>
									</div>
								)}
								{blockingIssueCount > 0 && (
									<div className="build-route__warning build-route__warning--error">
										<TablerIcon
											className="build-route__warning-icon"
											icon="alert-octagon"
										/>
										<div>
											<div className="build-route__warning-title">
												{blockingIssueCount} blocker
												{blockingIssueCount === 1 ? '' : 's'} before publish
											</div>
											<div className="build-route__warning-detail">
												Resolve active error diagnostics or publish-safety
												errors before shipping this target.
											</div>
										</div>
									</div>
								)}
								{missingAssets.length > 0 && (
									<div className="build-route__warning">
										<TablerIcon
											className="build-route__warning-icon"
											icon="alert-triangle"
										/>
										<div>
											<div className="build-route__warning-title">
												{missingAssets.length} missing asset
												{missingAssets.length === 1 ? '' : 's'}
											</div>
											<div className="build-route__warning-detail">
												{missingAssets.slice(0, 3).join(', ')}
											</div>
										</div>
									</div>
								)}
								{buildWarningDiagnosticCount > 0 && (
									<div className="build-route__warning">
										<TablerIcon
											className="build-route__warning-icon"
											icon="alert-triangle"
										/>
										<div>
											<div className="build-route__warning-title">
												Build diagnostics need review
											</div>
											<div className="build-route__warning-detail">
												{buildWarningDiagnosticCount} warning
												{buildWarningDiagnosticCount === 1 ? '' : 's'} were
												promoted into the package report.
											</div>
										</div>
									</div>
								)}
							</div>

							<div className="build-route__section-title">Output</div>
							<div className="build-route__option-grid">
								<div className="build-route__option">
									<span>Story</span>
									<b>{story.name}</b>
								</div>
								<div className="build-route__option">
									<span>Format</span>
									<b>
										{story.storyFormat} {story.storyFormatVersion}
									</b>
								</div>
								<div className="build-route__option">
									<span>Format status</span>
									<b>{formatStatusLabel(formatProperties)}</b>
								</div>
								<div className="build-route__option">
									<span>Diagnostics</span>
									<b>
										{diagnostics.length}
										{dismissedDiagnosticCount > 0 &&
											` (${dismissedDiagnosticCount} dismissed)`}
									</b>
								</div>
								<div className="build-route__option">
									<span>Asset plan</span>
									<b>
										{build?.assets.length ??
											storyIndex?.assetInventory.length ??
											0}
									</b>
								</div>
								<div className="build-route__option">
									<span>Prepared size</span>
									<b>
										{build
											? bytesLabel(
													build.files.reduce(
														(total, file) => total + file.sizeBytes,
														0
													)
												)
											: 'Not built'}
									</b>
								</div>
							</div>

							{target === 'test' && (
								<>
									<div className="build-route__section-title">
										Test start passage
									</div>
									<Select
										ariaLabel="Test start passage"
										onChange={setStartPassageId}
										options={startPassageOptions}
										value={startPassageId}
									/>
								</>
							)}

							<div className="build-route__actions">
								{['play', 'test', 'proof'].includes(target) ? (
									<Button
										icon={definition.icon}
										loading={busy}
										onClick={runTarget}
										variant="primary"
									>
										Run {definition.label}
									</Button>
								) : (
									<Button
										icon="download"
										loading={busy}
										onClick={savePreparedOutput}
										variant="primary"
									>
										Build and Save
									</Button>
								)}
								<Button icon="check" loading={busy} onClick={prepareBuild}>
									Prepare Report
								</Button>
							</div>
						</div>

						<div className="build-route__side">
							<Panel icon="components" pad title="Format Capabilities">
								<div className="build-route__badge-row">
									{capabilities ? (
										Object.entries({
											Parser: capabilities.parser,
											Exporter: capabilities.exporter,
											Syntax: capabilities.syntax,
											Autocomplete: capabilities.autocomplete,
											Diagnostics: capabilities.diagnostics,
											Devtools: capabilities.devtoolsPanels,
											'Editor UI': capabilities.editorToolbarActions,
											'Publish safe': capabilities.publishSafe
										}).map(([label, enabled]) => (
											<Badge
												icon={enabled ? 'check' : 'minus'}
												key={label}
												tone={enabled ? 'saved' : 'neutral'}
											>
												{label}
											</Badge>
										))
									) : (
										<Badge icon="clock">Loading format</Badge>
									)}
								</div>
							</Panel>
							<Panel icon="file-text" pad title="Fidelity Boundary">
								<div className="build-route__section-title">Preserves</div>
								<ul className="build-route__fidelity-list">
									{(
										build?.report.fidelity.preserves ?? [
											'Build once to inspect exact preserved data.'
										]
									).map(item => (
										<li key={item}>{item}</li>
									))}
								</ul>
								<div className="build-route__section-title">Omits</div>
								<ul className="build-route__fidelity-list">
									{(
										build?.report.fidelity.omits ?? [
											'Build once to inspect target omissions.'
										]
									).map(item => (
										<li key={item}>{item}</li>
									))}
								</ul>
							</Panel>
							<Panel
								count={build?.files.length ?? 0}
								icon="file-code"
								pad
								title="Prepared Outputs"
							>
								<ul className="build-route__output-list">
									{build?.files.length ? (
										build.files.map(file => (
											<li key={`${file.filename}-${file.kind}`}>
												<b>{file.filename}</b>
												<span>
													{file.kind} · {file.role} ·{' '}
													{bytesLabel(file.sizeBytes)}
												</span>
											</li>
										))
									) : (
										<li>No output prepared yet.</li>
									)}
								</ul>
							</Panel>
							<Panel
								count={build?.report.diagnostics.length ?? 0}
								icon="alert-triangle"
								pad
								title="Build Diagnostics"
							>
								<ul className="build-route__output-list">
									{build?.report.diagnostics.length ? (
										build.report.diagnostics.map((diagnostic, index) => (
											<li key={`${diagnostic.code}-${index}`}>
												<b>{diagnostic.code}</b>
												<span>
													{diagnostic.severity} · {diagnostic.message}
												</span>
											</li>
										))
									) : (
										<li>No build diagnostics prepared yet.</li>
									)}
								</ul>
							</Panel>
						</div>
					</div>
					<div className="build-route__log">
						<div className="build-route__log-head">
							<span className="build-route__log-title">Build Output</span>
							<span className="build-route__log-spacer" />
							<Button
								icon="trash"
								onClick={() => setLogs([])}
								size="sm"
								variant="ghost"
							>
								Clear
							</Button>
						</div>
						<div className="build-route__log-body">
							{logs.map((entry, index) => (
								<div
									className="build-route__log-line"
									key={`${entry.line}-${index}`}
								>
									<span className="build-route__log-time">{entry.time}</span>
									<span>{entry.line}</span>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</FormatLoader>
	);
};
