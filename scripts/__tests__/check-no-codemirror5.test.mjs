import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	legacyCodeMirrorDependencyViolations,
	legacyCodeMirrorImportViolation
} from '../check-no-codemirror5.mjs';

test('rejects direct CodeMirror 5 production imports', () => {
	assert.match(
		legacyCodeMirrorImportViolation(
			"import CodeMirror from 'codemirror';",
			'src/example.ts'
		),
		/removed CodeMirror 5/
	);
	assert.match(
		legacyCodeMirrorImportViolation(
			"import {Controlled} from 'react-codemirror2';",
			'src/example.tsx'
		),
		/removed CodeMirror 5/
	);
	assert.match(
		legacyCodeMirrorImportViolation(
			"const CodeMirror = require('codemirror');",
			'src/example.cjs'
		),
		/removed CodeMirror 5/
	);
	assert.match(
		legacyCodeMirrorImportViolation("import 'codemirror';", 'src/example.ts'),
		/removed CodeMirror 5/
	);
	assert.match(
		legacyCodeMirrorImportViolation(
			"import 'codemirror/lib/codemirror.css';",
			'src/example.ts'
		),
		/removed CodeMirror 5/
	);
	assert.match(
		legacyCodeMirrorImportViolation(
			"import {CodeArea} from '../components/control/code-area';",
			'src/example.tsx'
		),
		/removed CodeMirror 5/
	);
	assert.match(
		legacyCodeMirrorImportViolation(
			"import '../components/control/code-area';",
			'src/example.tsx'
		),
		/removed CodeMirror 5/
	);
});

test('allows CodeMirror 6 packages and compatibility type names', () => {
	assert.equal(
		legacyCodeMirrorImportViolation(
			"import {EditorView} from '@codemirror/view';",
			'src/example.ts'
		),
		undefined
	);
	assert.equal(
		legacyCodeMirrorImportViolation(
			'export interface LegacyCodeMirrorFacade {}',
			'src/example.ts'
		),
		undefined
	);
});

test('rejects removed packages in every install dependency section', () => {
	assert.deepEqual(
		legacyCodeMirrorDependencyViolations({
			dependencies: {codemirror: '5.65.16'},
			devDependencies: {'@types/codemirror': '5.60.15'},
			optionalDependencies: {'react-codemirror2': '7.3.0'}
		}),
		[
			'package.json: devDependencies still contains @types/codemirror',
			'package.json: dependencies still contains codemirror',
			'package.json: optionalDependencies still contains react-codemirror2'
		]
	);
});
