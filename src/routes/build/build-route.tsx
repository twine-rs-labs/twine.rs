import * as React from 'react';
import {useHistory, useParams} from 'react-router-dom';
import {
	Badge,
	Button,
	IconButton,
	SegmentedControl,
	Select,
	Switch,
	TablerIcon
} from '../../components/design-system';
import {
	diagnosticDismissalsChangedEvent,
	diagnosticIdentity,
	loadDismissedDiagnosticIds,
	useCoreProjectHost
} from '../../core';
import type {CoreStoryIndex} from '../../core';
import {FormatLoader} from '../../store/format-loader';
import {
	formatWithNameAndVersion,
	type StoryFormat,
	type StoryFormatProperties,
	useStoryFormatsContext
} from '../../store/story-formats';
import {type Story, useStoriesContext} from '../../store/stories';
import {
	type ProofingFormatSelection,
	usePublishing
} from '../../store/use-publishing';
import {useStoryLaunch} from '../../store/use-story-launch';
import type {
	StoryBuildFile,
	StoryBuildPackage,
	StoryBuildTarget
} from '../../util/build-package';
import {saveFile} from '../../util/save-file';
import {
	inspectStoryFormatPublishSafety,
	storyFormatCapabilities
} from '../../util/story-format';
import {TWINE_RS_STORY_GRAPH_HTML_ATTRIBUTE} from '../../util/story-graph-metadata';
import {storyToTwee} from '../../util/twee';
import './build-route.css';

type BuildView = 'export' | 'preview';
type ExportFormat = 'html' | 'twee' | 'json' | 'archive';
type InspectTab = 'source' | 'html';
type PreviewAction = 'play' | 'proof';
type NoteTone = 'ok' | 'warn' | 'error' | 'info';

interface InlineAssetProfile {
	count: number;
	knownSizeBytes: number;
}

interface BuildLogEntry {
	line: string;
	time: string;
}

interface ExportFormatDefinition {
	description: string;
	format: ExportFormat;
	icon: string;
	label: string;
	sourceOnly: boolean;
}

interface BuildNote {
	actionLabel?: string;
	detail: string;
	dismissible?: boolean;
	icon: string;
	id: string;
	onAction?: () => void;
	title: string;
	tone: NoteTone;
}

interface ExportFormatOptions {
	htmlCompatibility: boolean;
	htmlInlineAssets: boolean;
	jsonPretty: boolean;
}

const exportFormats: ExportFormatDefinition[] = [
	{
		description: 'One self-contained file that plays in any browser.',
		format: 'html',
		icon: 'world',
		label: 'Playable HTML',
		sourceOnly: false
	},
	{
		description: 'Readable Twine source text with standard metadata.',
		format: 'twee',
		icon: 'file-text',
		label: 'Twee Source',
		sourceOnly: true
	},
	{
		description: 'Structured story data for tooling and version control.',
		format: 'json',
		icon: 'braces',
		label: 'JSON',
		sourceOnly: true
	},
	{
		description: 'The playable HTML, source, and asset plan together.',
		format: 'archive',
		icon: 'package',
		label: 'Archive (.zip)',
		sourceOnly: false
	}
];

const publishBoundTargets: StoryBuildTarget[] = [
	'publish',
	'export-html',
	'package'
];
const inlineAssetDefaultMaxCount = 25;
const inlineAssetDefaultMaxSizeBytes = 25 * 1024 * 1024;

function storyForId(stories: Story[], storyId: string | undefined) {
	return stories.find(story => story.id === storyId);
}

function exportDefinition(format: ExportFormat) {
	return exportFormats.find(definition => definition.format === format)!;
}

