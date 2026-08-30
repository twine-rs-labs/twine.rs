import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {
	SourceEditor,
	type SourceEditorHandle
} from '../../../components/control/source-editor';
import type {StoryFormatProperties} from '../../../store/story-formats';
import {FakeStateProvider, fakeLoadedStoryFormat} from '../../../test-util';
import {
	hydrateStoryFormatProperties,
	resolveStoryFormatEditorIntegration
} from '../../../util/story-format';
import type {AdaptedLegacyEditorIntegration} from '../../../util/story-format/editor-integration';
import {StoryFormatToolbar} from '../story-format-toolbar';

function chapbookIntegration(
	version: '1.2.3' | '2.3.1' = '2.3.1'
): AdaptedLegacyEditorIntegration {
	let raw: StoryFormatProperties | undefined;
	const source = readFileSync(
		join(process.cwd(), `public/story-formats/chapbook-${version}/format.js`),
		'utf8'
	);

	new Function('window', source)({
		storyFormat(properties: StoryFormatProperties) {
			raw = properties;
		}
	});

	const properties = hydrateStoryFormatProperties(raw!).properties;
	const format = fakeLoadedStoryFormat(
		{
			name: 'Chapbook',
			url: `story-formats/chapbook-${version}/format.js`,
			userAdded: false,
			version
		},
		properties
	);
	const integration = resolveStoryFormatEditorIntegration(format, {
		twineVersion: '2.12.0'
	});

	if (integration.type !== 'adapted-legacy') {
		throw new Error('Chapbook fixture did not resolve through the adapter');
	}

	return integration;
}

const Harness: React.FC<{
	id?: string;
	integration?: AdaptedLegacyEditorIntegration;
	onHandle: (handle: SourceEditorHandle) => void;
	onFailure: jest.Mock;
}> = ({
	id = 'chapbook-toolbar-editor',
	integration: integrationOverride,
	onFailure,
	onHandle
}) => {
	const [editor, setEditor] = React.useState<SourceEditorHandle>();
	const [value, setValue] = React.useState('word');
	const defaultIntegration = React.useMemo(chapbookIntegration, []);
	const integration = integrationOverride ?? defaultIntegration;
	const setEditorRef = React.useCallback(
		(instance: SourceEditorHandle | null) => {
			if (instance) {
				setEditor(current => current ?? instance);
				onHandle(instance);
			}
		},
		[onHandle]
	);

	return (
		<>
			<SourceEditor
				id={id}
				label="Chapbook passage"
				onChange={setValue}
				ref={setEditorRef}
				value={value}
			/>
			{editor && (
				<StoryFormatToolbar
					editor={editor}
					integration={integration}
					onFailure={onFailure}
				/>
			)}
		</>
	);
};

function testIntegration(
	key: string,
	command: (editor: {replaceRange(text: string, from: unknown): void}) => void,
	toolbar = jest.fn(() => [
		{
			command: 'run',
			icon: 'data:image/png;base64,AA==',
			label: 'Run',
			type: 'button'
		}
	])
) {
	return {
		codeMirror: {
			commands: {run: command},
			toolbar
		},
		formatId: 'test-format',
		formatName: 'Test Format',
		formatVersion: '1.0.0',
		key,
		type: 'adapted-legacy'
	} as unknown as AdaptedLegacyEditorIntegration;
}

