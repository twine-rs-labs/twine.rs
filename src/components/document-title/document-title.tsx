import * as React from 'react';
import {isElectronRenderer} from '../../util/is-electron';

export interface DocumentTitleProps {
	title: string;
}

const appDocumentTitle = 'Twine RS';

export function brandedDocumentTitle(title: string) {
	const trimmedTitle = title.trim();

	if (trimmedTitle === '' || trimmedTitle === appDocumentTitle) {
		return appDocumentTitle;
	}

	if (trimmedTitle.endsWith(` - ${appDocumentTitle}`)) {
		return trimmedTitle;
	}

	return `${trimmedTitle} - ${appDocumentTitle}`;
}

/**
 * Sets the document title. This works around a bug with Electron and may not be
 * needed in later versions.
 */
export const DocumentTitle: React.FC<DocumentTitleProps> = ({title}) => {
	const documentTitle = brandedDocumentTitle(title);

	React.useEffect(() => {
		const previousTitle = document.title;
		let timeout: number | undefined;
		document.title = documentTitle;

		if (isElectronRenderer()) {
			// Hash history navigation does not immediately update Electron's native
			// title bar, so retain the delayed update used by the previous adapter.
			timeout = window.setTimeout(() => {
				document.title = documentTitle;
			}, 0);
		}

		return () => {
			if (timeout !== undefined) {
				window.clearTimeout(timeout);
			}
			document.title = previousTitle;
		};
	}, [documentTitle]);

	return null;
};
