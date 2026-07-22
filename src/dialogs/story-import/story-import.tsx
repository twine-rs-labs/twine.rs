import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {CardContent} from '../../components/container/card';
import {
	DialogCard,
	DialogCardProps
} from '../../components/container/dialog-card';
import {
	registerStoryDocuments,
	replaceStoryCommand,
	useCoreProjectHost
} from '../../core';
import {storyFileName} from '../../electron/shared';
import {
	importStories,
	StoryWithDocuments,
	useStoriesContext
} from '../../store/stories';
import {useStoriesRepair} from '../../store/use-stories-repair';
import {FileChooser} from './file-chooser';
import {StoryChooser} from './story-chooser';
import './story-import.css';

export type StoryImportDialogProps = Omit<DialogCardProps, 'headerLabel'>;

export const StoryImportDialog: React.FC<StoryImportDialogProps> = props => {
	const {onClose} = props;
	const {t} = useTranslation();
	const repairStories = useStoriesRepair();
	const {dispatch, stories: existingStories} = useStoriesContext();
	const coreProjectHost = useCoreProjectHost();
	const [file, setFile] = React.useState<File>();
	const [importError, setImportError] = React.useState<string>();
	const [stories, setStories] = React.useState<StoryWithDocuments[]>([]);

	async function handleImport(stories: StoryWithDocuments[]) {
		const newDocumentStories: StoryWithDocuments[] = [];

		setImportError(undefined);

		try {
			for (const story of stories) {
				const existingStory = existingStories.find(
					existing => storyFileName(existing) === storyFileName(story)
				);

				if (!existingStory) {
					newDocumentStories.push(story);
					continue;
				}

				const documentStory = {
					...story,
					id: existingStory.id,
					passages: story.passages.map(passage => ({
						...passage,
						story: existingStory.id
					}))
				};

				await coreProjectHost.applyStoryCommand(
					replaceStoryCommand(existingStory.id, documentStory)
				);
			}

			if (newDocumentStories.length > 0) {
				dispatch(
					importStories(
						newDocumentStories.map(registerStoryDocuments),
						existingStories
					)
				);
			}
			repairStories();
			onClose();
		} catch (error) {
			setImportError((error as Error).message);
		}
	}

	function handleFileChange(file: File, stories: StoryWithDocuments[]) {
		// If there are no conflicts in the stories, import them now. Otherwise, set
		// them in state and let the user choose via <StoryChooser>.

		setImportError(undefined);

		if (
			stories.length === 0 ||
			stories.some(story =>
				existingStories.some(
					existing => storyFileName(existing) === storyFileName(story)
				)
			)
		) {
			setFile(file);
			setStories(stories);
		} else {
			void handleImport(stories);
		}
	}

	return (
		<DialogCard
			{...props}
			className="story-import-dialog"
			fixedSize
			headerLabel={t('dialogs.storyImport.title')}
		>
			<CardContent>
				<FileChooser
					onChange={handleFileChange}
					onError={error => setImportError(error.message)}
				/>
				{importError && <p role="alert">{importError}</p>}
				{file && stories.length > 0 && (
					<StoryChooser
						existingStories={existingStories}
						onImport={handleImport}
						stories={stories}
					/>
				)}
				{file && stories.length === 0 && (
					<p>{t('dialogs.storyImport.noStoriesInFile')}</p>
				)}
			</CardContent>
		</DialogCard>
	);
};
