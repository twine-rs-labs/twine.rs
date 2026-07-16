import {toHaveNoViolations} from 'jest-axe';
import {configure} from '@testing-library/dom';
import {TextDecoder, TextEncoder} from 'node:util';
import '@testing-library/jest-dom';
import 'jest-canvas-mock';

Object.defineProperties(globalThis, {
	TextDecoder: {configurable: true, value: TextDecoder},
	TextEncoder: {configurable: true, value: TextEncoder}
});

// Always mock these files so that Jest doesn't see import.meta.

jest.mock('./util/i18n');

jest.mock('./core/wasm/twine-wasm-client', () => {
	const actual = jest.requireActual('./core/wasm/twine-wasm-client');
	const {createTestCoreSessionClient} = jest.requireActual(
		'./test-util/test-core-session-client'
	);

	return {
		...actual,
		createWasmCoreWorkerClient: createTestCoreSessionClient
	};
});

// Mock this component so that we don't get spurious errors around needing
// focusable elements, because often we're mocking contents.

jest.mock('focus-trap-react');

configure({asyncUtilTimeout: 5000});

expect.extend(toHaveNoViolations);

// jsdom doesn't implement window.matchMedia, but TS knows about it, so we
// have to do some hacky stuff here.

beforeEach(
	() =>
		((window as any).matchMedia = jest.fn(() => ({
			addEventListener: jest.fn(),
			matches: false,
			removeEventListener: jest.fn()
		})))
);
afterEach(() => delete (window as any).matchMedia);

// jsdom also doesn't implement pointer events properly.
// see https://github.com/testing-library/dom-testing-library/issues/558

(window as any).PointerEvent = class FakePointerEvent extends Event {
	constructor(type: string, props: Record<string, unknown>) {
		super(type, props);

		for (const propName of [
			'button',
			'clientX',
			'clientY',
			'pointerType',
			'shiftKey'
		]) {
			if (props[propName] !== null) {
				(this as any)[propName] = props[propName];
			}
		}
	}
};

window.Element.prototype.releasePointerCapture = () => {};
window.Element.prototype.setPointerCapture = () => {};
window.Element.prototype.scrollTo = () => {};

// CodeMirror measures text ranges during animation frames. jsdom doesn't
// implement these Range APIs, so provide inert geometry to keep editor tests
// focused on DOM/state behavior.
if (typeof window.Range !== 'undefined') {
	window.Range.prototype.getBoundingClientRect = () =>
		({
			bottom: 0,
			height: 0,
			left: 0,
			right: 0,
			top: 0,
			width: 0,
			x: 0,
			y: 0
		}) as DOMRect;
	window.Range.prototype.getClientRects = () => [] as any;
}