function targetForExport(format: ExportFormat): StoryBuildTarget {
	switch (format) {
		case 'html':
			return 'export-html';

		case 'twee':
			return 'export-twee';

		case 'json':
			return 'export-json';

		case 'archive':
			return 'package';
	}
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

function inlineAssetProfile(storyIndex?: CoreStoryIndex): InlineAssetProfile {
	const assets =
		storyIndex?.assetInventory.filter(
			asset => asset.publish.copy && asset.exists !== false && !asset.missing
		) ?? [];

	return {
		count: assets.length,
		knownSizeBytes: assets.reduce(
			(total, asset) => total + (asset.sizeBytes ?? 0),
			0
		)
	};
}

function shouldInlineAssetsByDefault(profile: InlineAssetProfile) {
	return (
		profile.count <= inlineAssetDefaultMaxCount &&
		profile.knownSizeBytes <= inlineAssetDefaultMaxSizeBytes
	);
}

function inlineAssetDefaultReason(profile: InlineAssetProfile) {
	const reasons = [];

	if (profile.count > inlineAssetDefaultMaxCount) {
		reasons.push(
			`${profile.count} exportable assets (limit ${inlineAssetDefaultMaxCount})`
		);
	}

	if (profile.knownSizeBytes > inlineAssetDefaultMaxSizeBytes) {
		reasons.push(
			`${bytesLabel(profile.knownSizeBytes)} of known asset data (limit ${bytesLabel(
				inlineAssetDefaultMaxSizeBytes
			)})`
		);
	}

	return reasons.join(' and ');
}

function logTime() {
	return new Date().toLocaleTimeString([], {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
}

function formatOptionValue(format: {name: string; version: string}): string {
	return JSON.stringify({name: format.name, version: format.version});
}

function proofingFormatFromValue(
	value: string,
	story?: Story
): ProofingFormatSelection | undefined {
	if (!value) {
		return story
			? {name: story.storyFormat, version: story.storyFormatVersion}
			: undefined;
	}

	try {
		const parsed = JSON.parse(value) as ProofingFormatSelection;

		if (parsed.name && parsed.version) {
			return parsed;
		}
	} catch {
		// Fall back to the story format below.
	}

	return story
		? {name: story.storyFormat, version: story.storyFormatVersion}
		: undefined;
}

function loadedFormats(formats: StoryFormat[]) {
	return formats.filter(
		(format): format is Extract<StoryFormat, {loadState: 'loaded'}> =>
			format.loadState === 'loaded'
	);
}

function proofingFormatOptions(formats: StoryFormat[], story?: Story) {
	const loaded = loadedFormats(formats);
	const proofing = loaded.filter(format => format.properties.proofing);
	const current = story
		? loaded.find(
				format =>
					format.name === story.storyFormat &&
					format.version === story.storyFormatVersion
			)
		: undefined;
	const candidates =
		proofing.length > 0 ? proofing : current ? [current] : loaded;
	const seen = new Set<string>();

	return candidates
		.filter(format => {
			const key = `${format.name}\u0000${format.version}`;

			if (seen.has(key)) {
				return false;
			}

			seen.add(key);
			return true;
		})
		.map(format => ({
			label: `${format.name} ${format.version}`,
			value: formatOptionValue(format)
		}));
}

function sourceInspection(story: Story, storyIndex?: CoreStoryIndex) {
	const start = story.passages.find(
		passage => passage.id === story.startPassage
	);
	const lines = [
		`story "${story.name}"`,
		`  format       ${story.storyFormat} ${story.storyFormatVersion}`,
		`  passages     ${story.passages.length}`,
		`  links        ${storyIndex?.graph.links ?? 0}`,
		`  assets       ${storyIndex?.assetInventory.length ?? 0}`,
		`  diagnostics  ${storyIndex?.diagnostics.length ?? 0}`,
		`  start        ${start?.name ?? 'not set'}`,
		'',
		'passages'
	];

	for (const passage of story.passages.slice(0, 24)) {
		lines.push(
			`  ${passage.name} - ${passage.text.length} chars - ${passage.tags.length} tags`
		);
	}

	if (story.passages.length > 24) {
		lines.push(`  ...${story.passages.length - 24} more passages`);
	}

	lines.push('', 'twee preview', storyToTwee(story).slice(0, 1400));

	return lines.join('\n');
}

function htmlInspection(build?: StoryBuildPackage) {
	if (!build?.html) {
		return [
			'No generated HTML is prepared yet.',
			'',
			'Use Export or Inspect output to build the current format first.'
		].join('\n');
	}

	const storyDataCount = (build.html.match(/<tw-storydata\b/g) ?? []).length;
	const passageCount = (build.html.match(/<tw-passagedata\b/g) ?? []).length;
	const hasStoryDataGraph = build.html.includes(
		`${TWINE_RS_STORY_GRAPH_HTML_ATTRIBUTE}=`
	);

	return [
		`generated ${build.report.generatedAt}`,
		`target ${build.report.target}`,
		`size ${bytesLabel(build.html.length)}`,
		`story data blocks ${storyDataCount}`,
		`passage data blocks ${passageCount}`,
		`twine.rs graph data ${hasStoryDataGraph ? 'present' : 'omitted'}`,
		'',
		'outputs',
		...build.files.map(
			file =>
				`  ${file.filename} - ${file.kind} - ${bytesLabel(file.sizeBytes)}`
		)
	].join('\n');
}

export const BuildRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const history = useHistory();
	const {stories} = useStoriesContext();
	const story = storyForId(stories, storyId);
	const coreProjectHost = useCoreProjectHost();
	const {formats} = useStoryFormatsContext();
	const {proofStoryPackage, publishStoryPackage} = usePublishing();
	const {playStory, proofStory} = useStoryLaunch();
	const [view, setView] = React.useState<BuildView>('export');
	const [exportFormat, setExportFormat] = React.useState<ExportFormat>('html');
	const [formatOptions, setFormatOptions] = React.useState<ExportFormatOptions>(
		{
			htmlInlineAssets: true,
			htmlCompatibility: false,
			jsonPretty: true
		}
	);
	const [inlineAssetsTouched, setInlineAssetsTouched] = React.useState(false);
	const [proofingFormatValue, setProofingFormatValue] = React.useState('');
	const [busyAction, setBusyAction] = React.useState<string>();
	const [error, setError] = React.useState<string>();
	const [build, setBuild] = React.useState<StoryBuildPackage>();
	const [inspectOpen, setInspectOpen] = React.useState(false);
	const [inspectTab, setInspectTab] = React.useState<InspectTab>('source');
	const [dismissedNoteIds, setDismissedNoteIds] = React.useState<Set<string>>(
		() => new Set()
	);
	const [logs, setLogs] = React.useState<BuildLogEntry[]>([]);
	const [dismissalsVersion, setDismissalsVersion] = React.useState(0);
	const [storyIndex, setStoryIndex] = React.useState<CoreStoryIndex>();
	const dismissedDiagnosticIds = React.useMemo(
		() => (story ? loadDismissedDiagnosticIds(story.id) : new Set<string>()),
		[dismissalsVersion, story]
	);

	const activeDefinition = exportDefinition(exportFormat);
	const activeTarget = targetForExport(exportFormat);
	const proofingOptions = React.useMemo(
		() => proofingFormatOptions(formats, story),
		[formats, story]
	);
	const selectedProofingFormat = React.useMemo(
		() => proofingFormatFromValue(proofingFormatValue, story),
		[proofingFormatValue, story]
	);
	const assetProfile = React.useMemo(
		() => inlineAssetProfile(storyIndex),
		[storyIndex]
	);
	const inlineAssetsDefault = shouldInlineAssetsByDefault(assetProfile);
	const inlineAssetsAutoDisabled =
		exportFormat === 'html' && !inlineAssetsDefault;
	const inlineAssetsAutoReason = inlineAssetDefaultReason(assetProfile);

	React.useEffect(() => {
		let active = true;

		if (!story) {
			setStoryIndex(undefined);
			return () => {
				active = false;
			};
		}

		setStoryIndex(undefined);

		void coreProjectHost.queryStoryIndexAsync(story.id).then(index => {
			if (active) {
				setStoryIndex(index);
			}
		});

		return () => {
			active = false;
		};
	}, [coreProjectHost, story]);

	React.useEffect(() => {
		if (
			proofingOptions.length > 0 &&
			!proofingOptions.some(option => option.value === proofingFormatValue)
		) {
			setProofingFormatValue(proofingOptions[0].value);
		}
	}, [proofingFormatValue, proofingOptions]);

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

	React.useEffect(() => {
		setBuild(undefined);
		setDismissedNoteIds(new Set());
		setError(undefined);
	}, [
		activeTarget,
		exportFormat,
		formatOptions.htmlCompatibility,
		formatOptions.htmlInlineAssets,
		formatOptions.jsonPretty,
		view
	]);

	React.useEffect(() => {
		setInlineAssetsTouched(false);
	}, [story?.id]);

	React.useEffect(() => {
		if (inlineAssetsTouched) {
			return;
		}

		setFormatOptions(current =>
			current.htmlInlineAssets === inlineAssetsDefault
				? current
				: {...current, htmlInlineAssets: inlineAssetsDefault}
		);
	}, [inlineAssetsDefault, inlineAssetsTouched]);

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
	const safetyIssues =
		publishBoundTargets.includes(activeTarget) && safety ? safety.issues : [];
	const buildWarningDiagnosticCount =
		build?.report.diagnostics.filter(
			diagnostic => diagnostic.severity === 'warning'
		).length ?? 0;
	const buildErrorDiagnosticCount =
		build?.report.diagnostics.filter(
			diagnostic => diagnostic.severity === 'error'
		).length ?? 0;
	const preparedSize = build
		? bytesLabel(build.files.reduce((total, file) => total + file.sizeBytes, 0))
		: 'Not built';
	const sourceOnly = activeDefinition.sourceOnly;
	const appendLog = React.useCallback((line: string) => {
		setLogs(current => [...current.slice(-80), {line, time: logTime()}]);
	}, []);

	const updateFormatOption = React.useCallback(
		<K extends keyof ExportFormatOptions>(
			key: K,
			value: ExportFormatOptions[K]
		) => {
			setFormatOptions(current => ({...current, [key]: value}));
		},
		[]
	);

	const prepareExportBuild = React.useCallback(
		async (
			actionName: string,
			target: StoryBuildTarget = activeTarget,
			label = activeDefinition.label
		) => {
			if (!story) {
				throw new Error('No story is selected.');
			}

			setBusyAction(actionName);
			setError(undefined);
			appendLog(`Preparing ${label}.`);

			try {
				const nextBuild = await publishStoryPackage(story.id, {
					buildTarget: target,
					htmlCompatibility:
						target === 'export-html' || target === 'publish'
							? formatOptions.htmlCompatibility
							: false,
					jsonPretty: formatOptions.jsonPretty
				});

				setBuild(nextBuild);
				appendLog(
					`Prepared ${nextBuild.files.length} output file(s), ${nextBuild.assets.length} asset plan item(s).`
				);
				if (nextBuild.report.diagnostics.length > 0) {
					appendLog(
						`${nextBuild.report.diagnostics.length} build diagnostic(s) added to the report.`
					);
				}
				return nextBuild;
			} catch (error) {
				const message = (error as Error).message;

				setError(message);
				appendLog(`Failed: ${message}`);
				throw error;
			} finally {
				setBusyAction(undefined);
			}
		},
		[
			activeDefinition.label,
			activeTarget,
			appendLog,
			formatOptions.jsonPretty,
			formatOptions.htmlCompatibility,
			publishStoryPackage,
			story
		]
	);

	const savePreparedOutput = React.useCallback(async () => {
		try {
			const nextBuild = await prepareExportBuild('export');
			const file = outputToSave(nextBuild);

			if (file) {
				saveFile(file.contents, file.filename, file.mediaType);
				appendLog(`Saved ${file.filename}.`);
			}
		} catch {
			// prepareExportBuild already recorded the error.
		}
	}, [appendLog, prepareExportBuild]);

	const inspectOutput = React.useCallback(async () => {
		try {
			await prepareExportBuild('inspect');
			setInspectOpen(true);
		} catch {
			// prepareExportBuild already recorded the error.
		}
	}, [prepareExportBuild]);

	const publishOnline = React.useCallback(async () => {
		try {
			await prepareExportBuild(
				'publish-online',
				exportFormat === 'html' ? 'publish' : activeTarget,
				'Publish online'
			);
			appendLog('Online publishing package prepared.');
		} catch {
			// prepareExportBuild already recorded the error.
		}
	}, [activeTarget, appendLog, exportFormat, prepareExportBuild]);

	const runPreview = React.useCallback(
		async (action: PreviewAction) => {
			if (!story) {
				return;
			}

			setBusyAction(action);
			setError(undefined);

			try {
				if (action === 'proof') {
					const nextBuild = await proofStoryPackage(story.id, {
						proofingFormat: selectedProofingFormat
					});

					setBuild(nextBuild);
					await proofStory(story.id, selectedProofingFormat);
					appendLog('Opened Proof preview.');
					return;
				}

				const nextBuild = await publishStoryPackage(story.id, {
					buildTarget: action
				});

				setBuild(nextBuild);
				await playStory(story.id);
				appendLog('Opened Play preview.');
			} catch (error) {
				const message = (error as Error).message;

				setError(message);
				appendLog(`Failed: ${message}`);
			} finally {
				setBusyAction(undefined);
			}
		},
		[
			appendLog,
			playStory,
			proofStory,
			proofStoryPackage,
			publishStoryPackage,
			selectedProofingFormat,
			story
		]
	);

	const rawNotes = React.useMemo<BuildNote[]>(() => {
		const notes: BuildNote[] = [];

		if (error) {
			notes.push({
				detail: error,
				icon: 'alert-octagon',
				id: 'last-build-error',
				title: 'Last build failed',
				tone: 'error'
			});
		}

		if (errorDiagnostics.length > 0) {
			notes.push({
				actionLabel: 'Fix in Diagnostics',
				detail: 'Resolve active error diagnostics before exporting this story.',
				icon: 'alert-octagon',
				id: 'story-diagnostics',
				onAction: () => history.push(`/stories/${story?.id}/diagnostics`),
				title: `${errorDiagnostics.length} story issue${
					errorDiagnostics.length === 1 ? '' : 's'
				}`,
				tone: 'error'
			});
		}

		const safetyErrors = safetyIssues.filter(
			issue => issue.severity === 'error'
		);

		if (safetyErrors.length > 0) {
			notes.push({
				detail:
					'The selected story format includes dev-only runtime code that cannot ship.',
				icon: 'alert-octagon',
				id: 'publish-safety',
				title: 'Format needs review before publish',
				tone: 'error'
			});
		}

		if (buildErrorDiagnosticCount > 0) {
			notes.push({
				detail: `${buildErrorDiagnosticCount} build diagnostic${
					buildErrorDiagnosticCount === 1 ? '' : 's'
				} need attention.`,
				icon: 'alert-octagon',
				id: 'build-errors',
				title: 'Build output has errors',
				tone: 'error'
			});
		}

		if (sourceOnly) {
			notes.push({
				detail:
					'Assets and runtime HTML are not part of this file. That is by design.',
				icon: 'info-circle',
				id: 'source-only',
				title:
					exportFormat === 'json' ? 'Source-only data' : 'Source-only format',
				tone: 'info'
			});
		}

		if (exportFormat === 'archive') {
			notes.push({
				detail:
					'Includes HTML, Twee source, JSON, and a copy plan for project assets.',
				icon: 'info-circle',
				id: 'archive-contents',
				title: 'Everything in one archive',
				tone: 'info'
			});
		}

		if (exportFormat === 'html' && formatOptions.htmlCompatibility) {
			notes.push({
				detail:
					'The exported HTML omits twine.rs graph data so other Twine tools can read it.',
				icon: 'info-circle',
				id: 'compatibility',
				title: 'Classic Twine compatibility',
				tone: 'info'
			});
		}

		if (exportFormat === 'html' && !formatOptions.htmlInlineAssets) {
			notes.push({
				detail: inlineAssetsAutoDisabled
					? `${inlineAssetsAutoReason}. Keeping assets external avoids a very large HTML file. You can turn this back on.`
					: 'Referenced project assets stay in the asset copy plan instead of being embedded.',
				icon: 'info-circle',
				id: 'asset-copy-plan',
				title: inlineAssetsAutoDisabled
					? 'Inline assets off by default'
					: 'Assets stay external',
				tone: 'info'
			});
		}

		if (!sourceOnly && missingAssets.length > 0) {
			notes.push({
				detail: `${missingAssets.slice(0, 3).join(', ')}${
					missingAssets.length > 3 ? '...' : ''
				} will be skipped unless restored.`,
				dismissible: true,
				icon: 'alert-triangle',
				id: 'missing-assets',
				title: `${missingAssets.length} asset${
					missingAssets.length === 1 ? '' : 's'
				} could not be found`,
				tone: 'warn'
			});
		}

		if (buildWarningDiagnosticCount > 0) {
			notes.push({
				detail: `${buildWarningDiagnosticCount} warning${
					buildWarningDiagnosticCount === 1 ? '' : 's'
				} were added to the package report.`,
				dismissible: true,
				icon: 'alert-triangle',
				id: 'build-warnings',
				title: 'Build warnings need review',
				tone: 'warn'
			});
		}

		if (dismissedDiagnosticCount > 0) {
			notes.push({
				detail: `${dismissedDiagnosticCount} dismissed diagnostic${
					dismissedDiagnosticCount === 1 ? '' : 's'
				} are hidden from this view.`,
				dismissible: true,
				icon: 'info-circle',
				id: 'dismissed-diagnostics',
				title: 'Dismissed diagnostics hidden',
				tone: 'info'
			});
		}

		return notes;
	}, [
		buildErrorDiagnosticCount,
		buildWarningDiagnosticCount,
		dismissedDiagnosticCount,
		error,
		errorDiagnostics.length,
		exportFormat,
		formatOptions.htmlCompatibility,
		formatOptions.htmlInlineAssets,
		history,
		inlineAssetsAutoDisabled,
		inlineAssetsAutoReason,
		missingAssets,
		safetyIssues,
		sourceOnly,
		story?.id
	]);

	const visibleNotes = rawNotes.filter(
		note => !note.dismissible || !dismissedNoteIds.has(note.id)
	);
	const visibleProblemNotes = visibleNotes.filter(
		note => note.tone === 'error' || note.tone === 'warn'
	);
	const notes =
		visibleProblemNotes.length === 0
			? [
					{
						detail: 'No problems found in this story. You are good to go.',
						icon: 'circle-check',
						id: 'ready',
						title: 'Ready to export',
						tone: 'ok' as const
					},
					...visibleNotes
				]
			: visibleNotes;

	const sourceInspectionText = React.useMemo(
		() => (inspectOpen && story ? sourceInspection(story, storyIndex) : ''),
		[inspectOpen, story, storyIndex]
	);
	const htmlInspectionText = React.useMemo(
		() => (inspectOpen ? htmlInspection(build) : ''),
		[build, inspectOpen]
	);
	const inspectText =
		inspectTab === 'source' ? sourceInspectionText : htmlInspectionText;

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
				<div className="build-route__main">
					<header className="build-route__head">
						<div>
							<h1>
								{view === 'export' ? 'Export your story' : 'Preview your story'}
							</h1>
							<p>
								{view === 'export'
									? 'Pick a format and save a file. Run actions live under Preview.'
									: 'Open a live copy to read or test. Nothing is saved to disk.'}
							</p>
						</div>
						<div className="build-route__head-spacer" />
						<Badge
							icon={
								capabilities?.publishSafe ? 'discount-check' : 'alert-circle'
							}
							tone={capabilities?.publishSafe ? 'saved' : 'warn'}
						>
							{story.storyFormat} {story.storyFormatVersion}
						</Badge>
					</header>

					<SegmentedControl
						className="build-route__view-switch"
						onChange={value => setView(value as BuildView)}
						options={[
							{icon: 'download', label: 'Export', value: 'export'},
							{icon: 'player-play', label: 'Preview', value: 'preview'}
						]}
						value={view}
					/>

					{view === 'preview' ? (
						<section
							className="build-route__group"
							aria-label="Preview actions"
						>
							<div className="build-route__action-row">
								<div className="build-route__action-icon build-route__action-icon--green">
									<TablerIcon icon="player-play" />
								</div>
								<div className="build-route__action-body">
									<div className="build-route__action-title">Play</div>
									<div className="build-route__action-detail">
										Open the story from its start passage in an app preview.
									</div>
								</div>
								<Button
									icon="player-play"
									loading={busyAction === 'play'}
									onClick={() => runPreview('play')}
									variant="primary"
								>
									Play
								</Button>
							</div>

							<div className="build-route__action-row">
								<div className="build-route__action-icon">
									<TablerIcon icon="book" />
								</div>
								<div className="build-route__action-body">
									<div className="build-route__action-title">Proof</div>
									<div className="build-route__action-detail">
										Open a proofing copy for review and editing passes.
									</div>
									<div className="build-route__action-inline">
										<span>Proofing format</span>
										<Select
											ariaLabel="Proofing format"
											disabled={proofingOptions.length === 0}
											onChange={setProofingFormatValue}
											options={proofingOptions}
											size="sm"
											value={proofingFormatValue}
										/>
									</div>
								</div>
								<Button
									icon="book"
									loading={busyAction === 'proof'}
									onClick={() => runPreview('proof')}
								>
									Proof
								</Button>
							</div>
						</section>
					) : (
						<>
							<section
								className="build-route__group"
								aria-label="Export format"
							>
								<div className="build-route__label">Format</div>
								<div className="build-route__formats">
									{exportFormats.map(format => {
										const selected = exportFormat === format.format;

										return (
											<button
												aria-pressed={selected}
												className={`build-route__format${
													selected ? ' build-route__format--selected' : ''
												}`}
												key={format.format}
												onClick={() => setExportFormat(format.format)}
												type="button"
											>
												<span
													aria-hidden
													className="build-route__format-check"
												/>
												<div className="build-route__format-icon">
													<TablerIcon icon={format.icon} />
												</div>
												<div>
													<div className="build-route__format-title">
														{format.label}
														{format.sourceOnly && (
															<span className="build-route__source-chip">
																source
															</span>
														)}
													</div>
													<div className="build-route__format-detail">
														{format.description}
													</div>
												</div>
											</button>
										);
									})}
								</div>
							</section>

							<section
								className="build-route__group"
								aria-label="Export options"
							>
								<div className="build-route__label">Options</div>
								<div className="build-route__panel">
									{exportFormat === 'html' && (
										<>
											<div className="build-route__row">
												<div className="build-route__row-left">
													<div className="build-route__row-title">
														Inline all assets
													</div>
													<div className="build-route__row-detail">
														Embed images and media so the single file works
														offline.
													</div>
												</div>
												<Switch
													ariaLabel="Inline all assets"
													checked={formatOptions.htmlInlineAssets}
													onChange={checked => {
														setInlineAssetsTouched(true);
														updateFormatOption('htmlInlineAssets', checked);
													}}
												/>
											</div>
											<div className="build-route__row">
												<div className="build-route__row-left">
													<div className="build-route__row-title">
														Classic Twine compatibility
													</div>
													<div className="build-route__row-detail">
														Omit the twine.rs graph data so other Twine tools
														can read it.
													</div>
												</div>
												<Switch
													ariaLabel="Classic Twine compatibility"
													checked={formatOptions.htmlCompatibility}
													onChange={checked =>
														updateFormatOption('htmlCompatibility', checked)
													}
												/>
											</div>
										</>
									)}

									{exportFormat === 'json' && (
										<div className="build-route__row">
											<div className="build-route__row-left">
												<div className="build-route__row-title">
													Pretty-print
												</div>
												<div className="build-route__row-detail">
													Indent the JSON for readable diffs in version control.
												</div>
											</div>
											<Switch
												ariaLabel="Pretty-print"
												checked={formatOptions.jsonPretty}
												onChange={checked =>
													updateFormatOption('jsonPretty', checked)
												}
											/>
										</div>
									)}

									{exportFormat === 'twee' && (
										<div className="build-route__row">
											<div className="build-route__row-left">
												<div className="build-route__row-title">
													Passage tags and metadata
												</div>
												<div className="build-route__row-detail">
													Tags, positions, and story settings are written in the
													Twee source.
												</div>
											</div>
											<Badge icon="check" tone="saved">
												Included
											</Badge>
										</div>
									)}

									{exportFormat === 'archive' && (
										<div className="build-route__row">
											<div className="build-route__row-left">
												<div className="build-route__row-title">Contents</div>
												<div className="build-route__row-detail">
													Playable HTML, Twee source, JSON, manifest, and asset
													copy plan.
												</div>
											</div>
											<Badge icon="package" tone="neutral">
												4 parts
											</Badge>
										</div>
									)}

									<div className="build-route__meta">
										<div>
											<span>Destination</span>
											<b>Choose when exporting</b>
										</div>
										<div>
											<span>Prepared size</span>
											<b>{preparedSize}</b>
										</div>
										<div>
											<span>Format status</span>
											<b>{formatStatusLabel(formatProperties)}</b>
										</div>
									</div>
								</div>
							</section>

							<section className="build-route__notes" aria-label="Export notes">
								{notes.map(note => (
									<div
										className={`build-route__note build-route__note--${note.tone}`}
										key={note.id}
									>
										<TablerIcon
											className="build-route__note-icon"
											icon={note.icon}
										/>
										<div className="build-route__note-body">
											<div className="build-route__note-title">
												{note.title}
											</div>
											<div className="build-route__note-detail">
												{note.detail}
											</div>
										</div>
										{note.actionLabel && (
											<button
												className="build-route__note-action"
												onClick={note.onAction}
												type="button"
											>
												{note.actionLabel}
											</button>
										)}
										{note.dismissible && (
											<IconButton
												icon="x"
												label={`Dismiss ${note.title}`}
												onClick={() =>
													setDismissedNoteIds(current => {
														const next = new Set(current);

														next.add(note.id);
														return next;
													})
												}
												size="sm"
											/>
										)}
									</div>
								))}
							</section>

							<footer className="build-route__footer">
								<Button
									icon="download"
									loading={busyAction === 'export'}
									onClick={savePreparedOutput}
									variant="primary"
								>
									Export {activeDefinition.label}
								</Button>
								<Button
									icon="search"
									loading={busyAction === 'inspect'}
									onClick={inspectOutput}
								>
									Inspect output
								</Button>
								<div className="build-route__footer-spacer" />
								{!sourceOnly && (
									<Button
										icon="cloud-upload"
										loading={busyAction === 'publish-online'}
										onClick={publishOnline}
										variant="ghost"
									>
										Publish online...
									</Button>
								)}
							</footer>

							{visibleProblemNotes.some(note => note.tone === 'warn') && (
								<div className="build-route__footer-note">
									Warnings never block an export. They are skipped and noted.
								</div>
							)}
						</>
					)}

					{logs.length > 0 && (
						<section
							className="build-route__activity"
							aria-label="Build output"
						>
							<div className="build-route__activity-head">
								<span>Build output</span>
								<Button
									icon="trash"
									onClick={() => setLogs([])}
									size="sm"
									variant="ghost"
								>
									Clear
								</Button>
							</div>
							<div className="build-route__activity-body">
								{logs.map((entry, index) => (
									<div
										className="build-route__activity-line"
										key={`${entry.line}-${index}`}
									>
										<span>{entry.time}</span>
										<span>{entry.line}</span>
									</div>
								))}
							</div>
						</section>
					)}
				</div>

				{inspectOpen && (
					<div
						className="build-route__scrim"
						onClick={() => setInspectOpen(false)}
					>
						<aside
							aria-label="Inspect output"
							className="build-route__drawer"
							onClick={event => event.stopPropagation()}
						>
							<header className="build-route__drawer-head">
								<TablerIcon icon="search" />
								<b>Inspect output</b>
								<div className="build-route__drawer-spacer" />
								<IconButton
									icon="x"
									label="Close inspect output"
									onClick={() => setInspectOpen(false)}
								/>
							</header>
							<div className="build-route__drawer-tabs">
								<SegmentedControl
									onChange={value => setInspectTab(value as InspectTab)}
									options={[
										{icon: 'list-details', label: 'Source', value: 'source'},
										{icon: 'code', label: 'HTML', value: 'html'}
									]}
									size="sm"
									value={inspectTab}
								/>
							</div>
							<pre className="build-route__inspect-pre">{inspectText}</pre>
							<footer className="build-route__drawer-foot">
								<TablerIcon icon="info-circle" />
								<span>
									Read-only - this used to be an exported report. Now it just
									shows here.
								</span>
								<Button
									icon="copy"
									onClick={() => void navigator.clipboard?.writeText(inspectText)}
									size="sm"
									variant="ghost"
								>
									Copy
								</Button>
							</footer>
						</aside>
					</div>
				)}
			</div>
		</FormatLoader>
	);
};
