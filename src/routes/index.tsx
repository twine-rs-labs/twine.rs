import * as React from 'react';
import {HashRouter, Route, Switch} from 'react-router-dom';
import {AppShell} from '../components/app-shell';
import {AssetsRoute} from './assets';
import {BuildRoute} from './build';
import {ContentsRoute} from './contents';
import {DiagnosticsRoute} from './diagnostics';
import {NewProjectRoute} from './new-project';
import {StoryFormatsRoute} from './story-formats';
import {StoryEditRoute} from './story-edit';
import {StoryListRoute} from './story-list';
import {StoryPlayRoute} from './story-play';
import {StoryProofRoute} from './story-proof';
import {StoryTestRoute} from './story-test';

export const Routes: React.FC = () => {
	// A <HashRouter> is used to make our lives easier--to load local story
	// formats, we need the document HREF to reflect where the HTML file is.
	// Otherwise we'd have to store the actual location somewhere, which will
	// differ between web and Electron contexts.

	return (
		<HashRouter>
			<AppShell>
				<Switch>
					<Route exact path="/">
						<StoryListRoute />
					</Route>
					<Route exact path="/welcome">
						<StoryListRoute />
					</Route>
					<Route exact path="/new-project">
						<NewProjectRoute />
					</Route>
					<Route path="/new-project/import">
						<NewProjectRoute />
					</Route>
					<Route exact path="/formats">
						<StoryFormatsRoute />
					</Route>
					<Route path="/stories/:storyId/build">
						<BuildRoute />
					</Route>
					<Route path="/stories/:storyId/contents">
						<ContentsRoute />
					</Route>
					<Route path="/stories/:storyId/diagnostics">
						<DiagnosticsRoute />
					</Route>
					<Route path="/stories/:storyId/assets">
						<AssetsRoute />
					</Route>
					<Route path="/stories/:storyId/play">
						<StoryPlayRoute />
					</Route>
					<Route path="/stories/:storyId/proof">
						<StoryProofRoute />
					</Route>
					<Route path="/stories/:storyId/test/:passageId">
						<StoryTestRoute />
					</Route>
					<Route path="/stories/:storyId/test">
						<StoryTestRoute />
					</Route>
					<Route path="/stories/:storyId">
						<StoryEditRoute />
					</Route>
					<Route
						path="*"
						render={path => {
							console.warn(
								`No route for path "${path.location.pathname}", rendering story list`
							);
							return <StoryListRoute />;
						}}
					></Route>
				</Switch>
			</AppShell>
		</HashRouter>
	);
};
