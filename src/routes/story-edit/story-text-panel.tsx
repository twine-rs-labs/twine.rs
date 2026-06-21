import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {PassageEditContents} from '../../dialogs/passage-edit/passage-edit-contents';
import {Passage, Story} from '../../store/stories';
import {parseLinks} from '../../util/parse-links';
import {TagGrid} from '../../components/tag';
import {VisibleWhitespace} from '../../components/visible-whitespace';

export interface StoryTextPanelProps {
	selectedPassageId?: string;
	story: Story;
}

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

export const StoryTextPanel: React.FC<StoryTextPanelProps> = props => {
	const {selectedPassageId, story} = props;
	const selectedPassage = passageWithFallback(story, selectedPassageId);
	const {t} = useTranslation();
	const links = React.useMemo(
		() => (selectedPassage ? parseLinks(selectedPassage.text, true) : []),
		[selectedPassage]
	);

	if (!selectedPassage) {
		return (
			<section
				aria-label={t('routes.storyEdit.workspace.textMode')}
				className="story-edit-text-panel empty"
			>
				<p>{t('routes.storyEdit.workspace.noPassages')}</p>
			</section>
		);
	}

	return (
		<section
			aria-label={t('routes.storyEdit.workspace.textMode')}
			className="story-edit-text-panel"
		>
			<header className="story-edit-text-panel-header">
				<TagGrid tags={selectedPassage.tags} tagColors={story.tagColors} />
				<h2>
					<VisibleWhitespace value={selectedPassage.name} />
				</h2>
				<span>
					{t('routes.storyEdit.workspace.passageStats', {
						linkCount: links.length,
						wordCount: countWords(selectedPassage.text)
					})}
				</span>
			</header>
			<div className="story-edit-text-editor">
				<PassageEditContents
					key={selectedPassage.id}
					passageId={selectedPassage.id}
					storyId={story.id}
				/>
			</div>
		</section>
	);
};
