import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	Badge,
	Button,
	SourceEditor,
	SourceEditorLanguage,
	TablerIcon
} from '../../components/design-system';
import {
	updatePassageTextCommand,
	updateStoryScriptCommand,
	updateStoryStylesheetCommand,
	useCoreProjectHost,
	workbenchSelection
} from '../../core';
import type {CoreStoryIndex, WorkbenchSelection} from '../../core';
import {quickFixActionsForDiagnostic} from '../../core/quick-fix-registry';
import {Passage, Story} from '../../store/stories';
import {VisibleWhitespace} from '../../components/visible-whitespace';

export interface StoryTextPanelProps {
	index?: CoreStoryIndex;
	onRevealPassageInGraph?: (passage: Passage) => void;
	onSelectPassage?: (passage: Passage) => void;
	onTestPassage?: (passage: Passage) => void;
	selectedPassageId?: string;
	selection?: WorkbenchSelection;
	story: Story;
}

type StorySourceTab = 'passage' | 'script' | 'stylesheet';

function languageForPassage(passage: Passage): SourceEditorLanguage {
	if (passage.tags.includes('stylesheet') && !passage.tags.includes('script')) {
		return 'css';
	}

	if (passage.tags.includes('script') && !passage.tags.includes('stylesheet')) {
		return 'javascript';
	}

	if (passage.tags.includes('html')) {
		return 'html';
	}

	return 'twine';
}

function sourceIcon(source: StorySourceTab) {
	switch (source) {
		case 'passage':
			return 'file-text';
		case 'script':
			return 'braces';
		case 'stylesheet':
			return 'file-code';
	}
}

