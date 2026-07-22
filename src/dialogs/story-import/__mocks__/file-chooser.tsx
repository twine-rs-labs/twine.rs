import * as React from 'react';
import {fakeStory} from '../../../test-util';
import {FileChooserProps} from '../file-chooser';

const mockFile = new File([''], 'mock-file.html');
const mockStory = fakeStory();
const mockMixedNewStory = fakeStory();

mockStory.name = 'mock-story';
mockStory.passages[0].text = 'mock imported body';
mockMixedNewStory.name = 'mock-new-story';
mockMixedNewStory.passages[0].text = 'mock new imported body';

export const FileChooser: React.FC<FileChooserProps> = ({onChange}) => (
	<div data-testid="mock-file-chooser">
		<button onClick={() => onChange(mockFile, [mockStory])}>onChange</button>
		<button onClick={() => onChange(mockFile, [mockMixedNewStory, mockStory])}>
			onChange mixed
		</button>
		<button onClick={() => onChange(mockFile, [])}>onChange no story</button>
	</div>
);
