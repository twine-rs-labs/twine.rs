import * as React from 'react';
import {
	Badge,
	Button,
	Checkbox,
	Input,
	TablerIcon
} from '../../components/design-system';
import {FormatLoader} from '../../store/format-loader';
import {setPref, usePrefsContext} from '../../store/prefs';
import {
	createFromProperties,
	deleteFormat,
	newestFormatNamed,
	sortFormats,
	StoryFormat,
	useStoryFormatsContext
} from '../../store/story-formats';
import {
	fetchStoryFormatProperties,
	inspectStoryFormatPublishSafety,
	storyFormatCapabilities
} from '../../util/story-format';
import './story-formats-route.css';

type FormatFilter = 'all' | 'current' | 'dev' | 'failed' | 'user';

type DevLoopStatus =
	| {kind: 'error'; message: string}
	| {kind: 'idle'; message: string}
	| {kind: 'ok'; message: string}
	| {kind: 'pending'; message: string};

const filters: Array<{id: FormatFilter; label: string}> = [
	{id: 'all', label: 'All'},
	{id: 'current', label: 'Current'},
	{id: 'user', label: 'User-added'},
	{id: 'dev', label: 'Development'},
	{id: 'failed', label: 'Failed'}
];

function initials(format: StoryFormat) {
	return format.name
		.split(/\s+/)
		.map(part => part[0])
		.join('')
		.slice(0, 2)
		.toUpperCase();
}

function isCurrentFormat(format: StoryFormat, formats: StoryFormat[]) {
	return newestFormatNamed(formats, format.name)?.id === format.id;
}

function filteredFormatList(
	formats: StoryFormat[],
	filter: FormatFilter
): StoryFormat[] {
	switch (filter) {
		case 'current':
			return formats.filter(format => isCurrentFormat(format, formats));

		case 'dev':
			return formats.filter(
				format =>
					format.loadState === 'loaded' && !!format.properties.twineRs?.development
			);

		case 'failed':
			return formats.filter(format => format.loadState === 'error');

		case 'user':
			return formats.filter(format => format.userAdded);

		default:
			return formats;
	}
}

function filterCount(formats: StoryFormat[], filter: FormatFilter) {
	return filteredFormatList(formats, filter).length;
}

function loadedCapabilities(format: StoryFormat) {
	return format.loadState === 'loaded'
		? storyFormatCapabilities(format.properties)
		: undefined;
}

function loadedSafety(format: StoryFormat) {
	return format.loadState === 'loaded'
		? inspectStoryFormatPublishSafety(format.properties)
		: undefined;
}

function status(format: StoryFormat) {
	if (format.loadState === 'error') {
		return {
			icon: 'alert-octagon',
			label: format.loadError.message,
			tone: 'error' as const
		};
	}

	if (format.loadState !== 'loaded') {
		return {icon: 'clock', label: 'Loading manifest', tone: 'warn' as const};
	}

	const safety = loadedSafety(format);

	if (safety && !safety.publishSafe) {
		return {
			icon: 'alert-triangle',
			label: `${safety.issues.length} publish-safety issue${
				safety.issues.length === 1 ? '' : 's'
			}`,
			tone: 'warn' as const
		};
	}

	return {icon: 'circle-check', label: 'Validated', tone: 'ok' as const};
}

function capabilityEntries(format: StoryFormat) {
	const capabilities = loadedCapabilities(format);

	if (!capabilities) {
		return [];
	}

	return [
		['Parser', capabilities.parser],
		['Exporter', capabilities.exporter],
		['Syntax', capabilities.syntax],
		['Autocomplete', capabilities.autocomplete],
		['Diagnostics', capabilities.diagnostics],
		['Docs', capabilities.docs],
		['Editor actions', capabilities.editorToolbarActions],
		['Menu items', capabilities.menuItems],
		['Devtools', capabilities.devtoolsPanels],
		['Lazy modules', capabilities.lazyLoadedModules],
		['Migration', capabilities.migration],
		['Preprocessing', capabilities.preprocessing],
		['Statistics', capabilities.statistics],
		['Publish safe', capabilities.publishSafe]
	] as Array<[string, boolean]>;
}

