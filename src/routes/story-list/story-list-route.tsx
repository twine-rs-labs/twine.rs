import orderBy from 'lodash/orderBy';
import * as React from 'react';
import {useNavigate} from 'react-router';
import {ClickAwayListener} from '../../components/click-away-listener';
import {SafariWarningCard} from '../../components/error';
import {StorageQuota} from '../../components/storage-quota/storage-quota';
import {TagCardButton} from '../../components/tag/tag-card-button';
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
	registerStoryDocuments,
	setStoryTagsCommand,
	useCoreProjectHost
} from '../../core';
import type {CoreStorySummary} from '../../core';
import {
	AppDonationDialog,
	DialogsContextProvider,
	StoryTagsDialog,
	useDialogsContext
} from '../../dialogs';
import {storyFileName} from '../../electron/shared';
import {setPref, usePrefsContext} from '../../store/prefs';
import {useDonationCheck} from '../../store/prefs/use-donation-check';
import {
	deselectAllStories,
	deselectStory,
	duplicateStory,
	selectStory,
	Story,
	useStoriesContext
} from '../../store/stories';
import {usePublishing} from '../../store/use-publishing';
import {
	deleteProjectMetadata,
	loadProjectMetadata,
	saveProjectMetadata
} from '../../store/project-metadata';
import {markProjectStoryHydration} from '../../store/project-hydration';
import type {TwineElectronWindow} from '../../electron/shared';
import {archiveFilename} from '../../util/publish';
import {saveHtml} from '../../util/save-file';
import {Color, colorString} from '../../util/color';
import './story-list-route.css';

type LauncherView = 'table' | 'cards';

function formatDate(date: Date) {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(date);
}

function allTags(stories: Story[]) {
	return Array.from(new Set(stories.flatMap(story => story.tags))).sort();
}

function storyHealth(summary: CoreStorySummary) {
	return {brokenLinks: summary.graph.brokenLinks, errors: summary.errorCount};
}

type StoryHealthLoadState =
	| {kind: 'loading'}
	| {kind: 'loaded'; summary: CoreStorySummary}
	| {kind: 'error'; message: string};

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

	return (
		<svg
			aria-hidden
			className="story-list-launcher__map"
			focusable="false"
			viewBox="0 0 180 96"
		>
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
	const [loadState, setLoadState] = React.useState<StoryHealthLoadState>({
		kind: 'loading'
	});
	const health =
		loadState.kind === 'loaded' ? storyHealth(loadState.summary) : undefined;

	React.useEffect(() => {
		let active = true;

		setLoadState({kind: 'loading'});
		// Route transitions keep the library mounted briefly. Do not enqueue an
		// expensive large-story health scan that will be obsolete by the time the
		// workbench opens; worker requests cannot be canceled after submission.
		const timeout = window.setTimeout(() => {
			void coreProjectHost
				.queryStorySummaryAsync(story.id)
				.then(summary => {
					if (active) {
						setLoadState({kind: 'loaded', summary});
					}
				})
				.catch(error => {
					if (active) {
						setLoadState({
							kind: 'error',
							message: error instanceof Error ? error.message : String(error)
						});
					}
				});
		}, 2000);

		return () => {
			active = false;
			window.clearTimeout(timeout);
		};
	}, [coreProjectHost, story.id, story.lastUpdate]);

	if (loadState.kind === 'error') {
		return (
			<div className="story-list-launcher__health">
				<Badge icon="alert-circle" tone="neutral" title={loadState.message}>
					Health unavailable
				</Badge>
			</div>
		);
	}

	return (
		<div className="story-list-launcher__health">
			<Badge
				icon={
					!health
						? 'loader-2'
						: health.errors > 0
							? 'alert-octagon'
							: 'circle-check'
				}
				tone={!health ? 'neutral' : health.errors > 0 ? 'error' : 'success'}
			>
				{health ? `${health.errors} errors` : 'Checking errors'}
			</Badge>
			<Badge
				icon={!health ? 'loader-2' : health.brokenLinks > 0 ? 'unlink' : 'link'}
				tone={!health || health.brokenLinks === 0 ? 'neutral' : 'warn'}
			>
				{health ? `${health.brokenLinks} broken` : 'Checking links'}
			</Badge>
		</div>
	);
}

function StoryWordCount({story}: {story: Story}) {
	const coreProjectHost = useCoreProjectHost();
	const [count, setCount] = React.useState(0);

	React.useEffect(() => {
		let active = true;

		void coreProjectHost
			.queryStoryWordCountAsync(story.id)
			.then(wordCount => active && setCount(wordCount))
			.catch(error => {
				if (active) {
					console.error('Could not query the story word count.', error);
				}
			});
		return () => {
			active = false;
		};
	}, [coreProjectHost, story.id, story.lastUpdate]);

	return <>{count}</>;
}

