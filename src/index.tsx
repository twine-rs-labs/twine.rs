import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {App} from './app';
import './util/i18n';
import {installPerformanceHarness} from './util/performance-harness';

installPerformanceHarness();

ReactDOM.render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
	document.getElementById('root')
);
