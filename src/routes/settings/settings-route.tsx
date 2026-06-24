import * as React from 'react';
import {
	Badge,
	Button,
	Input,
	Panel,
	Select,
	Switch,
	TablerIcon
} from '../../components/design-system';
import type {TwineElectronWindow} from '../../electron/shared';
import type {
	NativeBackupResult,
	NativePlatformSettings,
	NativePlatformSettingsUpdate,
	NativeScratchAssetStrategy
} from '../../electron/shared';
import {useStoryFormatsContext} from '../../store/story-formats';
import {setPref, usePrefsContext} from '../../store/prefs';
import type {
	CodeEditorThemePreference,
	EditorFocusPreference,
	GraphCardSizePreference,
	IntegrationPreference,
	SharingModePreference,
	StoryEditModePreference
} from '../../store/prefs';
import {getAppInfo} from '../../util/app-info';
import {isElectronRenderer} from '../../util/is-electron';
import {closestAppLocale, locales} from '../../util/locales';
import './settings-route.css';

const themeOptions = [
	{label: 'System', value: 'system'},
	{label: 'Light', value: 'light'},
	{label: 'Dark', value: 'dark'}
];

const dialogWidthOptions = [
	{label: 'Default', value: '600'},
	{label: 'Wide', value: '700'},
	{label: 'Widest', value: '800'}
];

const tagDisplayOptions = [
	{label: 'Color bars', value: 'color'},
	{label: 'Tag names', value: 'name'}
];

const keybindingOptions = [
	{label: 'Default', value: 'default'},
	{label: 'Emacs-style', value: 'emacs'},
	{label: 'Vim-style', value: 'vim'}
];

const modeOptions = [
	{label: 'Auto', value: 'auto'},
	{label: 'Text', value: 'text'},
	{label: 'Graph', value: 'graph'},
	{label: 'Split', value: 'split'}
];

const editorFocusOptions = [
	{label: 'Restore', value: 'restore'},
	{label: 'Passage start', value: 'passage-start'},
	{label: 'No auto focus', value: 'none'}
];

const graphCardSizeOptions = [
	{label: 'Twine 100 x 100', value: 'twine'},
	{label: 'Small', value: 'small'},
	{label: 'Narrow', value: 'narrow'},
	{label: 'Medium', value: 'medium'},
	{label: 'Large', value: 'large'},
	{label: 'Tall', value: 'tall'},
	{label: 'Wide', value: 'wide'}
];

const storyListSortOptions = [
	{label: 'Name', value: 'name'},
	{label: 'Updated', value: 'date'}
];

const formatFilterOptions = [
	{label: 'Current', value: 'current'},
	{label: 'All', value: 'all'},
	{label: 'User-added', value: 'user'}
];

const fontScaleOptions = [
	{label: '90%', value: '0.9'},
	{label: '100%', value: '1'},
	{label: '110%', value: '1.1'},
	{label: '125%', value: '1.25'}
];

const codeEditorThemeOptions = [
	{label: 'Twine adaptive', value: 'twine'},
	{label: 'CodeMirror One Dark', value: 'one-dark'},
	{label: 'Solarized Light', value: 'solarized-light'},
	{label: 'Solarized Dark', value: 'solarized-dark'},
	{label: 'High Contrast', value: 'high-contrast'}
];

const backupCadenceOptions = [
	{label: '10 minutes', value: '10'},
	{label: '20 minutes', value: '20'},
	{label: '30 minutes', value: '30'},
	{label: '1 hour', value: '60'},
	{label: '4 hours', value: '240'}
];

const backupRetentionOptions = [
	{label: '3 backups', value: '3'},
	{label: '10 backups', value: '10'},
	{label: '20 backups', value: '20'},
	{label: '50 backups', value: '50'}
];

const backupReminderOptions = [
	{label: 'Daily', value: '1'},
	{label: 'Weekly', value: '7'},
	{label: 'Every 2 weeks', value: '14'},
	{label: 'Monthly', value: '30'}
];

const cacheCleanupOptions = [
	{label: '1 day', value: '1'},
	{label: '3 days', value: '3'},
	{label: '7 days', value: '7'},
	{label: '14 days', value: '14'},
	{label: '30 days', value: '30'}
];

