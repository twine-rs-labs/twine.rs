import {createPopper, Instance, Modifier, Options, State} from '@popperjs/core';
import * as React from 'react';

export interface UsePopperOptions extends Partial<Options> {}

export interface UsePopperResult {
	attributes: Record<string, Record<string, string | boolean> | undefined>;
	forceUpdate: (() => void) | null;
	styles: Record<string, React.CSSProperties>;
	update: (() => Promise<Partial<State>>) | null;
}

const initialStyles: Record<string, React.CSSProperties> = {
	arrow: {position: 'absolute'},
	popper: {left: 0, position: 'absolute', top: 0}
};
const defaultOptions: UsePopperOptions = {};

function semanticallyEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => semanticallyEqual(value, right[index]))
		);
	}
	if (
		!left ||
		!right ||
		typeof left !== 'object' ||
		typeof right !== 'object' ||
		Object.getPrototypeOf(left) !== Object.prototype ||
		Object.getPrototypeOf(right) !== Object.prototype
	) {
		return false;
	}

	const leftObject = left as Record<string, unknown>;
	const rightObject = right as Record<string, unknown>;
	const keys = new Set([
		...Object.keys(leftObject),
		...Object.keys(rightObject)
	]);

	for (const key of keys) {
		if (!semanticallyEqual(leftObject[key], rightObject[key])) {
			return false;
		}
	}

	return true;
}

export function usePopper(
	referenceElement: Element | null,
	popperElement: HTMLElement | null,
	options: UsePopperOptions = defaultOptions
): UsePopperResult {
	const instanceRef = React.useRef<Instance | null>(null);
	const committedOptionsRef = React.useRef(options);
	const [state, setState] = React.useState<
		Pick<UsePopperResult, 'attributes' | 'styles'>
	>({attributes: {}, styles: initialStyles});
	const updateStateModifier = React.useMemo<
		Modifier<'updateState', Record<string, never>>
	>(
		() => ({
			enabled: true,
			fn: ({state: popperState}) => {
				setState({
					attributes: popperState.attributes,
					styles: Object.keys(popperState.elements).reduce<
						Record<string, React.CSSProperties>
					>((result, element) => {
						result[element] = popperState.styles[
							element
						] as React.CSSProperties;
						return result;
					}, {})
				});
			},
			name: 'updateState',
			phase: 'write',
			requires: ['computeStyles']
		}),
		[]
	);
	const popperOptions = React.useCallback(
		(options: UsePopperOptions) => ({
			...options,
			modifiers: [
				...(options.modifiers ?? []),
				{name: 'applyStyles', enabled: false},
				updateStateModifier
			]
		}),
		[updateStateModifier]
	);

	React.useLayoutEffect(() => {
		if (!referenceElement || !popperElement) {
			instanceRef.current = null;
			return;
		}

		const instance = createPopper(
			referenceElement,
			popperElement,
			popperOptions(options)
		);
		instanceRef.current = instance;
		committedOptionsRef.current = options;

		return () => {
			instance.destroy();
			if (instanceRef.current === instance) {
				instanceRef.current = null;
			}
		};
	}, [popperElement, popperOptions, referenceElement]);

	React.useLayoutEffect(() => {
		const instance = instanceRef.current;

		if (instance && !semanticallyEqual(committedOptionsRef.current, options)) {
			committedOptionsRef.current = options;
			void instance.setOptions(popperOptions(options));
		}
	});

	return {
		...state,
		forceUpdate: instanceRef.current?.forceUpdate ?? null,
		update: instanceRef.current?.update ?? null
	};
}
