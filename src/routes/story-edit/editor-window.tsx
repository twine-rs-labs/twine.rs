import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	Badge,
	Button,
	IconButton,
	SourceEditor,
	SourceEditorLanguage,
	TablerIcon
} from '../../components/design-system';
import {VisibleWhitespace} from '../../components/visible-whitespace';
import {TagCardButton} from '../../components/tag/tag-card-button';
import {
	setPassageTagsCommand,
	setStoryTagColorCommand,
	updatePassageTextCommand,
	updateStoryScriptCommand,
	updateStoryStylesheetCommand,
	useCoreProjectHost
} from '../../core';
import type {CoreStoryIndex, WorkbenchSelection} from '../../core';
import {quickFixActionsForDiagnostic} from '../../core/quick-fix-registry';
import {Passage, Story, storyPassageTags} from '../../store/stories';
import {Color, colorString} from '../../util/color';
import type {EditorWindowSpec} from './editor-window-spec';

export interface EditorWindowProps {
	active: boolean;
	index: CoreStoryIndex;
	onClose: () => void;
	onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
	onFocus: () => void;
	onRevealPassageInGraph?: (passage: Passage) => void;
	onSelectPassage?: (passage: Passage) => void;
	onTestPassage?: (passage: Passage) => void;
	selection?: WorkbenchSelection;
	spec: EditorWindowSpec;
	story: Story;
}

