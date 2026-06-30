import orderBy from 'lodash/orderBy';
import * as React from 'react';
import {useHistory} from 'react-router-dom';
import {ClickAwayListener} from '../../components/click-away-listener';
import {SafariWarningCard} from '../../components/error';
import {
	Badge,
	Button,
	IconButton,
	Input,
	Panel,
	SegmentedControl,
	Select,
	TablerIcon,
	Tag
} from '../../components/design-system';
import {
	deleteStoryCommand,
	storyLinkFacts,
	useCoreProjectHost
} from '../../core';
import type {CoreStoryIndex} from '../../core';
import {
	AppDonationDialog,
	DialogsContextProvider,
	useDialogsContext
} from '../../dialogs';
import {storyFileName} from '../../electron/shared';
import {usePrefsContext} from '../../store/prefs';
import {useDonationCheck} from '../../store/prefs/use-donation-check';
import {
	deselectAllStories,
	deselectStory,
	selectStory,
	Story,
	useStoriesContext
} from '../../store/stories';
import {
	deleteProjectMetadata,
	loadProjectMetadata
} from '../../store/project-metadata';
import type {TwineElectronWindow} from '../../electron/shared';
import './story-list-route.css';

type LauncherView = 'table' | 'cards';

function formatDate(date: Date) {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(date);
}

function wordCount(story: Story) {
	return story.passages.reduce((total, passage) => {
		const text = passage.text.trim();

		return total + (text ? text.split(/\s+/).length : 0);
	}, 0);
}

function allTags(stories: Story[]) {
	return Array.from(new Set(stories.flatMap(story => story.tags))).sort();
}

function storyHealth(index: CoreStoryIndex | undefined) {
	if (!index) {
		return {brokenLinks: 0, errors: 0};
	}

	const errors = index.diagnostics.filter(
		diagnostic => diagnostic.severity === 'error'
	).length;

	return {brokenLinks: index.graph.brokenLinks, errors};
}

function desktopBridge() {
	return (window as TwineElectronWindow).twineElectron;
}

function fileBackedProjectRoot(story: Story) {
	const metadata = loadProjectMetadata(story.id);

	return metadata?.storageKind === 'electron-project-folder' &&
		metadata.status === 'file-backed'
		? metadata.rootPath
		: undefined;
}

function ProjectMiniMap({story}: {story: Story}) {
	const passages = story.passages.slice(0, 18);
	const passageIndex = React.useMemo(
		() => new Map(story.passages.map((passage, index) => [passage.id, index])),
		[story.passages]
	);
	const links = React.useMemo(
		() =>
			storyLinkFacts(story)
				.map(link => ({
					from: passageIndex.get(link.sourceId) ?? -1,
					to: link.targetId ? (passageIndex.get(link.targetId) ?? -1) : -1
				}))
				.filter(link => link.to >= 0)
				.slice(0, 12),
		[passageIndex, story]
	);

	return (
		<svg
			aria-hidden
			className="story-list-launcher__map"
			focusable="false"
			viewBox="0 0 180 96"
		>
			{links.map((link, index) => (
				<line
					key={`${link.from}-${link.to}-${index}`}
					x1={22 + (link.from % 6) * 27}
					x2={22 + (link.to % 6) * 27}
					y1={22 + Math.floor(link.from / 6) * 27}
					y2={22 + Math.floor(link.to / 6) * 27}
				/>
			))}
			{passages.map((passage, index) => (
				<circle
					className={
						passage.id === story.startPassage
							? 'story-list-launcher__map-start'
							: undefined
					}
					cx={22 + (index % 6) * 27}
					cy={22 + Math.floor(index / 6) * 27}
					key={passage.id}
					r="6"
				/>
			))}
		</svg>
	);
}

