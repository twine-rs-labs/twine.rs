import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';

const expectedInternalCrates = [
	'twine_cli',
	'twine_core',
	'twine_export',
	'twine_graph',
	'twine_model',
	'twine_native',
	'twine_parse',
	'twine_search',
	'twine_store',
	'twine_wasm'
];

test('every Rust workspace crate is explicitly non-publishable', () => {
	const toolchain = process.env.TWINE_RS_CARGO_TOOLCHAIN;
	const cargoCommand = toolchain
		? ['rustup', ['run', toolchain, 'cargo']]
		: ['cargo', []];
	const metadata = JSON.parse(
		execFileSync(
			cargoCommand[0],
			[
				...cargoCommand[1],
				'metadata',
				'--format-version',
				'1',
				'--locked',
				'--no-deps'
			],
			{encoding: 'utf8'}
		)
	);
	const workspaceMembers = new Set(metadata.workspace_members);
	const workspacePackages = metadata.packages
		.filter(packageMetadata => workspaceMembers.has(packageMetadata.id))
		.sort((left, right) => left.name.localeCompare(right.name));

	assert.deepEqual(
		workspacePackages.map(packageMetadata => packageMetadata.name),
		expectedInternalCrates
	);
	for (const packageMetadata of workspacePackages) {
		assert.deepEqual(
			packageMetadata.publish,
			[],
			`${packageMetadata.name} must inherit publish = false`
		);
	}
});
