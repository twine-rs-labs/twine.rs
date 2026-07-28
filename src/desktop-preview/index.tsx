import '../styles/design-system/index.css';
import '../styles/typography.css';
import './desktop-story-preview.css';
import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {DesktopStoryPreview} from './desktop-story-preview';

const rootElement = document.getElementById('story-preview-root');

if (!rootElement) {
	throw new Error('Could not find the desktop story preview root.');
}

createRoot(rootElement).render(<DesktopStoryPreview />);
