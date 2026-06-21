import {render, screen} from '@testing-library/react';
import * as React from 'react';
import {Routes} from '..';
import {createHashHistory} from 'history';
import {PrefsContext, PrefsContextProps} from '../../store/prefs';
import {fakePrefs} from '../../test-util';

jest.mock('../story-edit/story-edit-route');
jest.mock('../story-list/story-list-route');
jest.mock('../assets/assets-route');
jest.mock('../build/build-route');
jest.mock('../contents/contents-route');
jest.mock('../diagnostics/diagnostics-route');
jest.mock('../new-project/new-project-route');
jest.mock('../story-formats/story-formats-route');
jest.mock('../story-play/story-play-route');
jest.mock('../story-proof/story-proof-route');
jest.mock('../story-test/story-test-route');

describe('<Routes>', () => {
	function renderAtRoute(route: string, context?: Partial<PrefsContextProps>) {
		const history = createHashHistory();

		history.push(route);
		return render(
			<PrefsContext.Provider
				value={{
					dispatch: jest.fn(),
					prefs: fakePrefs({welcomeSeen: true}),
					...context
				}}
			>
				<Routes />
			</PrefsContext.Provider>
		);
	}

	describe("when the user doesn't have a welcomeSeen pref", () => {
		it('renders the requested app route', () => {
			renderAtRoute('/stories/123', {
				dispatch: jest.fn(),
				prefs: fakePrefs({welcomeSeen: false})
			});
			expect(screen.getByTestId('mock-story-edit-route')).toBeInTheDocument();
		});
	});

	describe('when the user has a welcomeSeen pref', () => {
		it('renders the story edit route at /stories/:id', () => {
			renderAtRoute('/stories/123');
			expect(screen.getByTestId('mock-story-edit-route')).toBeInTheDocument();
		});

		it('renders the story list at /', () => {
			renderAtRoute('/');
			expect(screen.getByTestId('mock-story-list-route')).toBeInTheDocument();
		});

		it('renders the story play route at /stories/:id/play', () => {
			renderAtRoute('/stories/123/play');
			expect(screen.getByTestId('mock-story-play-route')).toBeInTheDocument();
		});

		it('renders the story build route at /stories/:id/build', () => {
			renderAtRoute('/stories/123/build');
			expect(screen.getByTestId('mock-build-route')).toBeInTheDocument();
		});

		it('renders the story contents route at /stories/:id/contents', () => {
			renderAtRoute('/stories/123/contents');
			expect(screen.getByTestId('mock-contents-route')).toBeInTheDocument();
		});

		it('renders the story diagnostics route at /stories/:id/diagnostics', () => {
			renderAtRoute('/stories/123/diagnostics');
			expect(screen.getByTestId('mock-diagnostics-route')).toBeInTheDocument();
		});

		it('renders the story assets route at /stories/:id/assets', () => {
			renderAtRoute('/stories/123/assets');
			expect(screen.getByTestId('mock-assets-route')).toBeInTheDocument();
		});

		it('renders the story formats route at /formats', () => {
			renderAtRoute('/formats');
			expect(
				screen.getByTestId('mock-story-formats-route')
			).toBeInTheDocument();
		});

		it('renders the story proof route at /stories/:id/proof', () => {
			renderAtRoute('/stories/123/proof');
			expect(screen.getByTestId('mock-story-proof-route')).toBeInTheDocument();
		});

		it('renders the story test route at /stories/:id/test', () => {
			renderAtRoute('/stories/123/test');
			expect(screen.getByTestId('mock-story-test-route')).toBeInTheDocument();
		});

		it('renders the story test route at /stories/:storyId/test/:passageId', () => {
			renderAtRoute('/stories/123/test/456');
			expect(screen.getByTestId('mock-story-test-route')).toBeInTheDocument();
		});

		it('renders the story list route at /welcome', () => {
			renderAtRoute('/welcome');
			expect(screen.getByTestId('mock-story-list-route')).toBeInTheDocument();
		});

		it('renders the new project route at /new-project', () => {
			renderAtRoute('/new-project');
			expect(screen.getByTestId('mock-new-project-route')).toBeInTheDocument();
		});

		it('renders the new project route at /new-project/import', () => {
			renderAtRoute('/new-project/import');
			expect(screen.getByTestId('mock-new-project-route')).toBeInTheDocument();
		});

		it('renders the story list route for unknown routes', () => {
			jest.spyOn(console, 'warn').mockReturnValue();
			renderAtRoute('/unknown-route');
			expect(screen.getByTestId('mock-story-list-route')).toBeInTheDocument();
		});
	});
});
