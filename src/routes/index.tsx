import * as React from 'react';
import {
	createHashRouter,
	createRoutesFromElements,
	Outlet,
	Route,
	RouterProvider,
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
import {StoryPreviewRoute} from './story-preview';
import {StoryPreviewOwnerController} from './story-preview-owner-controller';
import {BrowserStoryPreviewOwnerController} from './browser-story-preview-owner-controller';

const UnmatchedRoute: React.FC = () => {
	const location = useLocation();

	console.warn(
		`No route for path "${location.pathname}", rendering story list`
	);
	return <StoryListRoute />;
};

const RootRoute: React.FC = () => (
	<>
		<CommandLineOpenSync />
		<StoryPreviewOwnerController />
		<BrowserStoryPreviewOwnerController />
		<AppShell>
			<Outlet />
		</AppShell>
	</>
);

function createAppRouter() {
	return createHashRouter(
		createRoutesFromElements(
			<Route element={<RootRoute />}>
				<Route element={<StoryListRoute />} path="/" />
				<Route element={<StoryListRoute />} path="/welcome" />
				<Route element={<NewProjectRoute />} path="/new-project" />
				<Route element={<NewProjectRoute />} path="/new-project/import" />
				<Route element={<StoryFormatsRoute />} path="/formats" />
				<Route element={<SettingsRoute />} path="/settings" />
				<Route element={<BuildRoute />} path="/stories/:storyId/build" />
				<Route element={<ContentsRoute />} path="/stories/:storyId/contents" />
				<Route
					element={<DiagnosticsRoute />}
					path="/stories/:storyId/diagnostics"
				/>
				<Route element={<AssetsRoute />} path="/stories/:storyId/assets" />
				<Route
					element={<StoryPreviewRoute />}
					path="/stories/:storyId/preview"
				/>
				<Route element={<StoryEditRoute />} path="/stories/:storyId" />
				<Route element={<UnmatchedRoute />} path="*" />
			</Route>
		)
	);
}

export const Routes: React.FC = () => {
	// A hash router is used to make our lives easier--to load local story
	// formats, we need the document HREF to reflect where the HTML file is.
	// Otherwise we'd have to store the actual location somewhere, which will
	// differ between web and Electron contexts.
	//
	// The data-router form also lets the workbench block history and direct
	// route transitions until its renderer-local buffers are durably committed.
	const router = React.useMemo(createAppRouter, []);

	return <RouterProvider router={router} />;
};