describe('<StoryFormatToolbar>', () => {
	it('blocks legacy toolbar callbacks during admission closure without a local echo, then resumes them', async () => {
		let editor: SourceEditorHandle | undefined;
		const onFailure = jest.fn();
		const integration = testIntegration('admission', legacyEditor =>
			legacyEditor.replaceRange('changed', {ch: 0, line: 0})
		);
		render(
			<FakeStateProvider>
				<Harness
					integration={integration}
					onFailure={onFailure}
					onHandle={instance => {
						editor = instance;
					}}
				/>
			</FakeStateProvider>
		);
		await waitFor(() => expect(editor).toBeTruthy());
		act(() => editor!.setInputAdmission!(false));
		fireEvent.click(await screen.findByRole('button', {name: 'Run'}));
		expect(editor!.getSnapshot().document).toBe('word');
		expect(onFailure).not.toHaveBeenCalled();
		act(() => editor!.setInputAdmission!(true));
		fireEvent.click(screen.getByRole('button', {name: 'Run'}));
		expect(editor!.getSnapshot().document).toBe('changedword');
	});

	it('runs the real Chapbook 1.2.3 toolbar against a live CM6 view', async () => {
		let editor: SourceEditorHandle | undefined;

		render(
			<FakeStateProvider>
				<Harness
					integration={chapbookIntegration('1.2.3')}
					onFailure={jest.fn()}
					onHandle={instance => {
						editor = instance;
					}}
				/>
			</FakeStateProvider>
		);

		await waitFor(() => expect(editor).toBeTruthy());
		act(() => editor!.setSelections([{anchor: 0, head: 4}]));
		fireEvent.click(await screen.findByRole('button', {name: 'Style'}));
		fireEvent.click(await screen.findByRole('button', {name: 'Bold'}));
		await waitFor(() =>
			expect(editor!.getSnapshot()).toMatchObject({
				document: '**word**',
				selections: [{anchor: 0, head: 8}]
			})
		);
	});

	it('runs real Chapbook formatting and insertion commands through the scoped facade', async () => {
		let editor: SourceEditorHandle | undefined;
		const onFailure = jest.fn();

		render(
			<FakeStateProvider>
				<Harness
					onFailure={onFailure}
					onHandle={instance => {
						editor = instance;
					}}
				/>
			</FakeStateProvider>
		);

		await waitFor(() => expect(editor).toBeTruthy());
		act(() => editor!.setSelections([{anchor: 0, head: 4}]));
		fireEvent.click(await screen.findByRole('button', {name: 'Style'}));
		fireEvent.click(await screen.findByRole('button', {name: 'Bold'}));

		await waitFor(() =>
			expect(editor!.getSnapshot()).toMatchObject({
				document: '**word**',
				selections: [{anchor: 0, head: 8}]
			})
		);
		expect(document.activeElement).toBe(
			screen.getByTestId('chapbook-toolbar-editor').querySelector('.cm-content')
		);
		act(() => {
			expect(editor!.runCommand('undo')).toBe(true);
		});
		await waitFor(() => expect(editor!.getSnapshot().document).toBe('word'));
		act(() => {
			expect(editor!.runCommand('redo')).toBe(true);
		});
		await waitFor(() =>
			expect(editor!.getSnapshot().document).toBe('**word**')
		);

		act(() => editor!.setSelections([{anchor: 8, head: 8}]));
		fireEvent.click(await screen.findByRole('button', {name: 'Link'}));
		fireEvent.click(await screen.findByRole('button', {name: 'Passage Link'}));

		await waitFor(() =>
			expect(editor!.getSnapshot().document).toBe(
				"**word**{link to: 'Passage name', label: 'Label text'}"
			)
		);

		act(() => {
			const end = editor!.getSnapshot().document.length;

			editor!.setSelections([{anchor: end, head: end}]);
		});
		fireEvent.click(screen.getByRole('button', {name: 'Modifiers'}));
		fireEvent.click(await screen.findByRole('button', {name: 'If'}));
		await waitFor(() =>
			expect(editor!.getSnapshot().document).toContain('[if condition]')
		);

		act(() => {
			const end = editor!.getSnapshot().document.length;

			editor!.setSelections([{anchor: end, head: end}]);
		});
		fireEvent.click(screen.getByRole('button', {name: 'Embed'}));
		fireEvent.click(await screen.findByRole('button', {name: 'Embed Passage'}));
		await waitFor(() =>
			expect(editor!.getSnapshot().document).toContain(
				"{embed passage: 'Passage name'}"
			)
		);

		act(() => {
			const end = editor!.getSnapshot().document.length;

			editor!.setSelections([{anchor: end, head: end}]);
		});
		fireEvent.click(screen.getByRole('button', {name: 'Input'}));
		fireEvent.click(await screen.findByRole('button', {name: 'Text Input'}));
		await waitFor(() =>
			expect(editor!.getSnapshot().document).toContain(
				"{text input for: 'variable name'}"
			)
		);
		expect(onFailure).not.toHaveBeenCalled();
	});

	it('keeps repeated selection refreshes bounded to one factory call each', async () => {
		let editor: SourceEditorHandle | undefined;
		const toolbar = jest.fn(() => [
			{
				command: 'run',
				icon: 'data:image/png;base64,AA==',
				label: 'Run',
				type: 'button'
			}
		]);
		const integration = testIntegration(
			'selection-refresh',
			jest.fn(),
			toolbar
		);

		render(
			<FakeStateProvider>
				<Harness
					integration={integration}
					onFailure={jest.fn()}
					onHandle={instance => {
						editor = instance;
					}}
				/>
			</FakeStateProvider>
		);
		await screen.findByRole('button', {name: 'Run'});
		await waitFor(() => expect(toolbar).toHaveBeenCalled());
		const beforeSelections = toolbar.mock.calls.length;

		for (let index = 0; index < 20; index++) {
			act(() =>
				editor!.setSelections([{anchor: index % 2, head: (index % 2) + 1}])
			);
		}

		expect(toolbar).toHaveBeenCalledTimes(beforeSelections + 20);
	});

	it('keeps command and toolbar state isolated between two live editor views', async () => {
		const integration = chapbookIntegration();
		let first: SourceEditorHandle | undefined;
		let second: SourceEditorHandle | undefined;

		render(
			<FakeStateProvider>
				<Harness
					id="chapbook-first"
					integration={integration}
					onFailure={jest.fn()}
					onHandle={instance => {
						first = instance;
					}}
				/>
				<Harness
					id="chapbook-second"
					integration={integration}
					onFailure={jest.fn()}
					onHandle={instance => {
						second = instance;
					}}
				/>
			</FakeStateProvider>
		);

		await waitFor(() => expect(first && second).toBeTruthy());
		act(() => first!.setSelections([{anchor: 0, head: 4}]));
		const styleButtons = await screen.findAllByRole('button', {name: 'Style'});

		fireEvent.click(styleButtons[0]);
		const boldButtons = await screen.findAllByRole('button', {name: 'Bold'});

		fireEvent.click(boldButtons[0]);
		await waitFor(() => expect(first!.getSnapshot().document).toBe('**word**'));
		expect(second!.getSnapshot()).toMatchObject({
			document: 'word',
			selections: [{anchor: 0, head: 0}]
		});
	});

	it('relies on the synchronous editor subscription for one post-command refresh', async () => {
		let editor: SourceEditorHandle | undefined;
		const toolbar = jest.fn(() => [
			{
				command: 'run',
				icon: 'data:image/png;base64,AA==',
				label: 'Run',
				type: 'button'
			}
		]);
		const integration = testIntegration(
			'one-refresh',
			facade => facade.replaceRange('!', {ch: 4, line: 0}),
			toolbar
		);

		render(
			<FakeStateProvider>
				<Harness
					integration={integration}
					onFailure={jest.fn()}
					onHandle={instance => {
						editor = instance;
					}}
				/>
			</FakeStateProvider>
		);

		const run = await screen.findByRole('button', {name: 'Run'});

		await waitFor(() => expect(toolbar).toHaveBeenCalled());
		const beforeCommand = toolbar.mock.calls.length;

		fireEvent.click(run);
		await waitFor(() => expect(editor?.getSnapshot().document).toBe('word!'));
		expect(toolbar).toHaveBeenCalledTimes(beforeCommand + 1);
	});

	it('resets command failures when the integration identity changes', async () => {
		let editor: SourceEditorHandle | undefined;
		const onFailure = jest.fn();
		const failed = testIntegration('failed', () => {
			throw new Error('command failed');
		});
		const recovered = testIntegration('recovered', facade =>
			facade.replaceRange('!', {ch: 4, line: 0})
		);
		const view = render(
			<FakeStateProvider>
				<Harness
					integration={failed}
					onFailure={onFailure}
					onHandle={instance => {
						editor = instance;
					}}
				/>
			</FakeStateProvider>
		);
		const run = await screen.findByRole('button', {name: 'Run'});

		fireEvent.click(run);
		await waitFor(() => expect(run).toBeDisabled());
		expect(onFailure).toHaveBeenCalledWith('command', expect.any(Error));

		view.rerender(
			<FakeStateProvider>
				<Harness
					integration={recovered}
					onFailure={onFailure}
					onHandle={instance => {
						editor = instance;
					}}
				/>
			</FakeStateProvider>
		);
		await waitFor(() => expect(run).toBeEnabled());
		fireEvent.click(run);
		await waitFor(() => expect(editor?.getSnapshot().document).toBe('word!'));
	});

	it('is accessible with the real Chapbook toolbar', async () => {
		const {container} = render(
			<FakeStateProvider>
				<Harness onFailure={jest.fn()} onHandle={jest.fn()} />
			</FakeStateProvider>
		);

		await screen.findByRole('toolbar', {name: 'Chapbook editor toolbar'});
		expect(await axe(container)).toHaveNoViolations();
	});
});