const scratchAssetStrategyOptions = [
	{label: 'Link folders, copy fallback', value: 'link'},
	{label: 'Copy asset files', value: 'copy'}
];

const sharingModeOptions = [
	{label: 'Off', value: 'off'},
	{label: 'Local file', value: 'local-file'},
	{label: 'Published URL', value: 'published-url'}
];

const integrationOptions = [
	{label: 'Off', value: 'off'},
	{label: 'Manual', value: 'manual'}
];

const linkHandlingOptions = [
	{label: 'System browser', value: 'system'},
	{label: 'Block external', value: 'block'}
];

function formatPreferenceValue(format: {name: string; version: string}) {
	return `${format.name}\u0000${format.version}`;
}

function parseFormatPreferenceValue(value: string) {
	const [name, version] = value.split('\u0000');

	return {name, version};
}

function compactDateTime(timestamp: number | string | undefined) {
	if (!timestamp) {
		return 'Never';
	}

	return new Date(timestamp).toLocaleDateString();
}

function backupReviewLabel(settings: NativePlatformSettings) {
	if (!settings.backupLastReviewedTime) {
		return 'Review due';
	}

	const elapsedDays =
		(Date.now() - settings.backupLastReviewedTime) / (1000 * 60 * 60 * 24);

	return elapsedDays >= settings.backupReminderDays
		? 'Review due'
		: compactDateTime(settings.backupLastReviewedTime);
}

const SettingsStatus: React.FC<{
	icon: string;
	label: string;
	value: React.ReactNode;
}> = ({icon, label, value}) => (
	<div className="settings-route__status">
		<TablerIcon icon={icon} />
		<span>{label}</span>
		<b>{value}</b>
	</div>
);

