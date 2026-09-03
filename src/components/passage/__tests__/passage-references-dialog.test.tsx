import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import type {
	CorePassageLocation,
	CorePassageReferencesPage,
	CoreProjectHost
} from '../../../core';
import {fakeStory} from '../../../test-util';
import {workbenchBufferCoordinator} from '../../../util/workbench-buffer-coordinator';
import {
	PassageReferencesDialog,
	type PassageReferencesDialogProps
} from '../passage-references-dialog';

describe('<PassageReferencesDialog>', () => {
	const story = fakeStory(2);
	const target = story.passages[1];
	const location: CorePassageLocation = {
		passageId: story.passages[0].id,
		passageName: story.passages[0].name,
		provenance: {
			capabilityRevision: 1,
			formatName: null,
			formatVersion: null,
			providerIdentifier: 'core.standard-passage-links'
		},
		resultKey: 'reference-key',
		revision: 4,
		span: {encoding: 'utf16-code-units', end: 11, start: 7},
		storyId: story.id
	};
	const page: CorePassageReferencesPage = {
		coverage: 'standard-links-only',
		nextCursor: null,
		passageId: target.id,
		references: [{location}],
		revision: 4,
		storyId: story.id,
		totalCount: 1
	};

	function renderDialog(
		overrides: Partial<PassageReferencesDialogProps> = {},
		query = jest.fn(async () => page)
	) {
		let patchListener: (() => void) | undefined;
		const host = {
			queryPassageReferencesPageAsync: query,
			sessionStatus: jest.fn(() => ({revision: page.revision})),
			subscribeToPatches: jest.fn(listener => {
				patchListener = listener;
				return jest.fn();
			})
		} as unknown as CoreProjectHost;
		const props: PassageReferencesDialogProps = {
			host,
			onClose: jest.fn(),
			onRevealInGraph: jest.fn(),
			onRevealInSource: jest.fn(),
			story,
			target,
			...overrides
		};

		render(<PassageReferencesDialog {...props} />);
		return {patch: () => patchListener?.(), props, query};
	}

	it('renders exact range provenance and emits source and graph locations', async () => {
		const {props, query} = renderDialog();

		expect(await screen.findByText('7–11 UTF-16')).toBeInTheDocument();
		expect(
			screen.getByText(/core\.standard-passage-links/)
		).toBeInTheDocument();
		expect(query).toHaveBeenCalledWith(story.id, target.id, {
			cursor: null,
			limit: 50
		});

		fireEvent.click(
			screen.getByRole('button', {
				name: 'components.passageReferences.revealInSource'
			})
		);
		fireEvent.click(
			screen.getByRole('button', {
				name: 'routes.storyEdit.workspace.revealInGraph'
			})
		);
		await waitFor(() =>
			expect(props.onRevealInSource).toHaveBeenCalledWith(location)
		);
		expect(props.onRevealInGraph).toHaveBeenCalledWith(location);
	});

	it('invalidates an in-flight page when the story changes', async () => {
		let resolveQuery!: (value: CorePassageReferencesPage) => void;
		const query = jest.fn(
			() =>
				new Promise<CorePassageReferencesPage>(resolve => {
					resolveQuery = resolve;
				})
		);
		const {patch} = renderDialog({}, query);

		await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
		act(() => patch());
		resolveQuery(page);

		expect(
			await screen.findByText('components.passageReferences.stale')
		).toBeInTheDocument();
		expect(screen.queryByText('7–11 UTF-16')).not.toBeInTheDocument();
		await new Promise(resolve => window.setTimeout(resolve, 0));
	});

	it('flushes registered buffers before issuing the reference query', async () => {
		const order: string[] = [];
		let pending = true;
		const unregister = workbenchBufferCoordinator.register({
			bufferId: 'pending-source',
			flush: async () => {
				order.push('flush');
				pending = false;
			},
			hasPendingChanges: () => pending,
			isComposing: () => false,
			revision: () => 1,
			storyId: story.id
		});
		const query = jest.fn(async () => {
			order.push('query');
			return page;
		});

		try {
			renderDialog({}, query);
			expect(await screen.findByText('7–11 UTF-16')).toBeInTheDocument();
			expect(order).toEqual(['flush', 'query']);
		} finally {
			unregister();
		}
	});

	it('does not query while a registered editor is composing', async () => {
		const unregister = workbenchBufferCoordinator.register({
			bufferId: 'composing-source',
			flush: jest.fn(),
			hasPendingChanges: () => true,
			isComposing: () => true,
			revision: () => 1,
			storyId: story.id
		});
		const query = jest.fn(async () => page);

		try {
			renderDialog({}, query);
			expect(
				await screen.findByText(/composing-source.*composing text/)
			).toBeInTheDocument();
			expect(query).not.toHaveBeenCalled();
		} finally {
			unregister();
		}
	});

	it('rejects a page whose revision is not the current host revision', async () => {
		renderDialog(
			{},
			jest.fn(async () => ({...page, revision: 3}))
		);

		expect(
			await screen.findByText('components.passageReferences.stale')
		).toBeInTheDocument();
		expect(screen.queryByText('7–11 UTF-16')).not.toBeInTheDocument();
	});
});
