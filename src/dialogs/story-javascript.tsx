import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IndentButtons, UndoRedoButtons} from '../components/codemirror';
import {ButtonBar} from '../components/container/button-bar';
import {DialogCard, DialogEditor} from '../components/container/dialog-card';
import {
	SourceEditor,
	type SourceEditorHandle
} from '../components/control/source-editor';
import {updateStoryScriptCommand, useCoreProjectHost} from '../core';
import {storyWithId, useStoriesContext} from '../store/stories';
import {DialogComponentProps} from './dialogs.types';
import './story-javascript.css';

export interface StoryJavaScriptDialogProps extends DialogComponentProps {
	storyId: string;
}

export const StoryJavaScriptDialog: React.FC<
	StoryJavaScriptDialogProps
> = props => {
	const {storyId, ...other} = props;
	const [editor, setEditor] = React.useState<SourceEditorHandle>();
	const {stories} = useStoriesContext();
	const coreProjectHost = useCoreProjectHost();
	const story = storyWithId(stories, storyId);
	const {t} = useTranslation();
	const handleEditorRef = React.useCallback(
		(instance: SourceEditorHandle | null) =>
			setEditor(current =>
				current === (instance ?? undefined) ? current : (instance ?? undefined)
			),
		[]
	);

	const handleChangeText = (text: string) => {
		coreProjectHost.applyStoryCommand(updateStoryScriptCommand(story.id, text));
	};

	return (
		<DialogCard
			{...other}
			className="story-javascript-dialog"
			headerLabel={t('dialogs.storyJavaScript.title')}
			maximizable
		>
			<ButtonBar>
				<UndoRedoButtons editor={editor} watch={story.script} />
				<IndentButtons editor={editor} />
			</ButtonBar>
			<DialogEditor>
				<SourceEditor
					id="story-javascript-dialog-code-area"
					label={t('dialogs.storyJavaScript.editorLabel')}
					language="javascript"
					onChange={handleChangeText}
					placeholderText={t('dialogs.storyJavaScript.explanation')}
					ref={handleEditorRef}
					value={story.script}
				/>
			</DialogEditor>
		</DialogCard>
	);
};
