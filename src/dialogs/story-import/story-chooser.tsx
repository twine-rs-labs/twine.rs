import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Button, Checkbox} from '../../components/design-system';
import {storyFileName} from '../../electron/shared';
import {Story, StoryWithDocuments} from '../../store/stories';
import './story-chooser.css';

export interface StoryChooserProps {
	existingStories: Story[];
	onImport: (stories: StoryWithDocuments[]) => void;
	stories: StoryWithDocuments[];
}

export const StoryChooser: React.FC<StoryChooserProps> = props => {
	const {existingStories, onImport, stories} = props;
	const [selectedStories, setSelectedStories] = React.useState<
		StoryWithDocuments[]
	>([]);
	const {t} = useTranslation();

	// Whenever either existing stories or stories to import changes, select all
	// stories that do not conflict.

	const willReplaceExisting = React.useCallback(
		(story: Story) => {
			return existingStories.some(
				other => storyFileName(other) === storyFileName(story)
			);
		},
		[existingStories]
	);

	React.useEffect(() => {
		setSelectedStories(stories.filter(story => !willReplaceExisting(story)));
	}, [stories, willReplaceExisting]);

	function handleChange(story: StoryWithDocuments, selected: boolean) {
		if (selected) {
			setSelectedStories(current => [...current, story]);
		} else {
			setSelectedStories(current =>
				current.filter(other => other.id !== story.id)
			);
		}
	}

	return (
		<div className="story-chooser">
			<p>{t('dialogs.storyImport.storiesPrompt')}</p>
			<ul>
				{stories.map(story => (
					<li key={story.id}>
						<Checkbox
							checked={selectedStories.includes(story)}
							label={story.name}
							onChange={selected => handleChange(story, selected)}
						/>
						{selectedStories.includes(story) && willReplaceExisting(story) && (
							<span className="replace-warning">
								{t('dialogs.storyImport.willReplaceExisting')}
							</span>
						)}
					</li>
				))}
			</ul>
			<div className="actions">
				<Button
					disabled={selectedStories.length === 0}
					icon="file-import"
					onClick={() => onImport(selectedStories)}
					variant="primary"
				>
					{t('dialogs.storyImport.importSelected')}
				</Button>
			</div>
		</div>
	);
};
