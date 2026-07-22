#!/usr/bin/env node

import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {generateComplianceArtifacts} = require('./compliance-artifacts.cjs');
const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const outputDir = path.join(rootDir, 'electron-build', 'compliance');
const counts = generateComplianceArtifacts({outputDir, rootDir});

console.log(
	`generate-compliance: wrote ${counts.total} components ` +
		`(${counts.npm} npm, ${counts.cargo} Cargo, ` +
		`${counts.runtime} runtime, ${counts.assets} assets, ` +
		`${counts.storyFormats} story formats) to ${outputDir}`
);
