import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {FakeStateProvider} from '../../../test-util';
import {SettingsRoute} from '../settings-route';

describe('<SettingsRoute>', () => {
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
		expect(screen.getByText('Keyboard')).toBeInTheDocument();
		expect(screen.getByText('Editors')).toBeInTheDocument();
		expect(screen.getByText('Workspace')).toBeInTheDocument();
		expect(screen.getByText('Modes')).toBeInTheDocument();
		expect(screen.getByText('Default card')).toBeInTheDocument();
		expect(screen.getByText('Storage')).toBeInTheDocument();
		expect(screen.getByText('Backups')).toBeInTheDocument();
		expect(screen.getByText('Story Formats')).toBeInTheDocument();
		expect(screen.getByText('Graph carrier')).toBeInTheDocument();
		expect(screen.getByText('Integrations')).toBeInTheDocument();
		expect(screen.getByText('Platform')).toBeInTheDocument();
		expect(screen.getByText('About')).toBeInTheDocument();
		expect(screen.getByDisplayValue('/tmp/projects')).toBeInTheDocument();
		expect(screen.getByText('vim')).toBeInTheDocument();
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

		expect(screen.getByDisplayValue('/Users/test/Stories')).toBeInTheDocument();
	});
});
