import * as React from 'react';
import {formatEditorExtensions} from '../util/story-format';
import {loadFormatProperties, useStoryFormatsContext} from './story-formats';
import {formatEditorExtensionsDisabled, usePrefsContext} from './prefs';
import {getAppInfo} from '../util/app-info';

export const emptyFormatReferenceParser = () => [];

export function useFormatReferenceParser(
	formatName: string,
	formatVersion: string
) {
	const {prefs} = usePrefsContext();
	const {dispatch, formats} = useStoryFormatsContext();
	const format = formats.find(
		format => format.name === formatName && format.version === formatVersion
	);
	const [editorExtensions, setEditorExtensions] =
		React.useState<ReturnType<typeof formatEditorExtensions>>();
	const extensionsDisabled = formatEditorExtensionsDisabled(
		prefs,
		formatName,
		formatVersion
	);

	React.useEffect(() => {
		if (extensionsDisabled || !format) {
			setEditorExtensions(undefined);
			return;
		}

		if (format.loadState === 'unloaded') {
			dispatch(loadFormatProperties(format));
		} else if (format.loadState === 'loaded') {
			setEditorExtensions(
				formatEditorExtensions(format, getAppInfo().twineCompatibilityVersion)
			);
		}
	}, [dispatch, extensionsDisabled, format]);

	if (extensionsDisabled || !format) {
		return emptyFormatReferenceParser;
	}

	return (
		editorExtensions?.references?.parsePassageText ?? emptyFormatReferenceParser
	);
}
