import {render, screen} from '@testing-library/react';
import {readFileSync} from 'fs';
import {axe} from 'jest-axe';
import path from 'path';
import * as React from 'react';
import {PrefsState} from '../../../store/prefs';
import {FakeStateProvider} from '../../../test-util';
import {Dialogs} from '../dialogs';
import {DialogsContext, DialogsContextProps} from '../dialogs-context';

const MockComponent: React.FC<{
	children?: React.ReactNode;
	collapsed?: boolean;
	highlighted?: boolean;
	maximized?: boolean;
}> = ({children, collapsed, highlighted, maximized}) => (
	<div
		data-testid="mock-component"
		data-collapsed={collapsed}
		data-highlighted={highlighted}
		data-maximized={maximized}
	>
		{children}
	</div>
);

const FixedSizeMockComponent: React.FC = () => (
	<div className="fixed-size" data-testid="fixed-size-component" />
);

describe('<Dialogs>', () => {
	function renderComponent(
		context?: Partial<DialogsContextProps>,
		prefsContext?: Partial<PrefsState>
	) {
		return render(
			<FakeStateProvider prefs={prefsContext}>
				<DialogsContext.Provider
					value={{dialogs: [], dispatch: jest.fn(), ...context}}
				>
					<Dialogs />
				</DialogsContext.Provider>
			</FakeStateProvider>
		);
	}

	it('renders all dialogs in context', () => {
		renderComponent({
			dialogs: [
				{
					collapsed: false,
					component: MockComponent,
					highlighted: false,
					maximized: false,
					props: {children: 'mock child 1'}
				},
				{
					collapsed: false,
					component: MockComponent,
					highlighted: false,
					maximized: false,
					props: {children: 'mock child 2'}
				}
			]
		});

		expect(screen.getByText('mock child 1')).toBeInTheDocument();
		expect(screen.getByText('mock child 2')).toBeInTheDocument();
	});

	it('sets the collapsed prop on the dialog component', () => {
		renderComponent({
			dialogs: [
				{
					collapsed: true,
					component: MockComponent,
					highlighted: false,
					maximized: false,
					props: {children: 'mock child 1'}
				}
			]
		});

		expect(screen.getByTestId('mock-component').dataset.collapsed).toBe('true');
	});

	it('sets the highlighted prop on the dialog component', () => {
		renderComponent({
			dialogs: [
				{
					collapsed: true,
					component: MockComponent,
					highlighted: true,
					maximized: false,
					props: {children: 'mock child 1'}
				}
			]
		});

		expect(screen.getByTestId('mock-component').dataset.highlighted).toBe(
			'true'
		);
	});

	it('sets the maximized prop on the dialog component', () => {
		renderComponent({
			dialogs: [
				{
					collapsed: true,
					component: MockComponent,
					highlighted: false,
					maximized: true,
					props: {children: 'mock child 1'}
				}
			]
		});

		expect(screen.getByTestId('mock-component').dataset.maximized).toBe('true');
		expect(screen.getByTestId('mock-component').parentElement).toHaveClass(
			'dialog-transition-shell',
			'maximized'
		);
	});

	it('uses a transition shell that retains collapsed layout state', () => {
		renderComponent({
			dialogs: [
				{
					collapsed: true,
					component: MockComponent,
					highlighted: false,
					maximized: false
				}
			]
		});

		expect(screen.getByTestId('mock-component').parentElement).toHaveClass(
			'dialog-transition-shell',
			'collapsed'
		);
	});

	it('mirrors fixed-size child layout onto the transition shell', () => {
		renderComponent({
			dialogs: [
				{
					collapsed: false,
					component: FixedSizeMockComponent,
					highlighted: false,
					maximized: false
				}
			]
		});

		expect(
			screen.getByTestId('fixed-size-component').parentElement
		).toHaveClass('dialog-transition-shell', 'fixed-size');
	});

	it('reserves the unmaximized side column on a maximized shell', () => {
		renderComponent(
			{
				dialogs: [
					{
						collapsed: false,
						component: MockComponent,
						highlighted: false,
						maximized: true
					},
					{
						collapsed: false,
						component: MockComponent,
						highlighted: false,
						maximized: false
					}
				]
			},
			{dialogWidth: 480}
		);

		expect(
			document.querySelector<HTMLElement>('.maximized')?.style.marginRight
		).toBe('calc(480px + var(--grid-size))');
	});

	it('keeps vertical flex sizing on the transition shell', () => {
		const css = readFileSync(path.join(__dirname, '../dialogs.css'), 'utf8');

		expect(css).toMatch(
			/\.dialog-transition-shell \{[^}]*flex: 1 1 0;[^}]*flex-direction: column;[^}]*min-height: 0;/s
		);
		expect(css).toMatch(
			/\.dialog-transition-shell\.fixed-size \{[^}]*flex: 0 0 auto;[^}]*min-height: auto;/s
		);
		expect(css).toMatch(
			/\.dialog-transition-shell > \.background-dialog-card \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;/s
		);
		expect(css).toMatch(/\.dialogs \.maximized \{[^}]*width: auto;/s);
		expect(css).not.toMatch(/\.dialog-card\.collapsed/);
	});

	// Using screen.debug() doesn't seem to show the padding-left style. Maybe a
	// gap in jsdom?

	it.skip('renders unmaximized dialogs at the width given by the dialogsWidth pref', () => {
		const dialogWidth = Math.random() * 1000;

		renderComponent(undefined, {dialogWidth});
		expect(
			document.querySelector<HTMLDivElement>('.dialogs')?.style.paddingLeft
		).toBe(`${dialogWidth}px`);
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
