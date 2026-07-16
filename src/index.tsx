import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './app';
import './util/i18n';
import {installPerformanceHarness} from './util/performance-harness';

installPerformanceHarness();

const rootElement = document.getElementById('root');

if (!rootElement) {
	throw new Error('Could not find the root application element.');
}

createRoot(rootElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>
);
