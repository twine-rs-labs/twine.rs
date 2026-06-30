import './styles/design-system/index.css';
import './styles/typography.css';
import * as React from 'react';
import {GlobalErrorBoundary} from './components/error';
import {LoadingCurtain} from './components/loading-curtain/loading-curtain';
import {LocaleSwitcher} from './store/locale-switcher';
import {PrefsContextProvider} from './store/prefs';
import {Routes} from './routes';
import {StoriesContextProvider} from './store/stories';
import {StoryFormatsContextProvider} from './store/story-formats';
import {ProjectSessionSync} from './store/project-session-sync';
import {StateLoader} from './store/state-loader';
import {ThemeSetter} from './store/theme-setter';
import {CoreProjectHostProvider} from './core';

export const App: React.FC = () => (
	<GlobalErrorBoundary>
		<PrefsContextProvider>
			<LocaleSwitcher />
			<ThemeSetter />
			<StoryFormatsContextProvider>
				<StoriesContextProvider>
					<StateLoader>
						<CoreProjectHostProvider>
							<ProjectSessionSync />
							<React.Suspense fallback={<LoadingCurtain />}>
								<Routes />
							</React.Suspense>
						</CoreProjectHostProvider>
					</StateLoader>
				</StoriesContextProvider>
			</StoryFormatsContextProvider>
		</PrefsContextProvider>
	</GlobalErrorBoundary>
);
