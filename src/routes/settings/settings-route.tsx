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
import {useStoryFormatsContext} from '../../store/story-formats';
import {setPref, usePrefsContext} from '../../store/prefs';
import type {
	GraphCardSizePreference,
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

const graphCardSizeOptions = [
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

function formatPreferenceValue(format: {name: string; version: string}) {
	return `${format.name}\u0000${format.version}`;
}

function parseFormatPreferenceValue(value: string) {
	const [name, version] = value.split('\u0000');

	return {name, version};
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
	const appInfo = getAppInfo();
	const formatOptions = formats.map(format => ({
		label: `${format.name} ${format.version}`,
		value: formatPreferenceValue(format)
	}));
	const storyFormatValue = formatPreferenceValue(prefs.storyFormat);
	const proofingFormatValue = formatPreferenceValue(prefs.proofingFormat);
	const desktopBridge = (window as TwineElectronWindow).twineElectron;
	const nativeDesktop = isElectronRenderer() || !!desktopBridge;

	React.useEffect(() => {
		let cancelled = false;

		(window as TwineElectronWindow).twineElectron?.getStoryLibraryFolder?.()
			.then(path => {
				if (!cancelled) {
					setStoryLibraryFolder(path);
				}
			})
			.catch(() => undefined);

		return () => {
			cancelled = true;
		};
	}, []);

	function setUseCodeMirror(value: boolean) {
		dispatch(setPref('useCodeMirror', value));

		if (!value) {
			dispatch(setPref('editorCursorBlinks', true));
		}
	}

	async function chooseStoryLibraryFolder() {
		const path = await (window as TwineElectronWindow).twineElectron
			?.chooseStoryLibraryFolder?.();

		if (path) {
			setStoryLibraryFolder(path);
		}
	}

	function revealStoryLibraryFolder() {
		void (window as TwineElectronWindow).twineElectron?.revealStoryLibraryFolder?.();
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
						<Badge icon="device-desktop" tone={nativeDesktop ? 'saved' : 'neutral'}>
							{nativeDesktop ? 'Native desktop' : 'Filesystem fallback'}
						</Badge>
						<Badge icon="keyboard" tone="neutral">
							{prefs.keybindingPreset}
						</Badge>
						<Badge icon="palette" tone="neutral">
							{prefs.appTheme}
						</Badge>
						<Badge icon="code" tone={prefs.useCodeMirror ? 'saved' : 'neutral'}>
							Enhanced editors
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
							checked={prefs.useCodeMirror}
							label="Enhanced editors"
							onChange={setUseCodeMirror}
						/>
						<Switch
							checked={prefs.editorCursorBlinks}
							disabled={!prefs.useCodeMirror}
							label="Blinking cursor"
							onChange={value =>
								dispatch(setPref('editorCursorBlinks', value))
							}
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
					</div>
				</Panel>

				<Panel icon="archive" pad title="Backups">
					<div className="settings-route__stack">
						<SettingsStatus
							icon="copy-check"
							label="Dirty-save backup"
							value="On"
						/>
						<SettingsStatus
							icon="clock"
							label="Last update check"
							value={
								prefs.lastUpdateCheckTime
									? new Date(prefs.lastUpdateCheckTime).toLocaleDateString()
									: 'Never'
							}
						/>
						<SettingsStatus
							icon="refresh"
							label="Last version seen"
							value={prefs.lastUpdateSeen || 'None'}
						/>
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
						<div className="settings-route__integration">
							<TablerIcon icon="puzzle" />
							<div>
								<b>Story format extensions</b>
								<span>
									{prefs.disabledStoryFormatEditorExtensions.length} disabled
								</span>
							</div>
						</div>
						<div className="settings-route__integration">
							<TablerIcon icon="database" />
							<div>
								<b>Storage mode</b>
								<span>
									{prefs.defaultProjectFolder
										? 'Project folder preferred'
										: 'App library default'}
								</span>
							</div>
						</div>
						<div className="settings-route__integration">
							<TablerIcon icon="terminal-2" />
							<div>
								<b>External editor</b>
								<span>Not configured</span>
							</div>
						</div>
					</div>
				</Panel>

				<Panel icon="device-desktop" pad title="Platform">
					<div className="settings-route__stack">
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
					</div>
				</Panel>

				<Panel icon="info-circle" pad title="About">
					<div className="settings-route__stack">
						<SettingsStatus
							icon="sparkles"
							label="App"
							value={appInfo.name || 'Twine'}
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