function languageForPassage(passage: Passage): SourceEditorLanguage {
	if (
		passage.tags.includes('stylesheet') &&
		!passage.tags.includes('script')
	) {
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

function windowIcon(spec: EditorWindowSpec) {
	return spec.kind === 'script'
		? 'braces'
		: spec.kind === 'stylesheet'
			? 'file-code'
			: 'file-text';
}

interface ResolvedBuffer {
	id: string;
	language: SourceEditorLanguage;
	memoryKey: string;
	name: string;
	passage?: Passage;
	value: string;
}

/**
 * One self-contained, closeable editor buffer (a passage, the story
 * JavaScript, or the story Stylesheet). The titlebar carries ONLY per-buffer
 * controls — name, dirty dot, find, close. Story-level chrome (format,
 * validate, Open editor) lives once on the dock chrome above the grid, never
 * here. See WORKBENCH_INTEGRATION.md.
 */
export const EditorWindow: React.FC<EditorWindowProps> = props => {
	const {
		active,
		index,
		onClose,
		onDragStart,
		onFocus,
		onRevealPassageInGraph,
		onSelectPassage,
		onTestPassage,
		selection,
		spec,
		story
	} = props;
	const {t} = useTranslation();
	const coreProjectHost = useCoreProjectHost();
	const [searchRequestKey, setSearchRequestKey] = React.useState(0);

	const passage =
		spec.kind === 'passage'
			? story.passages.find(candidate => candidate.id === spec.passageId)
			: undefined;

	const buffer = React.useMemo<ResolvedBuffer>(() => {
		if (spec.kind === 'script') {
			return {
				id: `${story.id}:script`,
				language: 'javascript',
				memoryKey: `${story.id}:script`,
				name: t('routes.storyEdit.toolbar.javaScript'),
				value: story.script
			};
		}

		if (spec.kind === 'stylesheet') {
			return {
				id: `${story.id}:stylesheet`,
				language: 'css',
				memoryKey: `${story.id}:stylesheet`,
				name: t('routes.storyEdit.toolbar.stylesheet'),
				value: story.stylesheet
			};
		}

		return {
			id: passage?.id ?? `${story.id}:passage`,
			language: passage ? languageForPassage(passage) : 'twine',
			memoryKey: passage
				? `${story.id}:${passage.id}`
				: `${story.id}:passage`,
			name: passage?.name ?? t('routes.storyEdit.workspace.noPassages'),
			passage,
			value: passage?.text ?? ''
		};
	}, [passage, spec.kind, story.id, story.script, story.stylesheet, t]);

	const [localText, setLocalText] = React.useState(buffer.value);
	const pendingText = React.useRef<string>();
	const pendingTimeout = React.useRef<number>();
	const dirty = localText !== buffer.value;

	const passageNames = selection?.passageNames ?? [];
	const links = selection?.links ?? [];
	const brokenLinks = (selection?.brokenLinks ?? []).map(
		fact => fact.targetName
	);
	const backlinks = selection?.backlinks ?? [];
	const outgoingPassages = (selection?.linkFacts ?? [])
		.map(fact =>
			fact.targetId
				? story.passages.find(candidate => candidate.id === fact.targetId)
				: undefined
		)
		.filter((candidate): candidate is Passage => !!candidate);

	const inlineDiagnostics = React.useMemo(
		() =>
			passage
				? index.diagnostics.filter(
						diagnostic => diagnostic.passageId === passage.id
					)
				: [],
		[index.diagnostics, passage]
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
	const passageTags = React.useMemo(() => storyPassageTags(story), [story]);

	const commitText = React.useCallback(
		(text: string) => {
			if (spec.kind === 'passage') {
				if (passage && text !== passage.text) {
					coreProjectHost.applyStoryCommand(
						updatePassageTextCommand(story.id, passage.id, text)
					);
				}
			} else if (spec.kind === 'script') {
				if (text !== story.script) {
					coreProjectHost.applyStoryCommand(
						updateStoryScriptCommand(story.id, text)
					);
				}
			} else if (text !== story.stylesheet) {
				coreProjectHost.applyStoryCommand(
					updateStoryStylesheetCommand(story.id, text)
				);
			}
		},
		[coreProjectHost, passage, spec.kind, story.id, story.script, story.stylesheet]
	);

	React.useEffect(() => {
		setLocalText(buffer.value);
	}, [buffer.id, buffer.value]);

	// Flush any pending edit when the buffer changes or the window closes.
	React.useEffect(
		() => () => {
			if (pendingTimeout.current) {
				window.clearTimeout(pendingTimeout.current);
				pendingTimeout.current = undefined;
			}

			if (pendingText.current !== undefined) {
				commitText(pendingText.current);
				pendingText.current = undefined;
			}
		},
		[buffer.id, commitText]
	);

	const handleChangeText = React.useCallback(
		(text: string) => {
			if (spec.kind === 'passage' && !passage) {
				return;
			}

			setLocalText(text);
			pendingText.current = text;

			if (pendingTimeout.current) {
				window.clearTimeout(pendingTimeout.current);
			}

			pendingTimeout.current = window.setTimeout(() => {
				pendingTimeout.current = undefined;
				pendingText.current = undefined;
				commitText(text);
			}, 300);
		},
		[commitText, passage, spec.kind]
	);

	function handleAddTag(name: string) {
		if (!passage) {
			return;
		}

		coreProjectHost.applyStoryCommand({
			type: 'batch',
			commands: [
				...(passageTags.includes(name)
					? []
					: [setStoryTagColorCommand(story.id, name, colorString(name))]),
				setPassageTagsCommand(story.id, passage.id, [...passage.tags, name])
			]
		});
	}

	function handleChangeTagColor(name: string, color: Color) {
		coreProjectHost.applyStoryCommand(
			setStoryTagColorCommand(story.id, name, color === 'none' ? null : color)
		);
	}

	function handleRemoveTag(name: string) {
		if (!passage) {
			return;
		}

		coreProjectHost.applyStoryCommand(
			setPassageTagsCommand(
				story.id,
				passage.id,
				passage.tags.filter(tag => tag !== name)
			)
		);
	}

	const missingPassage = spec.kind === 'passage' && !passage;

	return (
		<section
			aria-label={buffer.name}
			className={classNames('story-edit-editor-window', {
				'is-active': active
			})}
			onPointerDownCapture={onFocus}
		>
			<header
				className="story-edit-editor-window-bar"
				draggable={!!onDragStart}
				onDragStart={onDragStart}
			>
				<TablerIcon
					className="story-edit-editor-window-grip"
					icon="grip-vertical"
				/>
				<TablerIcon
					className="story-edit-editor-window-icon"
					icon={windowIcon(spec)}
				/>
				<span className="story-edit-editor-window-name">
					<VisibleWhitespace value={buffer.name} />
				</span>
				{dirty && (
					<span
						aria-label={t('common.unsavedChanges')}
						className="story-edit-editor-window-dirty"
						title={t('common.unsavedChanges')}
					/>
				)}
				<span className="story-edit-editor-window-bar-sp" />
				<IconButton
					icon="search"
					label={t('routes.storyEdit.workspace.findInEditor')}
					onClick={() => setSearchRequestKey(key => key + 1)}
					size="sm"
				/>
				<IconButton
					icon="x"
					label={`${t('common.close')} ${buffer.name}`}
					onClick={onClose}
					size="sm"
				/>
			</header>

			{spec.kind === 'passage' && passage && (
				<div className="story-edit-editor-window-sub">
					<TagCardButton
						allTags={passageTags}
						id={`story-editor-window-tag-input-${passage.id}`}
						onAdd={handleAddTag}
						onChangeColor={handleChangeTagColor}
						onRemove={handleRemoveTag}
						tagColors={story.tagColors}
						tags={passage.tags}
					/>
					<span className="story-edit-editor-window-sub-sp" />
					{brokenLinks.length > 0 && (
						<Badge icon="unlink" tone="error">
							{brokenLinks.length}
						</Badge>
					)}
					<Badge icon="arrow-up-right" tone="link">
						{links.length}
					</Badge>
					<Badge icon="arrow-back-up" tone="neutral">
						{backlinks.length}
					</Badge>
					{onTestPassage && (
						<IconButton
							icon="tool"
							label={t('routes.storyEdit.toolbar.testFromHere')}
							onClick={() => onTestPassage(passage)}
							size="sm"
						/>
					)}
					{onRevealPassageInGraph && (
						<IconButton
							icon="focus-2"
							label={t('routes.storyEdit.workspace.revealInGraph')}
							onClick={() => onRevealPassageInGraph(passage)}
							size="sm"
						/>
					)}
				</div>
			)}

			{missingPassage ? (
				<p className="story-edit-editor-window-empty">
					{t('routes.storyEdit.workspace.noPassages')}
				</p>
			) : (
				<div className="story-edit-editor-window-code">
					<SourceEditor
						autocompletePassageNames={passageNames}
						brokenLinkNames={spec.kind === 'passage' ? brokenLinks : undefined}
						id={`story-editor-window-${buffer.id}`}
						key={buffer.id}
						label={t('dialogs.passageEdit.passageTextEditorLabel')}
						language={buffer.language}
						memoryKey={buffer.memoryKey}
						onChange={handleChangeText}
						placeholderText={t('dialogs.passageEdit.passageTextPlaceholder')}
						searchRequestKey={searchRequestKey}
						selfLinkName={spec.kind === 'passage' ? passage?.name : undefined}
						value={localText}
					/>
				</div>
			)}

			{spec.kind === 'passage' && brokenLinks.length > 0 && (
				<div className="story-edit-editor-window-diag">
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
