import * as React from 'react';
import {
	HashRouter,
	Route,
	Routes as RouterRoutes,
	useLocation
} from 'react-router';
import {AppShell} from '../components/app-shell';
import {AssetsRoute} from './assets';
import {BuildRoute} from './build';
import {CommandLineOpenSync} from './command-line-open-sync';
import {ContentsRoute} from './contents';
import {DiagnosticsRoute} from './diagnostics';
import {NewProjectRoute} from './new-project';
import {SettingsRoute} from './settings';
import {StoryFormatsRoute} from './story-formats';
import {StoryEditRoute} from './story-edit';
import {StoryListRoute} from './story-list';
import {StoryPlayRoute} from './story-play';
import {StoryProofRoute} from './story-proof';
import {StoryTestRoute} from './story-test';
import {StoryPreviewOwnerController} from './story-preview-owner-controller';

const UnmatchedRoute: React.FC = () => {
	const location = useLocation();

	console.warn(
		`No route for path "${location.pathname}", rendering story list`
	);
	return <StoryListRoute />;
};

export const Routes: React.FC = () => {
	// A <HashRouter> is used to make our lives easier--to load local story
	// formats, we need the document HREF to reflect where the HTML file is.
	// Otherwise we'd have to store the actual location somewhere, which will
	// differ between web and Electron contexts.

	return (
		<HashRouter>
			<CommandLineOpenSync />
			<StoryPreviewOwnerController />
			<AppShell>
				<RouterRoutes>
					<Route element={<StoryListRoute />} path="/" />
					<Route element={<StoryListRoute />} path="/welcome" />
					<Route element={<NewProjectRoute />} path="/new-project" />
					<Route element={<NewProjectRoute />} path="/new-project/import" />
					<Route element={<StoryFormatsRoute />} path="/formats" />
					<Route element={<SettingsRoute />} path="/settings" />
					<Route element={<BuildRoute />} path="/stories/:storyId/build" />
					<Route
						element={<ContentsRoute />}
						path="/stories/:storyId/contents"
					/>
					<Route
						element={<DiagnosticsRoute />}
						path="/stories/:storyId/diagnostics"
					/>
					<Route element={<AssetsRoute />} path="/stories/:storyId/assets" />
					<Route element={<StoryPlayRoute />} path="/stories/:storyId/play" />
					<Route element={<StoryProofRoute />} path="/stories/:storyId/proof" />
					<Route
						element={<StoryTestRoute />}
						path="/stories/:storyId/test/:passageId"
					/>
					<Route element={<StoryTestRoute />} path="/stories/:storyId/test" />
					<Route element={<StoryEditRoute />} path="/stories/:storyId" />
					<Route element={<UnmatchedRoute />} path="*" />
				</RouterRoutes>
			</AppShell>
		</HashRouter>
	);
};