export const StoryFormatsRoute: React.FC = () => {
	const {dispatch: formatsDispatch, formats} = useStoryFormatsContext();
	const {dispatch: prefsDispatch, prefs} = usePrefsContext();
	const [filter, setFilter] = React.useState<FormatFilter>('all');
	const [selectedId, setSelectedId] = React.useState<string>();
	const [newFormatUrl, setNewFormatUrl] = React.useState('');
	const [addError, setAddError] = React.useState<string>();
	const [adding, setAdding] = React.useState(false);
	const [devLoopStatus, setDevLoopStatus] = React.useState<DevLoopStatus>({
		kind: 'idle',
		message: 'Ready'
	});
	const sortedFormats = React.useMemo(() => sortFormats([...formats]), [formats]);
	const visibleFormats = React.useMemo(
		() => filteredFormatList(sortedFormats, filter),
		[filter, sortedFormats]
	);
	const selectedFormat =
		visibleFormats.find(format => format.id === selectedId) ??
		visibleFormats[0] ??
		sortedFormats[0];
	const selectedCapabilities = selectedFormat
		? capabilityEntries(selectedFormat)
		: [];
	const selectedStatus = selectedFormat ? status(selectedFormat) : undefined;
	const selectedSafety = selectedFormat ? loadedSafety(selectedFormat) : undefined;
	const selectedDevelopment =
		selectedFormat?.loadState === 'loaded'
			? selectedFormat.properties.twineRs?.development
			: undefined;
	const selectedModules =
		selectedFormat?.loadState === 'loaded'
			? selectedFormat.properties.twineRs?.modules ?? []
			: [];
	const editorExtensionsDisabled = selectedFormat
		? prefs.disabledStoryFormatEditorExtensions.some(
				disabled =>
					disabled.name === selectedFormat.name &&
					disabled.version === selectedFormat.version
			)
		: false;

	React.useEffect(() => {
		if (
			selectedId &&
			!visibleFormats.some(format => format.id === selectedId) &&
			visibleFormats[0]
		) {
			setSelectedId(visibleFormats[0].id);
		}
	}, [selectedId, visibleFormats]);

	React.useEffect(() => {
		setDevLoopStatus({kind: 'idle', message: 'Ready'});
	}, [selectedFormat?.id]);

	async function handleAddFormat() {
		setAdding(true);
		setAddError(undefined);

		try {
			const properties = await fetchStoryFormatProperties(newFormatUrl);

			formatsDispatch(createFromProperties(newFormatUrl, properties));
			setNewFormatUrl('');
		} catch (error) {
			setAddError((error as Error).message);
		} finally {
			setAdding(false);
		}
	}

	function setDefault(format: StoryFormat) {
		prefsDispatch(setPref('storyFormat', {
			name: format.name,
			version: format.version
		}));
	}

	function setProofing(format: StoryFormat) {
		prefsDispatch(setPref('proofingFormat', {
			name: format.name,
			version: format.version
		}));
	}

	function setEditorExtensionsEnabled(format: StoryFormat, enabled: boolean) {
		if (enabled) {
			prefsDispatch(
				setPref(
					'disabledStoryFormatEditorExtensions',
					prefs.disabledStoryFormatEditorExtensions.filter(
						disabled =>
							disabled.name !== format.name ||
							disabled.version !== format.version
					)
				)
			);
		} else {
			prefsDispatch(
				setPref('disabledStoryFormatEditorExtensions', [
					...prefs.disabledStoryFormatEditorExtensions,
					{name: format.name, version: format.version}
				])
			);
		}
	}

	async function reloadSelectedFormat() {
		if (!selectedFormat) {
			return;
		}

		setDevLoopStatus({kind: 'pending', message: 'Reloading format'});

		try {
			const properties = await fetchStoryFormatProperties(selectedFormat.url);

			formatsDispatch({
				id: selectedFormat.id,
				props: {
					loadState: 'loaded',
					name: properties.name,
					properties,
					version: properties.version
				},
				type: 'update'
			});
			setDevLoopStatus({
				kind: 'ok',
				message: `Reloaded ${properties.name} ${properties.version}`
			});
		} catch (error) {
			setDevLoopStatus({
				kind: 'error',
				message: (error as Error).message
			});
		}
	}

	async function checkDevelopmentServer() {
		if (!selectedDevelopment?.devServerUrl) {
			return;
		}

		setDevLoopStatus({kind: 'pending', message: 'Checking dev server'});

		try {
			await fetch(selectedDevelopment.devServerUrl, {
				cache: 'no-store',
				method: 'HEAD',
				mode: 'no-cors'
			});
			setDevLoopStatus({
				kind: 'ok',
				message: 'Dev server responded'
			});
		} catch (error) {
			setDevLoopStatus({
				kind: 'error',
				message: (error as Error).message
			});
		}
	}

	return (
		<FormatLoader block={false}>
			<div className="story-formats-route">
				<aside className="story-formats-route__filters" aria-label="Format filters">
					{filters.map(candidate => (
						<button
							aria-current={candidate.id === filter}
							className="story-formats-route__filter"
							key={candidate.id}
							onClick={() => setFilter(candidate.id)}
							type="button"
						>
							<span>{candidate.label}</span>
							<span className="story-formats-route__filter-count">
								{filterCount(sortedFormats, candidate.id)}
							</span>
						</button>
					))}
				</aside>
				<section className="story-formats-route__list" aria-label="Story formats">
					<div className="story-formats-route__add">
						<Input
							aria-label="Story format URL"
							block
							icon="link"
							onChange={event => setNewFormatUrl(event.target.value)}
							placeholder="https://example.com/format.js"
							value={newFormatUrl}
						/>
						<Button
							disabled={newFormatUrl.trim() === ''}
							icon="plus"
							loading={adding}
							onClick={handleAddFormat}
							variant="primary"
						>
							Add
						</Button>
					</div>
					{addError && (
						<Badge icon="alert-octagon" tone="error">
							{addError}
						</Badge>
					)}
					{visibleFormats.length === 0 && (
						<div className="story-formats-route__empty">
							No story formats match this filter.
						</div>
					)}
					{visibleFormats.map(format => {
						const capabilities = loadedCapabilities(format);
						const formatStatus = status(format);
						const isDefault =
							prefs.storyFormat.name === format.name &&
							prefs.storyFormat.version === format.version;
						const isProofing =
							prefs.proofingFormat.name === format.name &&
							prefs.proofingFormat.version === format.version;

						return (
							<button
								aria-current={format.id === selectedFormat?.id}
								className="story-formats-route__card"
								key={format.id}
								onClick={() => setSelectedId(format.id)}
								type="button"
							>
								<div className="story-formats-route__card-top">
									<div className="story-formats-route__logo">
										{initials(format)}
									</div>
									<div style={{flex: 1, minWidth: 0}}>
										<div className="story-formats-route__name">
											{format.name}
											{isDefault && <Badge tone="saved">Default</Badge>}
											{isProofing && <Badge tone="build">Proofing</Badge>}
											{format.userAdded && <Badge tone="tag">Custom</Badge>}
										</div>
										<div className="story-formats-route__meta">
											v{format.version} · {format.userAdded ? 'user-added' : 'built in'}
										</div>
									</div>
									<TablerIcon icon={formatStatus.icon} />
								</div>
								<div className="story-formats-route__caps">
									{capabilities ? (
										[
											['Parser', capabilities.parser],
											['Exporter', capabilities.exporter],
											['Diagnostics', capabilities.diagnostics],
											['Editor UI', capabilities.editorToolbarActions],
											['Dev tools', capabilities.devOnlyTools],
											['Publish safe', capabilities.publishSafe]
										]
											.filter((entry): entry is [string, true] => !!entry[1])
											.map(([label]) => (
												<Badge icon="check" key={label} tone="saved">
													{label}
												</Badge>
											))
									) : (
										<Badge icon="clock">Loading</Badge>
									)}
								</div>
							</button>
						);
					})}
				</section>
				<aside className="story-formats-route__detail" aria-label="Format details">
					{selectedFormat && selectedStatus ? (
						<>
							<div className="story-formats-route__detail-top">
								<div className="story-formats-route__logo story-formats-route__detail-logo">
									{initials(selectedFormat)}
								</div>
								<div>
									<h1>{selectedFormat.name}</h1>
									<div className="story-formats-route__meta">
										v{selectedFormat.version} · {selectedFormat.url}
									</div>
								</div>
							</div>
							<div
								className={`story-formats-route__status story-formats-route__status--${selectedStatus.tone}`}
							>
								<TablerIcon icon={selectedStatus.icon} />
								<span>{selectedStatus.label}</span>
							</div>

							<div className="story-formats-route__section-title">
								Capabilities
							</div>
							{selectedCapabilities.map(([label, enabled]) => (
								<div className="story-formats-route__row" key={label}>
									<TablerIcon icon={enabled ? 'circle-check' : 'circle'} />
									<span className="story-formats-route__row-label">{label}</span>
									<span className="story-formats-route__row-value">
										{enabled ? 'Supported' : '-'}
									</span>
								</div>
							))}

							<div className="story-formats-route__section-title">
								Publish Safety
							</div>
							{selectedSafety?.issues.length ? (
								selectedSafety.issues.map(issue => (
									<div className="story-formats-route__row" key={issue.code}>
										<TablerIcon
											icon={
												issue.severity === 'error'
													? 'alert-octagon'
													: 'alert-triangle'
											}
										/>
										<span className="story-formats-route__row-label">
											{issue.message}
										</span>
										<span className="story-formats-route__row-value">
											{issue.severity}
										</span>
									</div>
								))
							) : (
								<div className="story-formats-route__row">
									<TablerIcon icon="circle-check" />
									<span className="story-formats-route__row-label">
										No publish-safety issues detected
									</span>
								</div>
							)}

							<div className="story-formats-route__section-title">
								Modules & Development
							</div>
							<div className="story-formats-route__row">
								<span className="story-formats-route__row-label">
									Declared modules
								</span>
								<span className="story-formats-route__row-value">
									{selectedModules.length}
								</span>
							</div>
							<div className="story-formats-route__row">
								<span className="story-formats-route__row-label">
									Development server
								</span>
								<span className="story-formats-route__row-value">
									{selectedDevelopment?.devServerUrl ?? '-'}
								</span>
							</div>
							<div className="story-formats-route__row">
								<span className="story-formats-route__row-label">HMR</span>
								<span className="story-formats-route__row-value">
									{selectedDevelopment?.hmr ? 'Enabled' : '-'}
								</span>
							</div>
							<div className="story-formats-route__row">
								<span className="story-formats-route__row-label">
									Local folder
								</span>
								<span className="story-formats-route__row-value">
									{selectedDevelopment?.localFolderPath ?? '-'}
								</span>
							</div>
							<div className="story-formats-route__row">
								<span className="story-formats-route__row-label">
									Dev loop
								</span>
								<span
									className={`story-formats-route__row-value story-formats-route__row-value--${devLoopStatus.kind}`}
								>
									{devLoopStatus.message}
								</span>
							</div>

							<div className="story-formats-route__actions">
								<Button
									disabled={devLoopStatus.kind === 'pending'}
									icon="refresh"
									loading={devLoopStatus.kind === 'pending'}
									onClick={reloadSelectedFormat}
								>
									Reload Format
								</Button>
								<Button
									disabled={
										!selectedDevelopment?.devServerUrl ||
										devLoopStatus.kind === 'pending'
									}
									icon="terminal-2"
									loading={devLoopStatus.kind === 'pending'}
									onClick={checkDevelopmentServer}
								>
									Check Dev Server
								</Button>
								<Button
									disabled={
										prefs.storyFormat.name === selectedFormat.name &&
										prefs.storyFormat.version === selectedFormat.version
									}
									icon="star"
									onClick={() => setDefault(selectedFormat)}
									variant="primary"
								>
									Use as Default
								</Button>
								<Button
									disabled={
										prefs.proofingFormat.name === selectedFormat.name &&
										prefs.proofingFormat.version === selectedFormat.version
									}
									icon="book"
									onClick={() => setProofing(selectedFormat)}
								>
									Use for Proofing
								</Button>
								{selectedFormat.loadState === 'loaded' &&
									!selectedFormat.properties.proofing && (
										<Checkbox
											checked={!editorExtensionsDisabled}
											label="Enable editor extensions"
											onChange={enabled =>
												setEditorExtensionsEnabled(selectedFormat, enabled)
											}
										/>
									)}
								{selectedFormat.userAdded && (
									<Button
										icon="trash"
										onClick={() => formatsDispatch(deleteFormat(selectedFormat))}
										variant="danger"
									>
										Remove Format
									</Button>
								)}
							</div>
						</>
					) : (
						<div className="story-formats-route__empty">
							No story format selected.
						</div>
					)}
				</aside>
			</div>
		</FormatLoader>
	);
};