export const InnerStoryListRoute: React.FC = () => {
	const navigate = useNavigate();
	const {dispatch: dialogsDispatch} = useDialogsContext();
	const {dispatch: prefsDispatch, prefs} = usePrefsContext();
	const {dispatch: storiesDispatch, stories} = useStoriesContext();
	const coreProjectHost = useCoreProjectHost();
	const {materializeStory, publishArchive} = usePublishing();
	const {shouldShowDonationPrompt} = useDonationCheck();
	const [query, setQuery] = React.useState('');
	const [view, setView] = React.useState<LauncherView>('table');
	const [archiveRunning, setArchiveRunning] = React.useState(false);
	const [archiveError, setArchiveError] = React.useState<string>();
	const [duplicatingKey, setDuplicatingKey] = React.useState<string>();
	const [duplicateError, setDuplicateError] = React.useState<string>();
	const selectedStories = React.useMemo(
		() => stories.filter(story => story.selected),
		[stories]
	);
	const tags = React.useMemo(() => allTags(stories), [stories]);
	const nativeDesktop = !!desktopBridge();

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
		navigate(`/stories/${story.id}`);
	}

	async function duplicateProject(story: Story) {
		const rootPath = fileBackedProjectRoot(story);
		const twineElectron = desktopBridge();
		const key = rootPath ?? `story:${story.id}`;

		if (duplicatingKey) {
			return;
		}

		setDuplicateError(undefined);
		setDuplicatingKey(key);
		try {
			if (!rootPath) {
				const completeStory = await materializeStory(story.id);
				const duplicate = duplicateStory(completeStory, stories);

				storiesDispatch({
					...duplicate,
					props: registerStoryDocuments(duplicate.props)
				});
				return;
			}
			if (!twineElectron?.duplicateProjectFolder) {
				throw new Error(
					'The desktop project-folder duplication bridge is unavailable.'
				);
			}

			const projectStories = stories.filter(
				candidate => fileBackedProjectRoot(candidate) === rootPath
			);
			const completeStories = await Promise.all(
				projectStories.map(projectStory => materializeStory(projectStory.id))
			);
			const reservedNames = [...stories];
			const replacements = completeStories.map(sourceStory => {
				const duplicate = duplicateStory(sourceStory, reservedNames).props;

				reservedNames.push(duplicate);
				return {
					passageIds: sourceStory.passages.map((sourcePassage, index) => ({
						duplicatePassageId: duplicate.passages[index].id,
						sourcePassageId: sourcePassage.id
					})),
					sourceStoryId: sourceStory.id,
					story: duplicate
				};
			});
			const result = await twineElectron.duplicateProjectFolder(
				rootPath,
				replacements
			);

			try {
				for (const duplicatedStory of result.stories) {
					saveProjectMetadata(duplicatedStory.id, {
						rootPath: result.rootPath,
						status: 'file-backed',
						storageKind: 'electron-project-folder'
					});
				}
			} catch (error) {
				for (const duplicatedStory of result.stories) {
					deleteProjectMetadata(duplicatedStory.id);
				}
				try {
					await twineElectron.deleteProjectFolder(result.rootPath);
				} catch (cleanupError) {
					throw new Error(
						`${(error as Error).message}. The copied folder remains at ${
							result.rootPath
						}: ${(cleanupError as Error).message}`
					);
				}
				throw error;
			}

			const hydratedStories = result.stories.map(duplicatedStory => {
				markProjectStoryHydration(duplicatedStory.id, {
					passageTextLoaded: result.passageTextLoaded !== false,
					rootPath: result.rootPath
				});
				return registerStoryDocuments(duplicatedStory);
			});

			storiesDispatch({
				actions: hydratedStories.map(story => ({
					props: story,
					type: 'createStory' as const
				})),
				persistence: 'skip',
				storyIds: hydratedStories.map(story => story.id),
				type: 'applyCorePatchBatch'
			});
		} catch (error) {
			setDuplicateError(
				`Could not duplicate ${
					rootPath ? 'project' : 'story'
				}: ${(error as Error).message}`
			);
		} finally {
			setDuplicatingKey(undefined);
		}
	}

	function duplicateAction(story: Story) {
		const rootPath = fileBackedProjectRoot(story);
		const fileBacked = !!rootPath;
		const running = duplicatingKey === (rootPath ?? `story:${story.id}`);

		return {
			disabled: duplicatingKey !== undefined,
			label: `${running ? 'Duplicating' : 'Duplicate'} ${
				fileBacked ? 'project' : 'story'
			} ${story.name}`,
			text: running
				? 'Duplicating…'
				: fileBacked
					? 'Duplicate Project'
					: 'Duplicate Story'
		};
	}

	function addStoryTag(story: Story, name: string) {
		if (!tags.includes(name)) {
			prefsDispatch(
				setPref('storyTagColors', {
					...prefs.storyTagColors,
					[name]: colorString(name)
				})
			);
		}

		void coreProjectHost.applyStoryCommand(
			setStoryTagsCommand(story.id, [...story.tags, name])
		);
	}

	function removeStoryTag(story: Story, name: string) {
		void coreProjectHost.applyStoryCommand(
			setStoryTagsCommand(
				story.id,
				story.tags.filter(tag => tag !== name)
			)
		);
	}

	function changeStoryTagColor(name: string, color: Color) {
		prefsDispatch(
			setPref('storyTagColors', {...prefs.storyTagColors, [name]: color})
		);
	}

	async function exportLibraryArchive() {
		if (archiveRunning || stories.length === 0) {
			return;
		}

		setArchiveError(undefined);
		setArchiveRunning(true);
		try {
			saveHtml(await publishArchive(), archiveFilename());
		} catch (error) {
			setArchiveError(
				`Could not export library archive: ${(error as Error).message}`
			);
		} finally {
			setArchiveRunning(false);
		}
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
						'This will delete:',
						`- Project folder: ${rootPath} (moved to the operating system trash)`,
						`- Library ${
							projectStories.length === 1 ? 'story' : 'stories'
						}: ${projectStories.map(story => `"${story.name}"`).join(', ')}`,
						'',
						'Legacy HTML story files, including same-named copies, will not be deleted.'
					].join('\n')
				)
			: window.confirm(
					[
						`Delete story "${story.name}"?`,
						'',
						'This will delete:',
						`- Library story: "${story.name}"`,
						...(twineElectron?.deleteStory
							? [
									`- Legacy HTML file: ${storyFileName(
										story
									)} (moved to the operating system trash)`
								]
							: [])
					].join('\n')
				);

		if (!confirmed) {
			return;
		}

		if (canDeleteProjectFolder) {
			await twineElectron.deleteProjectFolder(rootPath);

			for (const projectStory of projectStories) {
				storiesDispatch({
					storageKind: 'electron-project-folder',
					storyId: projectStory.id,
					type: 'deleteStory'
				});
				deleteProjectMetadata(projectStory.id);
			}
		} else {
			await coreProjectHost.applyStoryCommand(deleteStoryCommand(story.id));
			deleteProjectMetadata(story.id);
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

	function stopAndDuplicateStory(
		story: Story,
		event: React.MouseEvent<HTMLButtonElement>
	) {
		event.stopPropagation();
		void duplicateProject(story);
	}

	function storyTagEditor(story: Story) {
		return (
			<span onClick={event => event.stopPropagation()}>
				<TagCardButton
					allTags={tags}
					id={`story-tag-input-${story.id}`}
					onAdd={name => addStoryTag(story, name)}
					onChangeColor={changeStoryTagColor}
					onRemove={name => removeStoryTag(story, name)}
					tagColors={prefs.storyTagColors}
					tags={story.tags}
				/>
			</span>
		);
	}

	return (
		<div className="story-list-launcher">
			<aside className="story-list-launcher__rail" aria-label="Project actions">
				<Button
					block
					icon="plus"
					onClick={() => navigate('/new-project')}
					variant="primary"
				>
					New Project
				</Button>
				<Button
					block
					icon="file-import"
					onClick={() => navigate('/new-project/import')}
				>
					Import
				</Button>
				<Button
					block
					disabled={archiveRunning || stories.length === 0}
					icon="archive"
					onClick={() => void exportLibraryArchive()}
				>
					{archiveRunning ? 'Exporting…' : 'Export Library Archive'}
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
							dialogsDispatch({
								type: 'addDialog',
								component: StoryTagsDialog
							})
						}
						type="button"
					>
						<TablerIcon icon="tags" />
						<span>Story Tags</span>
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
				{!nativeDesktop && (
					<div className="story-list-launcher__storage">
						<strong>Storage &amp; Backups</strong>
						<p>
							Your projects are saved in this browser. Export a library archive
							before clearing browser data or switching browsers.
						</p>
						<StorageQuota watch={stories} />
						<Button
							block
							disabled={archiveRunning || stories.length === 0}
							icon="download"
							onClick={() => void exportLibraryArchive()}
							size="sm"
						>
							Export Backup
						</Button>
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
				{archiveError && (
					<p className="story-list-launcher__error" role="alert">
						{archiveError}
					</p>
				)}
				{duplicateError && (
					<p className="story-list-launcher__error" role="alert">
						{duplicateError}
					</p>
				)}
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
										onClick={() => navigate('/new-project')}
										variant="primary"
									>
										New Project
									</Button>
									<Button
										icon="file-import"
										onClick={() => navigate('/new-project/import')}
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
															aria-label={duplicateAction(story).label}
															disabled={duplicateAction(story).disabled}
															icon="copy"
															onClick={event =>
																stopAndDuplicateStory(story, event)
															}
															size="sm"
															variant="ghost"
														>
															{duplicateAction(story).text}
														</Button>
														{storyTagEditor(story)}
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
												<td>
													<StoryWordCount story={story} />
												</td>
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
												{story.passages.length} passages ·{' '}
												<StoryWordCount story={story} /> words
											</div>
											<HealthBadges story={story} />
											<div className="story-list-launcher__card-foot">
												<Badge icon="file-code" tone="neutral">
													{story.storyFormat}
												</Badge>
												<div className="story-list-launcher__card-actions">
													<span>{formatDate(story.lastUpdate)}</span>
													<Button
														aria-label={duplicateAction(story).label}
														disabled={duplicateAction(story).disabled}
														icon="copy"
														onClick={event =>
															stopAndDuplicateStory(story, event)
														}
														size="sm"
														variant="ghost"
													>
														{duplicateAction(story).text}
													</Button>
													{storyTagEditor(story)}
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
