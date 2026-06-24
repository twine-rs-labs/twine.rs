import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import type {TwineElectronWindow} from '../../../electron/shared';
import {FakeStateProvider} from '../../../test-util';
import {SettingsRoute} from '../settings-route';

describe('<SettingsRoute>', () => {
	afterEach(() => {
		delete (window as TwineElectronWindow).twineElectron;
	});

	it('renders DS settings sections backed by preferences', () => {
		render(
			<FakeStateProvider
				prefs={{
					appTheme: 'dark',
					defaultAssetFolder: '/tmp/assets',
					defaultProjectFolder: '/tmp/projects',
					keybindingPreset: 'vim',
					useCodeMirror: true
				}}
			>
				<SettingsRoute />
			</FakeStateProvider>
		);

		expect(screen.getByRole('heading', {name: 'Settings'})).toBeInTheDocument();
		expect(screen.getByText('General')).toBeInTheDocument();
		expect(screen.getByText('Accessibility')).toBeInTheDocument();
		expect(screen.getAllByText('Keyboard').length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText('Editors')).toBeInTheDocument();
		expect(screen.getByText('Workspace')).toBeInTheDocument();
		expect(screen.getByText('Modes')).toBeInTheDocument();
		expect(screen.getByText('Default card')).toBeInTheDocument();
		expect(
			screen.getByText('Right-click creates passages')
		).toBeInTheDocument();
		expect(screen.getByText('Code theme')).toBeInTheDocument();
		expect(screen.getByText('Storage')).toBeInTheDocument();
		expect(screen.getByText('Backups')).toBeInTheDocument();
		expect(screen.getByText('Story Formats')).toBeInTheDocument();
		expect(screen.getByText('Graph carrier')).toBeInTheDocument();
		expect(screen.getByText('Integrations')).toBeInTheDocument();
		expect(screen.getByText('Sharing')).toBeInTheDocument();
		expect(screen.getByText('Platform')).toBeInTheDocument();
		expect(screen.getByText('About')).toBeInTheDocument();
		expect(screen.getByDisplayValue('/tmp/projects')).toBeInTheDocument();
		expect(screen.getByText('vim')).toBeInTheDocument();
		expect(screen.getByText('Keyboard-only editing')).toBeInTheDocument();
		expect(screen.getByText('Local-only data')).toBeInTheDocument();
	});

	it('updates preferences from settings controls', () => {
		render(
			<FakeStateProvider prefs={{defaultProjectFolder: ''}}>
				<SettingsRoute />
			</FakeStateProvider>
		);

		fireEvent.change(screen.getByLabelText('Project default'), {
			target: {value: '/Users/test/Stories'}
		});
		fireEvent.change(screen.getByLabelText('Code editor theme'), {
			target: {value: 'one-dark'}
		});
		fireEvent.click(screen.getByText('Right-click creates passages'));

		expect(screen.getByDisplayValue('/Users/test/Stories')).toBeInTheDocument();
		expect(screen.getByLabelText('Code editor theme')).toHaveValue('one-dark');
		expect(
			screen.getByLabelText('Right-click creates passages')
		).not.toBeChecked();
	});

	it('loads and updates native platform settings', async () => {
		const resetStoryLibraryFolder = jest.fn(
			async () => '/native/default-library'
		);
		const updatePlatformSettings = jest.fn(async settings => ({
			backupCadenceMinutes: 20,
			backupFolderPath: '/native/backups',
			backupLastReviewedTime: 0,
			backupReminderDays: settings.backupReminderDays ?? 7,
			backupRetentionLimit: 10,
			cacheCleanupDays: 3,
			externalEditorCommand: '',
			fullscreenPersistence: true,
			lastWindowFullscreen: false,
			linkHandlingMode: 'system',
			scratchAssetStrategy: settings.scratchAssetStrategy ?? 'link',
			storyLibraryFolderPath: '/native/library'
		}));

		(window as TwineElectronWindow).twineElectron = {
			getPlatformSettings: jest.fn(async () => ({
				backupCadenceMinutes: 20,
				backupFolderPath: '/native/backups',
				backupLastReviewedTime: 0,
				backupReminderDays: 7,
				backupRetentionLimit: 10,
				cacheCleanupDays: 3,
				externalEditorCommand: '',
				fullscreenPersistence: true,
				lastWindowFullscreen: false,
				linkHandlingMode: 'system',
				scratchAssetStrategy: 'link',
				storyLibraryFolderPath: '/native/library'
			})),
			getStoryLibraryFolder: jest.fn(async () => '/native/library'),
			resetStoryLibraryFolder,
			updatePlatformSettings
		} as any;

		render(
			<FakeStateProvider prefs={{shareLinkMode: 'local-file'}}>
				<SettingsRoute />
			</FakeStateProvider>
		);

		expect(
			await screen.findByDisplayValue('/native/library')
		).toBeInTheDocument();
		expect(screen.getByLabelText('Preview assets')).toHaveValue('link');

		fireEvent.change(screen.getByLabelText('Backup reminder'), {
			target: {value: '14'}
		});

		await waitFor(() =>
			expect(updatePlatformSettings).toHaveBeenCalledWith({
				backupReminderDays: 14
			})
		);

		fireEvent.change(screen.getByLabelText('Preview assets'), {
			target: {value: 'copy'}
		});

		await waitFor(() =>
			expect(updatePlatformSettings).toHaveBeenCalledWith({
				scratchAssetStrategy: 'copy'
			})
		);

		fireEvent.click(screen.getByText('Reset Library'));

		await waitFor(() =>
			expect(resetStoryLibraryFolder).toHaveBeenCalledTimes(1)
		);
		expect(
			screen.getByDisplayValue('/native/default-library')
		).toBeInTheDocument();
	});
});