function HealthBadges({story}: {story: Story}) {
	const coreProjectHost = useCoreProjectHost();
	const [index, setIndex] = React.useState<CoreStoryIndex>();
	const health = storyHealth(index);

	React.useEffect(() => {
		let active = true;

		setIndex(undefined);
		void coreProjectHost
			.queryStoryIndexAsync(story.id, {
				includeAssets: false,
				includeContents: false,
				includeFiles: false,
				includePassageNames: false,
				includePassageText: false,
				includeScript: false,
				includeStylesheet: false,
				includeTags: false,
				includeVariables: false
			})
			.then(index => {
				if (active) {
					setIndex(index);
				}
			});

		return () => {
			active = false;
		};
	}, [coreProjectHost, story.id, story]);

	return (
		<div className="story-list-launcher__health">
			<Badge
				icon={health.errors > 0 ? 'alert-octagon' : 'circle-check'}
				tone={health.errors > 0 ? 'error' : 'saved'}
			>
				{health.errors} errors
			</Badge>
			<Badge
				icon={health.brokenLinks > 0 ? 'unlink' : 'link'}
				tone={health.brokenLinks > 0 ? 'warn' : 'neutral'}
			>
				{health.brokenLinks} broken
			</Badge>
		</div>
	);
}

export const InnerStoryListRoute: React.FC = () => {
	const history = useHistory();
	const {dispatch: dialogsDispatch} = useDialogsContext();
	const {dispatch: prefsDispatch, prefs} = usePrefsContext();
	const {dispatch: storiesDispatch, stories} = useStoriesContext();
	const coreProjectHost = useCoreProjectHost();
	const {shouldShowDonationPrompt} = useDonationCheck();
	const [query, setQuery] = React.useState('');
	const [view, setView] = React.useState<LauncherView>('table');
	const selectedStories = React.useMemo(
		() => stories.filter(story => story.selected),
		[stories]
	);
	const tags = React.useMemo(() => allTags(stories), [stories]);

	const visibleStories = React.useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		const taggedStories =
			prefs.storyListTagFilter.length > 0
				? stories.filter(story =>
						story.tags.some(tag => prefs.storyListTagFilter.includes(tag))
					)
				: stories;
		const searchedStories =
			normalizedQuery.length > 0
				? taggedStories.filter(story => {
						const haystack = [
							story.name,
							story.ifid,
							story.storyFormat,
							story.storyFormatVersion,
							...story.tags
						]
							.join(' ')
							.toLowerCase();

						return haystack.includes(normalizedQuery);
					})
				: taggedStories;

		switch (prefs.storyListSort) {
			case 'date':
				return orderBy(searchedStories, ['lastUpdate'], ['desc']);
			case 'name':
				return orderBy(searchedStories, story => story.name.toLowerCase());
		}
	}, [prefs.storyListSort, prefs.storyListTagFilter, query, stories]);

	React.useEffect(() => {
		for (const story of selectedStories) {
			if (story.selected && !visibleStories.includes(story)) {
				storiesDispatch(deselectStory(story));
			}
		}
	}, [selectedStories, storiesDispatch, visibleStories]);

	React.useEffect(() => {
		if (shouldShowDonationPrompt()) {
			dialogsDispatch({type: 'addDialog', component: AppDonationDialog});
		}
	}, [dialogsDispatch, shouldShowDonationPrompt]);

	function selectTag(tag: string) {
		prefsDispatch({
			name: 'storyListTagFilter',
			type: 'update',
			value: prefs.storyListTagFilter.includes(tag)
				? prefs.storyListTagFilter.filter(existing => existing !== tag)
				: [...prefs.storyListTagFilter, tag]
		});
	}

	function openStory(story: Story) {
		history.push(`/stories/${story.id}`);
	}

	function selectProject(story: Story, additive: boolean) {
		storiesDispatch(selectStory(story, !additive));
	}

	async function deleteStory(story: Story) {
		const rootPath = fileBackedProjectRoot(story);
		const twineElectron = desktopBridge();
		const canDeleteProjectFolder =
			rootPath && twineElectron?.deleteProjectFolder;
		const projectStories = canDeleteProjectFolder
			? stories.filter(
					candidate => fileBackedProjectRoot(candidate) === rootPath
				)
			: [story];
		const confirmed = canDeleteProjectFolder
			? window.confirm(
					[
						`Delete project "${story.name}"?`,
						'',
						`This will delete files from ${rootPath}.`,
						'',
						`It will remove ${projectStories.length} ${
							projectStories.length === 1 ? 'story' : 'stories'
						} from this library. This cannot be undone.`
					].join('\n')
				)
			: window.confirm(
					[
						`Delete story "${story.name}"?`,
						'',
						'This will remove it from this library. This cannot be undone.'
					].join('\n')
				);

		if (!confirmed) {
			return;
		}

		if (canDeleteProjectFolder) {
			await twineElectron.deleteProjectFolder(rootPath);
		}

		for (const projectStory of projectStories) {
			deleteProjectMetadata(projectStory.id);
			coreProjectHost.applyStoryCommand(deleteStoryCommand(projectStory.id));
		}
	}

	function stopAndOpenStory(
		story: Story,
		event: React.MouseEvent<HTMLButtonElement>
	) {
		event.stopPropagation();
		openStory(story);
	}

	function stopAndDeleteStory(
		story: Story,
		event: React.MouseEvent<HTMLButtonElement>
	) {
		event.stopPropagation();
		void deleteStory(story);
	}

	return (
		<div className="story-list-launcher">
			<aside className="story-list-launcher__rail" aria-label="Project actions">
				<Button
					block
					icon="plus"
					onClick={() => history.push('/new-project')}
					variant="primary"
				>
					New Project
				</Button>
				<Button
					block
					icon="file-import"
					onClick={() => history.push('/new-project/import')}
				>
					Import
				</Button>
				<div className="story-list-launcher__rail-section">
					<span className="story-list-launcher__rail-title">Library</span>
					<button
						className="story-list-launcher__rail-item"
						onClick={() =>
							prefsDispatch({
								name: 'storyListTagFilter',
								type: 'update',
								value: []
							})
						}
						type="button"
					>
						<TablerIcon icon="files" />
						<span>All projects</span>
						<Badge>{stories.length}</Badge>
					</button>
					<button
						className="story-list-launcher__rail-item"
						onClick={() =>
							prefsDispatch({
								name: 'storyListSort',
								type: 'update',
								value: 'date'
							})
						}
						type="button"
					>
						<TablerIcon icon="clock" />
						<span>Recently edited</span>
					</button>
				</div>
				{tags.length > 0 && (
					<div className="story-list-launcher__rail-section">
						<span className="story-list-launcher__rail-title">Tags</span>
						<div className="story-list-launcher__tag-list">
							{tags.map(tag => (
								<Tag
									aria-pressed={prefs.storyListTagFilter.includes(tag)}
									className={
										prefs.storyListTagFilter.includes(tag)
											? 'story-list-launcher__tag--active'
											: undefined
									}
									key={tag}
									onClick={() => selectTag(tag)}
								>
									{tag}
								</Tag>
							))}
						</div>
					</div>
				)}
			</aside>
			<section className="story-list-launcher__main">
				<header className="story-list-launcher__head">
					<div>
						<h1>Projects</h1>
						<p>
							{visibleStories.length} of {stories.length} projects
						</p>
					</div>
					<div className="story-list-launcher__head-actions">
						<Input
							aria-label="Search projects"
							icon="search"
							onChange={event => setQuery(event.target.value)}
							placeholder="Search projects"
							value={query}
						/>
						<Select
							ariaLabel="Sort projects"
							onChange={value =>
								prefsDispatch({
									name: 'storyListSort',
									type: 'update',
									value
								})
							}
							options={[
								{label: 'Name', value: 'name'},
								{label: 'Last modified', value: 'date'}
							]}
							size="sm"
							value={prefs.storyListSort}
						/>
						<SegmentedControl
							onChange={value => setView(value as LauncherView)}
							options={[
								{icon: 'list-details', label: 'Table', value: 'table'},
								{icon: 'layout-grid', label: 'Cards', value: 'cards'}
							]}
							size="sm"
							value={view}
						/>
					</div>
				</header>
				<SafariWarningCard />
				<ClickAwayListener
					ignoreSelector=".story-list-launcher__project"
					onClickAway={() => storiesDispatch(deselectAllStories())}
				>
					<Panel
						className="story-list-launcher__panel"
						count={visibleStories.length}
						icon={view === 'table' ? 'list-details' : 'layout-grid'}
						title="Library"
					>
						{stories.length === 0 ? (
							<div className="story-list-launcher__empty">
								<TablerIcon icon="folder-plus" />
								<h2>No projects yet</h2>
								<p>Create a Twine project or import an existing archive.</p>
								<div>
									<Button
										icon="plus"
										onClick={() => history.push('/new-project')}
										variant="primary"
									>
										New Project
									</Button>
									<Button
										icon="file-import"
										onClick={() => history.push('/new-project/import')}
									>
										Import
									</Button>
								</div>
							</div>
						) : visibleStories.length === 0 ? (
							<div className="story-list-launcher__empty">
								<TablerIcon icon="search" />
								<h2>No matches</h2>
								<p>Adjust the search or tag filters.</p>
							</div>
						) : view === 'table' ? (
							<div className="story-list-launcher__table-wrap">
								<table className="story-list-launcher__table">
									<thead>
										<tr>
											<th>Project</th>
											<th>Mode</th>
											<th>Format</th>
											<th>Passages</th>
											<th>Words</th>
											<th>Health</th>
											<th>Modified</th>
											<th>
												<span className="screen-reader-only">Actions</span>
											</th>
										</tr>
									</thead>
									<tbody>
										{visibleStories.map(story => (
											<tr
												className="story-list-launcher__project story-list-launcher__row"
												data-id={story.id}
												data-testid="story-list-row"
												key={story.id}
												onDoubleClick={() => openStory(story)}
												onClick={event =>
													selectProject(story, event.metaKey || event.ctrlKey)
												}
											>
												<td>
													<div className="story-list-launcher__project-name">
														<span>{story.name}</span>
														{story.selected && (
															<Badge icon="circle-check" tone="link">
																Selected
															</Badge>
														)}
													</div>
													<div className="story-list-launcher__project-meta">
														{storyFileName(story)} · {story.ifid}
													</div>
													<div className="story-list-launcher__project-actions">
														<Button
															aria-label={`Open ${story.name}`}
															icon="arrow-up-right"
															onClick={event => stopAndOpenStory(story, event)}
															size="sm"
															variant="ghost"
														>
															Open
														</Button>
														<Button
															aria-label={`Delete story ${story.name}`}
															icon="trash"
															onClick={event =>
																stopAndDeleteStory(story, event)
															}
															size="sm"
															variant="danger"
														>
															Delete
														</Button>
													</div>
												</td>
												<td>
													<Badge icon="binary-tree" tone="generated">
														Graph
													</Badge>
												</td>
												<td>
													{story.storyFormat} {story.storyFormatVersion}
												</td>
												<td>{story.passages.length}</td>
												<td>{wordCount(story)}</td>
												<td>
													<HealthBadges story={story} />
												</td>
												<td>{formatDate(story.lastUpdate)}</td>
												<td>
													<div className="story-list-launcher__row-actions">
														<IconButton
															icon="arrow-up-right"
															label={`Open ${story.name}`}
															onClick={event => {
																event.stopPropagation();
																openStory(story);
															}}
															size="sm"
														/>
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						) : (
							<div className="story-list-launcher__cards">
								{visibleStories.map(story => (
									<article
										className="story-list-launcher__project story-list-launcher__card"
										data-id={story.id}
										data-testid="story-list-card"
										key={story.id}
										onDoubleClick={() => openStory(story)}
										onClick={event =>
											selectProject(story, event.metaKey || event.ctrlKey)
										}
									>
										<ProjectMiniMap story={story} />
										<div className="story-list-launcher__card-body">
											<div className="story-list-launcher__project-name">
												<span>{story.name}</span>
												{story.selected && (
													<Badge icon="circle-check" tone="link">
														Selected
													</Badge>
												)}
											</div>
											<div className="story-list-launcher__project-meta">
												{story.passages.length} passages · {wordCount(story)}{' '}
												words
											</div>
											<HealthBadges story={story} />
											<div className="story-list-launcher__card-foot">
												<Badge icon="file-code" tone="neutral">
													{story.storyFormat}
												</Badge>
												<div className="story-list-launcher__card-actions">
													<span>{formatDate(story.lastUpdate)}</span>
													<Button
														aria-label={`Delete story ${story.name}`}
														icon="trash"
														onClick={event => stopAndDeleteStory(story, event)}
														size="sm"
														variant="danger"
													>
														Delete
													</Button>
												</div>
											</div>
										</div>
									</article>
								))}
							</div>
						)}
					</Panel>
				</ClickAwayListener>
			</section>
		</div>
	);
};

export const StoryListRoute: React.FC = () => (
	<DialogsContextProvider>
		<InnerStoryListRoute />
	</DialogsContextProvider>
);
