import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter, useNavigate} from 'react-router';
import type {
	NativeCommandLineOpenResult,
	TwineElectronWindow
} from '../../electron/shared';
import {
	StoriesContext,
	type StoriesContextProps,
	type StoriesState
} from '../../store/stories';
import {fakeStory, LocationInspector} from '../../test-util';
import {CommandLineOpenSync} from '../command-line-open-sync';

interface Deferred<T> {
	promise: Promise<T>;
	reject(reason: unknown): void;
	resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
	let reject!: (reason: unknown) => void;
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		reject = promiseReject;
		resolve = promiseResolve;
	});

	return {promise, reject, resolve};
}

function story(id: string, name: string) {
	const result = fakeStory();

	result.id = id;
	result.name = name;
	result.passages = result.passages.map(passage => ({...passage, story: id}));
	return result;
}

function openedResult(
	openedStory = story('opened-story', 'Opened Story')
): NativeCommandLineOpenResult {
	return {
		errors: [],
		openedProjects: [
			{
				passageTextLoaded: true,
				rootPath: '/native/opened-story.twine.rs',
				stories: [openedStory],
				storyIds: [openedStory.id]
			}
		],
		unsupportedPaths: []
	};
}

const NavigationControls: React.FC = () => {
	const navigate = useNavigate();

	return (
		<>
			<button onClick={() => navigate('/elsewhere')}>Navigate elsewhere</button>
			<button onClick={() => navigate(-1)}>History back</button>
		</>
	);
};

function app(context: StoriesContextProps) {
	return (
		<React.StrictMode>
			<MemoryRouter initialEntries={['/initial']}>
				<StoriesContext.Provider value={context}>
					<CommandLineOpenSync />
					<LocationInspector />
					<NavigationControls />
				</StoriesContext.Provider>
			</MemoryRouter>
		</React.StrictMode>
	);
}

async function resolve<T>(pending: Deferred<T>, value: T) {
	await act(async () => {
		pending.resolve(value);
		await pending.promise;
	});
}

async function reject<T>(pending: Deferred<T>, reason: unknown) {
	await act(async () => {
		pending.reject(reason);
		await pending.promise.catch(() => undefined);
	});
}

describe('<CommandLineOpenSync>', () => {
	let pending: Deferred<NativeCommandLineOpenResult>;
	let consume: jest.Mock;

	beforeEach(() => {
		pending = deferred();
		consume = jest.fn(() => pending.promise);
		(window as TwineElectronWindow).twineElectron = {
			consumeCommandLineOpenRequests: consume
		} as unknown as TwineElectronWindow['twineElectron'];
		window.localStorage.clear();
	});

	afterEach(() => {
		delete (window as TwineElectronWindow).twineElectron;
		jest.restoreAllMocks();
	});

	it('consumes and applies a command-line open exactly once under StrictMode replay', async () => {
		const dispatch = jest.fn();

		render(app({dispatch, stories: []}));
		expect(consume).toHaveBeenCalledTimes(1);

		await resolve(pending, openedResult());
		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/stories/opened-story'
			)
		);
		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				state: [expect.objectContaining({id: 'opened-story'})],
				type: 'init'
			})
		);

		fireEvent.click(screen.getByRole('button', {name: 'History back'}));
		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/initial'
			)
		);
	});

	it('uses the latest location, dispatch, and stories when the request resolves', async () => {
		const initialDispatch = jest.fn();
		const latestDispatch = jest.fn();
		const latestStory = story('latest-story', 'Latest Story');
		const result = render(app({dispatch: initialDispatch, stories: []}));

		fireEvent.click(screen.getByRole('button', {name: 'Navigate elsewhere'}));
		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/elsewhere'
			)
		);

		result.rerender(
			app({dispatch: latestDispatch, stories: [latestStory] as StoriesState})
		);
		await resolve(pending, openedResult());

		expect(initialDispatch).not.toHaveBeenCalled();
		expect(latestDispatch).toHaveBeenCalledTimes(1);
		expect(
			latestDispatch.mock.calls[0][0].state.map(
				(storedStory: {id: string}) => storedStory.id
			)
		).toEqual(['latest-story', 'opened-story']);
		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/stories/opened-story'
			)
		);

		fireEvent.click(screen.getByRole('button', {name: 'History back'}));
		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/elsewhere'
			)
		);
	});

	it('does not apply a pending command-line open after final unmount', async () => {
		const dispatch = jest.fn();
		const result = render(app({dispatch, stories: []}));

		expect(consume).toHaveBeenCalledTimes(1);
		result.unmount();
		await resolve(pending, openedResult());

		expect(dispatch).not.toHaveBeenCalled();
		expect(
			window.localStorage.getItem('twine-rs-project-metadata-opened-story')
		).toBeNull();
	});

	it('reports a rejected command-line open exactly once under StrictMode replay', async () => {
		const dispatch = jest.fn();
		const reason = new Error('mock command-line failure');
		const warn = jest.spyOn(console, 'warn').mockImplementation();

		render(app({dispatch, stories: []}));
		expect(consume).toHaveBeenCalledTimes(1);
		await reject(pending, reason);

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(
			'Could not consume command-line open requests:',
			reason
		);
		expect(dispatch).not.toHaveBeenCalled();
		expect(screen.getByTestId('location')).toHaveAttribute(
			'data-pathname',
			'/initial'
		);
		expect(window.localStorage).toHaveLength(0);
	});

	it('silences a rejected command-line open after final unmount', async () => {
		const dispatch = jest.fn();
		const warn = jest.spyOn(console, 'warn').mockImplementation();
		const result = render(app({dispatch, stories: []}));

		expect(consume).toHaveBeenCalledTimes(1);
		result.unmount();
		await reject(pending, new Error('mock command-line failure'));

		expect(warn).not.toHaveBeenCalled();
		expect(dispatch).not.toHaveBeenCalled();
		expect(window.localStorage).toHaveLength(0);
	});
});
