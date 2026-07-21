import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {StoryFormat} from '../../../store/story-formats';
import {
	inspectStoryFormatPublishSafety,
	storyFormatCapabilities
} from '../../../util/story-format';
import {Badge} from '../../badge/badge';

export interface StoryFormatItemDetailsProps {
	format: StoryFormat;
}

export const StoryFormatItemDetails: React.FC<StoryFormatItemDetailsProps> = ({
	format
}) => {
	const {t} = useTranslation();

	if (format.loadState === 'unloaded' || format.loadState === 'loading') {
		return (
			<div className="story-format-details">
				<p>{t('components.storyFormatItem.loadingFormat')}</p>
			</div>
		);
	}

	if (format.loadState === 'error') {
		return (
			<div className="story-format-details">
				<p>
					{t('components.storyFormatItem.loadError', {
						errorMessage: format.loadError.message
					})}
				</p>
			</div>
		);
	}

	const capabilities = storyFormatCapabilities(format.properties);
	const safety = inspectStoryFormatPublishSafety(format.properties);
	const capabilityBadges = [
		capabilities.parser && 'Parser',
		capabilities.exporter && 'Exporter',
		capabilities.syntax && 'Syntax',
		capabilities.autocomplete && 'Autocomplete',
		capabilities.diagnostics && 'Diagnostics',
		capabilities.editorToolbarActions && 'Editor extensions',
		capabilities.devOnlyTools && 'Dev tools',
		capabilities.lazyLoadedModules && 'Lazy loaded',
		capabilities.publishSafe && 'Publish safe'
	].filter((label): label is string => !!label);

	return (
		<div className="story-format-details">
			{format.properties.author && (
				<p className="story-format-author">
					{t('components.storyFormatItem.author', {
						author: format.properties.author
					})}
				</p>
			)}
			{format.properties.description && (
				<div className="story-format-description">
					{format.properties.description}
				</div>
			)}
			{format.properties.license && (
				<p className="story-format-license">
					{t('components.storyFormatItem.license', {
						license: format.properties.license
					})}
				</p>
			)}
			{capabilityBadges.length > 0 && (
				<div className="story-format-capabilities">
					{capabilityBadges.map(label => (
						<Badge key={label} label={label} />
					))}
				</div>
			)}
			{safety.issues.length > 0 && (
				<ul className="story-format-safety">
					{safety.issues.map(issue => (
						<li className={issue.severity} key={issue.code}>
							{issue.message}
						</li>
					))}
				</ul>
			)}
		</div>
	);
};
