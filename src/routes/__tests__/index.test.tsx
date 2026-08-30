import {render, screen} from '@testing-library/react';
import * as React from 'react';
import {StoreCoreProjectHost} from '../../test-util/core-project-host-runtime';
import {Routes} from '..';
import {PrefsContext, PrefsContextProps} from '../../store/prefs';
import {FakeStateProvider, fakePrefs} from '../../test-util';

jest.mock('../story-edit/story-edit-route');
jest.mock('../story-list/story-list-route');
jest.mock('../assets/assets-route');
jest.mock('../build/build-route');
jest.mock('../contents/contents-route');
jest.mock('../diagnostics/diagnostics-route');
jest.mock('../new-project/new-project-route');
jest.mock('../settings/settings-route');
jest.mock('../story-formats/story-formats-route');
jest.mock('../story-preview/story-preview-route');

describe('<Routes>', () => {
	function renderAtRoute(route: string, context?: Partial<PrefsContextProps>) {
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryStoryWordCountAsync')
			.mockImplementation(() => new Promise<never>(() => {}));
		window.location.hash = route;
		return render(
			<FakeStateProvider>
				<PrefsContext.Provider
					value={{
						dispatch: jest.fn(),
						prefs: fakePrefs({welcomeSeen: true}),
						...context
					}}
				>
					<Routes />
				</PrefsContext.Provider>
			</FakeStateProvider>
		);
	}

	afterEach(() => {
		jest.restoreAllMocks();
		window.location.hash = '';
	});

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
			expect(screen.getByTestId('mock-story-edit-route')).toHaveAttribute(
				'data-story-id',
				'123'
			);
		});

		it('renders the exact story edit route while preserving its query string', () => {
			renderAtRoute('/stories/123?mode=text&passage=456');
			expect(screen.getByTestId('mock-story-edit-route')).toHaveAttribute(
				'data-search',
				'?mode=text&passage=456'
			);
		});

		it('renders the story list at /', () => {
			renderAtRoute('/');
			expect(screen.getByTestId('mock-story-list-route')).toBeInTheDocument();
		});

		it('renders the canonical preview route with its target query', () => {
			renderAtRoute('/stories/123/preview?target=test&passage=456');
			expect(screen.getByTestId('mock-story-preview-route')).toHaveAttribute(
				'data-search',
				'?target=test&passage=456'
			);
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

		it('renders the settings route at /settings', () => {
			renderAtRoute('/settings');
			expect(screen.getByTestId('mock-settings-route')).toBeInTheDocument();
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

		it.each([
			'/unknown-route',
			'/stories/123/build/extra',
			'/stories/123/unknown'
		])(
			'warns and renders the story list route for unmatched path %s',
			route => {
				const warn = jest.spyOn(console, 'warn').mockReturnValue();

				renderAtRoute(route);
				expect(screen.getByTestId('mock-story-list-route')).toBeInTheDocument();
				expect(warn).toHaveBeenCalledWith(
					`No route for path "${route}", rendering story list`
				);
			}
		);
	});
});
