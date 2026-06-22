import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {FileInput} from '../../components/control/file-input';
import {Story} from '../../store/stories';
import {importStoriesAsync} from '../../util/import';
import {storyFromTwee} from '../../util/twee';

export interface FileChooserProps {
	onChange: (file: File, stories: Story[]) => void;
}

export const FileChooser: React.FC<FileChooserProps> = props => {
	const {onChange} = props;
	const {t} = useTranslation();

	async function handleChange(file: File, data: string) {
		if (/\.html$/.test(file.name)) {
			onChange(file, await importStoriesAsync(data));
		} else {
			onChange(file, [storyFromTwee(data)]);
		}
	}

	return (
		<div className="file-chooser">
			<p>
				<FileInput
					accept=".html,.twee,.tw"
					onChange={handleChange}
					orientation="vertical"
				>
					{t('dialogs.storyImport.filePrompt')}
				</FileInput>
			</p>
		</div>
	);
};