export const StoryTextPanel: React.FC<StoryTextPanelProps> = props => {
	const {
		index,
		onRevealPassageInGraph,
		onSelectPassage,
		onTestPassage,
		selectedPassageId,
		story
	} = props;
	const coreProjectHost = useCoreProjectHost();
	const storyIndex = React.useMemo(
		() => index ?? coreProjectHost.queryStoryIndex(story.id),
		[coreProjectHost, index, story.id]
	);
	const selection = React.useMemo(
		() =>
			props.selection ??
			workbenchSelection(story, storyIndex, selectedPassageId),
		[props.selection, selectedPassageId, story, storyIndex]
	);
	const selectedPassage = selection.passage;
	const {t} = useTranslation();
	const [activeSource, setActiveSource] =
		React.useState<StorySourceTab>('passage');
	const source = React.useMemo(() => {
		if (activeSource === 'script') {
			return {
				id: `${story.id}:script`,
				label: t('routes.storyEdit.toolbar.javaScript'),
				language: 'javascript' as SourceEditorLanguage,
				memoryKey: `${story.id}:script`,
				name: t('routes.storyEdit.toolbar.javaScript'),
				value: story.script
			};
		}

		if (activeSource === 'stylesheet') {
			return {
				id: `${story.id}:stylesheet`,
				label: t('routes.storyEdit.toolbar.stylesheet'),
				language: 'css' as SourceEditorLanguage,
				memoryKey: `${story.id}:stylesheet`,
				name: t('routes.storyEdit.toolbar.stylesheet'),
				value: story.stylesheet
			};
		}

		return {
			id: selectedPassage?.id ?? `${story.id}:passage`,
			label: t('common.passage'),
			language: selectedPassage
				? languageForPassage(selectedPassage)
				: ('twine' as SourceEditorLanguage),
			memoryKey: selectedPassage
				? `${story.id}:${selectedPassage.id}`
				: `${story.id}:passage`,
			name: selectedPassage?.name ?? t('routes.storyEdit.workspace.noPassages'),
			value: selectedPassage?.text ?? ''
		};
	}, [
		activeSource,
		selectedPassage,
		story.id,
		story.script,
		story.stylesheet,
		t
	]);
	const [localText, setLocalText] = React.useState(source.value);
	const pendingText = React.useRef<string>();
	const pendingTimeout = React.useRef<number>();
	const passageNames = selection.passageNames;
	const links = selection.links;
	const brokenLinks = selection.brokenLinks.map(fact => fact.targetName);
	const outgoingPassages = selection.linkFacts
		.map(fact =>
			fact.targetId
				? story.passages.find(passage => passage.id === fact.targetId)
				: undefined
		)
		.filter((passage): passage is Passage => !!passage);
	const backlinks = selection.backlinks;
	const inlineDiagnostics = React.useMemo(
		() =>
			activeSource === 'passage' && selectedPassage
				? storyIndex.diagnostics.filter(
						diagnostic => diagnostic.passageId === selectedPassage.id
					)
				: [],
		[activeSource, selectedPassage, storyIndex.diagnostics]
	);
	const inlineQuickFixes = React.useMemo(
		() =>
			inlineDiagnostics
				.flatMap(diagnostic =>
					quickFixActionsForDiagnostic(coreProjectHost, story, diagnostic)
				)
				.filter(action => action.enabled)
				.slice(0, 3),
		[coreProjectHost, inlineDiagnostics, story]
	);

	React.useEffect(() => {
		setLocalText(source.value);
	}, [source.id, source.value]);

	const commitText = React.useCallback(
		(text: string, sourceTab: StorySourceTab, passage: Passage | undefined) => {
			if (sourceTab === 'passage' && passage) {
				if (text !== passage.text) {
					coreProjectHost.applyStoryCommand(
						updatePassageTextCommand(story.id, passage.id, text)
					);
				}
			} else if (sourceTab === 'script' && text !== story.script) {
				coreProjectHost.applyStoryCommand(
					updateStoryScriptCommand(story.id, text)
				);
			} else if (sourceTab === 'stylesheet' && text !== story.stylesheet) {
				coreProjectHost.applyStoryCommand(
					updateStoryStylesheetCommand(story.id, text)
				);
			}
		},
		[coreProjectHost, story.id, story.script, story.stylesheet]
	);

	React.useEffect(() => {
		const sourceTab = activeSource;
		const passage = selectedPassage;

		return () => {
			if (pendingTimeout.current) {
				window.clearTimeout(pendingTimeout.current);
				pendingTimeout.current = undefined;
			}

			if (pendingText.current !== undefined) {
				commitText(pendingText.current, sourceTab, passage);
				pendingText.current = undefined;
			}
		};
	}, [activeSource, commitText, selectedPassage, source.id]);

	const handleChangeText = React.useCallback(
		(text: string) => {
			if (activeSource === 'passage' && !selectedPassage) {
				return;
			}

			setLocalText(text);
			pendingText.current = text;

			if (pendingTimeout.current) {
				window.clearTimeout(pendingTimeout.current);
			}

			const nextText = text;

			pendingTimeout.current = window.setTimeout(() => {
				pendingTimeout.current = undefined;
				pendingText.current = undefined;
				commitText(nextText, activeSource, selectedPassage);
			}, 300);
		},
		[activeSource, commitText, selectedPassage]
	);

	if (!selectedPassage && activeSource === 'passage') {
		return (
			<section
				aria-label={t('routes.storyEdit.workspace.textMode')}
				className="story-edit-text-panel empty"
			>
				<SourceTabs
					activeSource={activeSource}
					onChange={setActiveSource}
					passageName={source.name}
				/>
				<p>{t('routes.storyEdit.workspace.noPassages')}</p>
			</section>
		);
	}

	return (
		<section
			aria-label={t('routes.storyEdit.workspace.textMode')}
			className="story-edit-text-panel"
		>
			<SourceTabs
				activeSource={activeSource}
				onChange={setActiveSource}
				passageName={selectedPassage?.name}
			/>
			<header className="story-edit-text-panel-header">
				<TablerIcon icon="folder" />
				<span className="story-edit-crumb-root">
					{activeSource === 'passage'
						? t('routes.storyEdit.workspace.passages')
						: t('common.story')}
				</span>
				<TablerIcon className="story-edit-crumb-sep" icon="chevron-right" />
				<h2>
					<VisibleWhitespace value={source.name ?? ''} />
				</h2>
				<div className="story-edit-text-panel-meta">
					<Badge mono tone="neutral">
						{story.storyFormat} {story.storyFormatVersion}
					</Badge>
					{activeSource === 'passage' ? (
						<>
							{selectedPassage && onTestPassage && (
								<Button
									icon="tool"
									onClick={() => onTestPassage(selectedPassage)}
									size="sm"
									variant="primary"
								>
									{t('routes.storyEdit.toolbar.testFromHere')}
								</Button>
							)}
							{selectedPassage && onRevealPassageInGraph && (
								<Button
									icon="focus-2"
									onClick={() => onRevealPassageInGraph(selectedPassage)}
									size="sm"
									variant="ghost"
								>
									{t('routes.storyEdit.workspace.revealInGraph')}
								</Button>
							)}
							{brokenLinks.length > 0 && (
								<Badge icon="unlink" tone="error">
									{brokenLinks.length}
								</Badge>
							)}
							<Badge icon="arrow-up-right" tone="link">
								{links.length}
							</Badge>
							<Badge icon="arrow-back-up" tone="neutral">
								{backlinks.length} backlinks
							</Badge>
							<Badge mono tone="neutral">
								{selection.wordCount} words
							</Badge>
						</>
					) : (
						<Badge mono tone="neutral">
							{source.value.split(/\r?\n/).length} lines
						</Badge>
					)}
				</div>
			</header>
			<div className="story-edit-text-editor">
				<SourceEditor
					autocompletePassageNames={passageNames}
					brokenLinkNames={activeSource === 'passage' ? brokenLinks : undefined}
					id={`story-text-source-editor-${source.id}`}
					key={source.id}
					label={t('dialogs.passageEdit.passageTextEditorLabel')}
					language={source.language}
					memoryKey={source.memoryKey}
					onChange={handleChangeText}
					placeholderText={t('dialogs.passageEdit.passageTextPlaceholder')}
					selfLinkName={
						activeSource === 'passage' ? selectedPassage?.name : undefined
					}
					value={localText}
				/>
			</div>
			{activeSource === 'passage' && brokenLinks.length > 0 && (
				<div className="story-edit-inline-diagnostic">
					<TablerIcon icon="alert-octagon" />
					<strong>{t('routes.storyEdit.workspace.brokenLinks')}</strong>
					<span>{brokenLinks.join(', ')}</span>
					{inlineQuickFixes.map(action => (
						<Button
							icon="wand"
							key={action.command}
							onClick={action.apply}
							size="sm"
							variant="ghost"
						>
							{action.title}
						</Button>
					))}
					{outgoingPassages.length > 0 && onSelectPassage && (
						<Button
							icon="arrow-up-right"
							onClick={() => onSelectPassage(outgoingPassages[0])}
							size="sm"
							variant="primary"
						>
							{t('routes.storyEdit.workspace.links')}
						</Button>
					)}
				</div>
			)}
		</section>
	);
};

const SourceTabs: React.FC<{
	activeSource: StorySourceTab;
	onChange: (source: StorySourceTab) => void;
	passageName?: string;
}> = ({activeSource, onChange, passageName}) => {
	const {t} = useTranslation();
	const tabs: {label: string; value: StorySourceTab}[] = [
		{label: passageName ?? t('common.passage'), value: 'passage'},
		{label: t('routes.storyEdit.toolbar.javaScript'), value: 'script'},
		{label: t('routes.storyEdit.toolbar.stylesheet'), value: 'stylesheet'}
	];

	return (
		<div className="story-edit-source-tabs" role="tablist">
			{tabs.map(tab => (
				<button
					aria-selected={activeSource === tab.value}
					key={tab.value}
					onClick={() => onChange(tab.value)}
					role="tab"
					type="button"
				>
					<TablerIcon icon={sourceIcon(tab.value)} />
					{tab.label}
				</button>
			))}
		</div>
	);
};