export const SettingsRoute: React.FC = () => {
	const {dispatch, prefs} = usePrefsContext();
	const {formats} = useStoryFormatsContext();
	const [storyLibraryFolder, setStoryLibraryFolder] = React.useState('');
	const [platformSettings, setPlatformSettings] =
		React.useState<NativePlatformSettings>();
	const [backupRunning, setBackupRunning] = React.useState(false);
	const [lastBackupResult, setLastBackupResult] =
		React.useState<NativeBackupResult>();
	const [externalEditorCommand, setExternalEditorCommand] = React.useState('');
	const appInfo = getAppInfo();
	const formatOptions = formats.map(format => ({
		label: `${format.name} ${format.version}`,
		value: formatPreferenceValue(format)
	}));
	const storyFormatValue = formatPreferenceValue(prefs.storyFormat);
	const proofingFormatValue = formatPreferenceValue(prefs.proofingFormat);
	const desktopBridge = (window as TwineElectronWindow).twineElectron;
	const nativeDesktop = isElectronRenderer() || !!desktopBridge;
	const platformControlsAvailable = !!desktopBridge?.getPlatformSettings;
	const platformView: NativePlatformSettings = platformSettings ?? {
		backupCadenceMinutes: 20,
		backupFolderPath: 'Native desktop default',
		backupLastReviewedTime: 0,
		backupReminderDays: 7,
		backupRetentionLimit: 10,
		cacheCleanupDays: 3,
		externalEditorCommand: '',
		fullscreenPersistence: true,
		lastWindowFullscreen: false,
		linkHandlingMode: 'system',
		scratchAssetStrategy: 'link',
		storyLibraryFolderPath: storyLibraryFolder || 'Native desktop default'
	};

	React.useEffect(() => {
		let cancelled = false;

		(window as TwineElectronWindow).twineElectron
			?.getStoryLibraryFolder?.()
			.then(path => {
				if (!cancelled) {
					setStoryLibraryFolder(path);
				}
			})
			.catch(() => undefined);

		(window as TwineElectronWindow).twineElectron
			?.getPlatformSettings?.()
			.then(settings => {
				if (!cancelled) {
					setPlatformSettings(settings);
					setStoryLibraryFolder(settings.storyLibraryFolderPath);
					setExternalEditorCommand(settings.externalEditorCommand);
				}
			})
			.catch(() => undefined);

		return () => {
			cancelled = true;
		};
	}, []);

	async function chooseStoryLibraryFolder() {
		const path = await (
			window as TwineElectronWindow
		).twineElectron?.chooseStoryLibraryFolder?.();

		if (path) {
			setStoryLibraryFolder(path);
		}
	}

	async function resetStoryLibraryFolder() {
		const path = await (
			window as TwineElectronWindow
		).twineElectron?.resetStoryLibraryFolder?.();

		if (path) {
			setStoryLibraryFolder(path);
		}
	}

	function revealStoryLibraryFolder() {
		void (
			window as TwineElectronWindow
		).twineElectron?.revealStoryLibraryFolder?.();
	}

	function revealBackupFolder() {
		void (window as TwineElectronWindow).twineElectron?.revealBackupFolder?.();
	}

	async function updatePlatformSettings(
		settings: NativePlatformSettingsUpdate
	) {
		const next = await desktopBridge?.updatePlatformSettings?.(settings);

		if (next) {
			setPlatformSettings(next);
			setStoryLibraryFolder(next.storyLibraryFolderPath);
			setExternalEditorCommand(next.externalEditorCommand);
		}
	}

	async function runStoryLibraryBackup() {
		if (!desktopBridge?.runStoryLibraryBackup) {
			return;
		}

		setBackupRunning(true);

		try {
			const result = await desktopBridge.runStoryLibraryBackup();
			const next = await desktopBridge.getPlatformSettings?.();

			setLastBackupResult(result);

			if (next) {
				setPlatformSettings(next);
			}
		} finally {
			setBackupRunning(false);
		}
	}

	function recordBackupReview() {
		void updatePlatformSettings({backupLastReviewedTime: Date.now()});
	}

	function setStoryFormat(value: string) {
		dispatch(setPref('storyFormat', parseFormatPreferenceValue(value)));
	}

	function setProofingFormat(value: string) {
		dispatch(setPref('proofingFormat', parseFormatPreferenceValue(value)));
	}

	return (
		<div className="settings-route">
			<header className="settings-route__head">
				<div className="settings-route__head-icon">
					<TablerIcon icon="settings" />
				</div>
				<div>
					<h1>Settings</h1>
					<div className="settings-route__subhead">
						<Badge
							icon="device-desktop"
							tone={nativeDesktop ? 'saved' : 'neutral'}
						>
							{nativeDesktop ? 'Native desktop' : 'Filesystem fallback'}
						</Badge>
						<Badge icon="keyboard" tone="neutral">
							{prefs.keybindingPreset}
						</Badge>
						<Badge icon="palette" tone="neutral">
							{prefs.appTheme}
						</Badge>
					</div>
				</div>
			</header>

			<div className="settings-route__grid">
				<Panel icon="sliders" pad title="General">
					<div className="settings-route__stack">
						<div className="settings-route__field">
							<span>Theme</span>
							<Select
								ariaLabel="Theme"
								onChange={value => dispatch(setPref('appTheme', value))}
								options={themeOptions}
								value={prefs.appTheme}
							/>
						</div>
						<div className="settings-route__field">
							<span>Language</span>
							<Select
								ariaLabel="Language"
								onChange={value => dispatch(setPref('locale', value))}
								options={locales.map(locale => ({
									label: locale.name,
									value: locale.code
								}))}
								value={closestAppLocale(prefs.locale)}
							/>
						</div>
						<div className="settings-route__field">
							<span>Story list</span>
							<Select
								ariaLabel="Story list sort"
								onChange={value =>
									dispatch(
										setPref(
											'storyListSort',
											value as typeof prefs.storyListSort
										)
									)
								}
								options={storyListSortOptions}
								value={prefs.storyListSort}
							/>
						</div>
						<div className="settings-route__field">
							<span>Format list</span>
							<Select
								ariaLabel="Story format list filter"
								onChange={value =>
									dispatch(
										setPref(
											'storyFormatListFilter',
											value as typeof prefs.storyFormatListFilter
										)
									)
								}
								options={formatFilterOptions}
								value={prefs.storyFormatListFilter}
							/>
						</div>
					</div>
				</Panel>

				<Panel icon="folder" pad title="Workspace">
					<div className="settings-route__stack">
						<Input
							block
							icon="database"
							label="Story library"
							readOnly
							value={storyLibraryFolder || 'Native desktop default'}
						/>
						<div className="settings-route__button-row">
							<Button
								disabled={!desktopBridge?.chooseStoryLibraryFolder}
								icon="folder-open"
								onClick={chooseStoryLibraryFolder}
							>
								Choose Library
							</Button>
							<Button
								disabled={!desktopBridge?.resetStoryLibraryFolder}
								icon="refresh"
								onClick={resetStoryLibraryFolder}
							>
								Reset Library
							</Button>
							<Button
								disabled={!desktopBridge?.revealStoryLibraryFolder}
								icon="arrow-up-right"
								onClick={revealStoryLibraryFolder}
							>
								Reveal
							</Button>
						</div>
						<Input
							block
							icon="folder"
							label="Project default"
							onChange={event =>
								dispatch(setPref('defaultProjectFolder', event.target.value))
							}
							placeholder="Use app default"
							value={prefs.defaultProjectFolder}
						/>
					</div>
				</Panel>

				<Panel icon="layout-dashboard" pad title="Modes">
					<div className="settings-route__stack">
						<div className="settings-route__field">
							<span>Startup mode</span>
							<Select
								ariaLabel="Startup editor mode"
								onChange={value =>
									dispatch(
										setPref(
											'preferredStoryEditMode',
											value as StoryEditModePreference
										)
									)
								}
								options={modeOptions}
								value={prefs.preferredStoryEditMode}
							/>
						</div>
						<SettingsStatus
							icon="history"
							label="Per-project memory"
							value="On"
						/>
						<SettingsStatus
							icon="layout-sidebar"
							label="Dock memory"
							value="On"
						/>
					</div>
				</Panel>

				<Panel icon="binary-tree" pad title="Graph">
					<div className="settings-route__stack">
						<div className="settings-route__field">
							<span>Default card</span>
							<Select
								ariaLabel="Default graph card size"
								onChange={value =>
									dispatch(
										setPref(
											'graphDefaultCardSize',
											value as GraphCardSizePreference
										)
									)
								}
								options={graphCardSizeOptions}
								value={prefs.graphDefaultCardSize}
							/>
						</div>
						<Switch
							checked={prefs.graphGeneratedLayoutSavePrompt}
							label="Show generated layout save action"
							onChange={value =>
								dispatch(setPref('graphGeneratedLayoutSavePrompt', value))
							}
						/>
						<Switch
							checked={prefs.graphRightClickCreatePassage}
							label="Right-click creates passages"
							onChange={value =>
								dispatch(setPref('graphRightClickCreatePassage', value))
							}
						/>
						<div className="settings-route__field">
							<span>Passage cards</span>
							<Select
								ariaLabel="Passage card tag display"
								onChange={value =>
									dispatch(
										setPref(
											'passageTagDisplay',
											value as typeof prefs.passageTagDisplay
										)
									)
								}
								options={tagDisplayOptions}
								value={prefs.passageTagDisplay}
							/>
						</div>
						<SettingsStatus icon="grid-dots" label="Snap grid" value="Story" />
					</div>
				</Panel>

				<Panel icon="code" pad title="Editors">
					<div className="settings-route__stack">
						<Switch
							checked={prefs.editorCursorBlinks}
							label="Blinking cursor"
							onChange={value => dispatch(setPref('editorCursorBlinks', value))}
						/>
						<div className="settings-route__field">
							<span>Passage type</span>
							<Select
								ariaLabel="Passage editor font scale"
								onChange={value =>
									dispatch(setPref('passageEditorFontScale', Number(value)))
								}
								options={fontScaleOptions}
								value={String(prefs.passageEditorFontScale)}
							/>
						</div>
						<div className="settings-route__field">
							<span>Code type</span>
							<Select
								ariaLabel="Code editor font scale"
								onChange={value =>
									dispatch(setPref('codeEditorFontScale', Number(value)))
								}
								options={fontScaleOptions}
								value={String(prefs.codeEditorFontScale)}
							/>
						</div>
						<div className="settings-route__field">
							<span>Code theme</span>
							<Select
								ariaLabel="Code editor theme"
								onChange={value =>
									dispatch(
										setPref(
											'codeEditorTheme',
											value as CodeEditorThemePreference
										)
									)
								}
								options={codeEditorThemeOptions}
								value={prefs.codeEditorTheme}
							/>
						</div>
					</div>
				</Panel>

				<Panel icon="eye" pad title="Accessibility">
					<div className="settings-route__stack">
						<Switch
							checked={prefs.reducedMotion}
							label="Reduce motion"
							onChange={value => dispatch(setPref('reducedMotion', value))}
						/>
						<Switch
							checked={prefs.highContrast}
							label="High contrast"
							onChange={value => dispatch(setPref('highContrast', value))}
						/>
						<Switch
							checked={prefs.keyboardOnlyEditing}
							label="Keyboard-only editing"
							onChange={value =>
								dispatch(setPref('keyboardOnlyEditing', value))
							}
						/>
						<div className="settings-route__field">
							<span>Editor focus</span>
							<Select
								ariaLabel="Editor focus"
								onChange={value =>
									dispatch(
										setPref(
											'editorFocusPreference',
											value as EditorFocusPreference
										)
									)
								}
								options={editorFocusOptions}
								value={prefs.editorFocusPreference}
							/>
						</div>
						<SettingsStatus
							icon="focus-centered"
							label="Focus rings"
							value="Always"
						/>
					</div>
				</Panel>

				<Panel icon="keyboard" pad title="Keyboard">
					<div className="settings-route__stack">
						<div className="settings-route__field">
							<span>Shortcut profile</span>
							<Select
								ariaLabel="Shortcut profile"
								onChange={value =>
									dispatch(
										setPref(
											'keybindingPreset',
											value as typeof prefs.keybindingPreset
										)
									)
								}
								options={keybindingOptions}
								value={prefs.keybindingPreset}
							/>
						</div>
						<SettingsStatus icon="command" label="Command palette" value="On" />
						<SettingsStatus
							icon="accessibility"
							label="Editing access"
							value={prefs.keyboardOnlyEditing ? 'Keyboard' : 'Pointer'}
						/>
					</div>
				</Panel>

				<Panel icon="database" pad title="Storage">
					<div className="settings-route__stack">
						<Input
							block
							icon="photo"
							label="Asset folder"
							onChange={event =>
								dispatch(setPref('defaultAssetFolder', event.target.value))
							}
							placeholder="Use project assets/"
							value={prefs.defaultAssetFolder}
						/>
						<SettingsStatus
							icon="device-desktop"
							label="Primary storage"
							value={nativeDesktop ? 'Native' : 'Browser'}
						/>
						<SettingsStatus
							icon="file-type-json"
							label="Fallback API"
							value="Filesystem"
						/>
						<div className="settings-route__field">
							<span>Preview assets</span>
							<Select
								ariaLabel="Preview assets"
								disabled={!platformControlsAvailable}
								onChange={value =>
									void updatePlatformSettings({
										scratchAssetStrategy: value as NativeScratchAssetStrategy
									})
								}
								options={scratchAssetStrategyOptions}
								value={platformView.scratchAssetStrategy}
							/>
						</div>
						<div className="settings-route__field">
							<span>Cache cleanup</span>
							<Select
								ariaLabel="Cache cleanup"
								disabled={!platformControlsAvailable}
								onChange={value =>
									void updatePlatformSettings({
										cacheCleanupDays: Number(value)
									})
								}
								options={cacheCleanupOptions}
								value={String(platformView.cacheCleanupDays)}
							/>
						</div>
					</div>
				</Panel>

				<Panel icon="archive" pad title="Backups">
					<div className="settings-route__stack">
						<div className="settings-route__field">
							<span>Cadence</span>
							<Select
								ariaLabel="Backup cadence"
								disabled={!platformControlsAvailable}
								onChange={value =>
									void updatePlatformSettings({
										backupCadenceMinutes: Number(value)
									})
								}
								options={backupCadenceOptions}
								value={String(platformView.backupCadenceMinutes)}
							/>
						</div>
						<div className="settings-route__field">
							<span>Retention</span>
							<Select
								ariaLabel="Backup retention"
								disabled={!platformControlsAvailable}
								onChange={value =>
									void updatePlatformSettings({
										backupRetentionLimit: Number(value)
									})
								}
								options={backupRetentionOptions}
								value={String(platformView.backupRetentionLimit)}
							/>
						</div>
						<div className="settings-route__field">
							<span>Reminder</span>
							<Select
								ariaLabel="Backup reminder"
								disabled={!platformControlsAvailable}
								onChange={value =>
									void updatePlatformSettings({
										backupReminderDays: Number(value)
									})
								}
								options={backupReminderOptions}
								value={String(platformView.backupReminderDays)}
							/>
						</div>
						<SettingsStatus
							icon="clock"
							label="Backup review"
							value={
								platformControlsAvailable
									? backupReviewLabel(platformView)
									: 'Native only'
							}
						/>
						{lastBackupResult && (
							<SettingsStatus
								icon="copy-check"
								label="Last backup"
								value={compactDateTime(lastBackupResult.createdAt)}
							/>
						)}
						<div className="settings-route__button-row">
							<Button
								disabled={!desktopBridge?.runStoryLibraryBackup}
								icon="copy-check"
								loading={backupRunning}
								onClick={runStoryLibraryBackup}
							>
								Back Up
							</Button>
							<Button
								disabled={!platformControlsAvailable}
								icon="checks"
								onClick={recordBackupReview}
							>
								Reviewed
							</Button>
							<Button
								disabled={!desktopBridge?.revealBackupFolder}
								icon="folder-up"
								onClick={revealBackupFolder}
							>
								Reveal
							</Button>
						</div>
					</div>
				</Panel>

				<Panel icon="components" pad title="Story Formats">
					<div className="settings-route__stack">
						<div className="settings-route__field">
							<span>Story format</span>
							<Select
								ariaLabel="Default story format"
								onChange={setStoryFormat}
								options={formatOptions}
								value={storyFormatValue}
							/>
						</div>
						<div className="settings-route__field">
							<span>Proof format</span>
							<Select
								ariaLabel="Default proofing format"
								onChange={setProofingFormat}
								options={formatOptions}
								value={proofingFormatValue}
							/>
						</div>
						<SettingsStatus
							icon="puzzle"
							label="Disabled extensions"
							value={prefs.disabledStoryFormatEditorExtensions.length}
						/>
					</div>
				</Panel>

				<Panel icon="package-export" pad title="Build">
					<div className="settings-route__stack">
						<SettingsStatus
							icon="file-code"
							label="Graph carrier"
							value="StoryData"
						/>
						<SettingsStatus
							icon="shield-check"
							label="Publish safety"
							value="On"
						/>
						<SettingsStatus
							icon="file-zip"
							label="Package descriptor"
							value="On"
						/>
					</div>
				</Panel>

				<Panel icon="plug" pad title="Integrations">
					<div className="settings-route__stack">
						<Input
							block
							disabled={!platformControlsAvailable}
							icon="terminal-2"
							label="External editor"
							onBlur={() =>
								void updatePlatformSettings({externalEditorCommand})
							}
							onChange={event => setExternalEditorCommand(event.target.value)}
							placeholder="Use system default"
							value={externalEditorCommand}
						/>
						<div className="settings-route__field">
							<span>Cloud save</span>
							<Select
								ariaLabel="Cloud save"
								onChange={value =>
									dispatch(
										setPref(
											'cloudSaveIntegration',
											value as IntegrationPreference
										)
									)
								}
								options={integrationOptions}
								value={prefs.cloudSaveIntegration}
							/>
						</div>
						<div className="settings-route__field">
							<span>Revision control</span>
							<Select
								ariaLabel="Revision control"
								onChange={value =>
									dispatch(
										setPref(
											'revisionControlIntegration',
											value as IntegrationPreference
										)
									)
								}
								options={integrationOptions}
								value={prefs.revisionControlIntegration}
							/>
						</div>
						<div className="settings-route__field">
							<span>Hosting publish</span>
							<Select
								ariaLabel="Hosting publish"
								onChange={value =>
									dispatch(
										setPref(
											'hostingPublishIntegration',
											value as IntegrationPreference
										)
									)
								}
								options={integrationOptions}
								value={prefs.hostingPublishIntegration}
							/>
						</div>
						<SettingsStatus
							icon="puzzle"
							label="Format extensions"
							value={`${prefs.disabledStoryFormatEditorExtensions.length} disabled`}
						/>
						<SettingsStatus
							icon="database"
							label="Storage mode"
							value={
								prefs.defaultProjectFolder ? 'Project folder' : 'App library'
							}
						/>
					</div>
				</Panel>

				<Panel icon="share" pad title="Sharing">
					<div className="settings-route__stack">
						<div className="settings-route__field">
							<span>Story links</span>
							<Select
								ariaLabel="Story links"
								onChange={value =>
									dispatch(
										setPref('shareLinkMode', value as SharingModePreference)
									)
								}
								options={sharingModeOptions}
								value={prefs.shareLinkMode}
							/>
						</div>
						<SettingsStatus
							icon="shield-lock"
							label="Local-only data"
							value="Warn"
						/>
						<SettingsStatus
							icon="cloud"
							label="Cloud hook"
							value={prefs.cloudSaveIntegration}
						/>
						<SettingsStatus
							icon="git-branch"
							label="Revision hook"
							value={prefs.revisionControlIntegration}
						/>
						<SettingsStatus
							icon="server"
							label="Hosting hook"
							value={prefs.hostingPublishIntegration}
						/>
					</div>
				</Panel>

				<Panel icon="device-desktop" pad title="Platform">
					<div className="settings-route__stack">
						<Switch
							checked={platformView.fullscreenPersistence}
							disabled={!platformControlsAvailable}
							label="Remember fullscreen"
							onChange={value =>
								void updatePlatformSettings({
									fullscreenPersistence: value
								})
							}
						/>
						<div className="settings-route__field">
							<span>External links</span>
							<Select
								ariaLabel="External links"
								disabled={!platformControlsAvailable}
								onChange={value =>
									void updatePlatformSettings({
										linkHandlingMode: value === 'block' ? 'block' : 'system'
									})
								}
								options={linkHandlingOptions}
								value={platformView.linkHandlingMode}
							/>
						</div>
						<SettingsStatus
							icon="device-desktop"
							label="Runtime"
							value={nativeDesktop ? 'Desktop bridge' : 'Web fallback'}
						/>
						<SettingsStatus
							icon="folder-cog"
							label="Story directory"
							value={storyLibraryFolder ? 'Configured' : 'Default'}
						/>
						<SettingsStatus
							icon="cpu"
							label="Hardware acceleration"
							value="App"
						/>
						<SettingsStatus
							icon="terminal"
							label="CLI open/help"
							value={nativeDesktop ? 'Enabled' : 'Desktop'}
						/>
						<SettingsStatus
							icon="package"
							label="Installers"
							value="Documented"
						/>
						<SettingsStatus
							icon="refresh"
							label="Updates"
							value={prefs.lastUpdateSeen || 'Manual'}
						/>
						<SettingsStatus
							icon="device-mobile"
							label="Mobile"
							value="Constrained"
						/>
					</div>
				</Panel>

				<Panel icon="info-circle" pad title="About">
					<div className="settings-route__stack">
						<SettingsStatus
							icon="sparkles"
							label="App"
							value={appInfo.name || 'Twine RS'}
						/>
						<SettingsStatus
							icon="git-branch"
							label="Version"
							value={appInfo.version || 'development'}
						/>
						<div className="settings-route__field">
							<span>Dialog width</span>
							<Select
								ariaLabel="Dialog width"
								onChange={value =>
									dispatch(setPref('dialogWidth', parseInt(value)))
								}
								options={dialogWidthOptions}
								value={prefs.dialogWidth.toString()}
							/>
						</div>
					</div>
				</Panel>
			</div>
		</div>
	);
};
