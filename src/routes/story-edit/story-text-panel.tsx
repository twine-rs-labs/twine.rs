import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	SourceEditor,
	SourceEditorLanguage
} from '../../components/control/source-editor';
import {Badge, TablerIcon} from '../../components/design-system';
import {
	updatePassageTextCommand,
	updateStoryScriptCommand,
	updateStoryStylesheetCommand,
	useCoreProjectHost
} from '../../core';
import {Passage, Story} from '../../store/stories';
import {parseLinks} from '../../util/parse-links';
import {VisibleWhitespace} from '../../components/visible-whitespace';

export interface StoryTextPanelProps {
	onSelectPassage?: (passage: Passage) => void;
	selectedPassageId?: string;
	story: Story;
}

type StorySourceTab = 'passage' | 'script' | 'stylesheet';

function countWords(text: string) {
	const trimmed = text.trim();

	if (trimmed === '') {
		return 0;
	}

	return trimmed.split(/\s+/).length;
}

function passageWithFallback(
	story: Story,
	passageId?: string
): Passage | undefined {
	return (
		story.passages.find(passage => passage.id === passageId) ??
		story.passages.find(passage => passage.id === story.startPassage) ??
		story.passages[0]
	);
}

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

function linkedPassages(story: Story, names: string[]) {
	return names
		.map(name => story.passages.find(passage => passage.name === name))
		.filter((passage): passage is Passage => !!passage);
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
	const {onSelectPassage, selectedPassageId, story} = props;
	const selectedPassage = passageWithFallback(story, selectedPassageId);
	const coreProjectHost = useCoreProjectHost();
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
	const links = React.useMemo(
		() => (selectedPassage ? parseLinks(selectedPassage.text, true) : []),
		[selectedPassage]
	);
	const passageNames = React.useMemo(
		() => story.passages.map(passage => passage.name),
		[story.passages]
	);
	const brokenLinks = React.useMemo(() => {
		const nameSet = new Set(passageNames);

		return links.filter(link => !nameSet.has(link));
	}, [links, passageNames]);
	const outgoingPassages = React.useMemo(
		() => linkedPassages(story, links),
		[links, story]
	);
	const backlinks = React.useMemo(() => {
		if (!selectedPassage) {
			return [];
		}

		return story.passages.filter(
			passage =>
				passage.id !== selectedPassage.id &&
				parseLinks(passage.text, true).includes(selectedPassage.name)
		);
	}, [selectedPassage, story.passages]);

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
								{countWords(selectedPassage?.text ?? '')} words
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
					{outgoingPassages.length > 0 && onSelectPassage && (
						<button
							onClick={() => onSelectPassage(outgoingPassages[0])}
							type="button"
						>
							{t('routes.storyEdit.workspace.links')}
						</button>
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
