import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useCoreProjectHost} from '../../core';
import type {CoreStorySummary} from '../../core';
import {Story} from '../../store/stories';
import './story-stats.css';

const dateFormatter = new Intl.DateTimeFormat([], {
	dateStyle: 'full',
	timeStyle: 'long'
});

export interface StoryDetailsDialogStatsProps {
	story: Story;
}

export const StoryDetailsDialogStats: React.FC<
	StoryDetailsDialogStatsProps
> = props => {
	const {story} = props;
	const coreProjectHost = useCoreProjectHost();
	const [stats, setStats] = React.useState<CoreStorySummary>();
	React.useEffect(() => {
		let active = true;
		void coreProjectHost
			.queryStorySummaryAsync(story.id)
			.then(summary => active && setStats(summary));
		return () => {
			active = false;
		};
	}, [coreProjectHost, story.id]);
	const {t} = useTranslation();

	return (
		<div className="story-stats">
			<table className="counts">
				<tbody>
					<tr>
						<td>{stats?.characterCount ?? '—'}</td>
						<td>{t('dialogs.storyDetails.stats.characters')}</td>
					</tr>
					<tr>
						<td>{stats?.wordCount ?? '—'}</td>
						<td>{t('dialogs.storyDetails.stats.words')}</td>
					</tr>
					<tr>
						<td>{stats?.passageCount ?? story.passages.length}</td>
						<td>{t('dialogs.storyDetails.stats.passages')}</td>
					</tr>
					<tr>
						<td>{stats?.graph.links ?? '—'}</td>
						<td>{t('dialogs.storyDetails.stats.links')}</td>
					</tr>
					<tr>
						<td>{stats?.graph.brokenLinks ?? '—'}</td>
						<td>{t('dialogs.storyDetails.stats.brokenLinks')}</td>
					</tr>
				</tbody>
			</table>
			<div className="update-and-ifid">
				<p>
					{t('dialogs.storyDetails.stats.lastUpdate', {
						date: dateFormatter.format(story.lastUpdate)
					})}
				</p>
				<p>
					{t('dialogs.storyDetails.stats.ifid', {ifid: story.ifid})}&nbsp;
					<a href="https://ifdb.org/help-ifid" target="_blank" rel="noreferrer">
						{t('dialogs.storyDetails.stats.ifidExplanation')}
					</a>
				</p>
			</div>
		</div>
	);
};
