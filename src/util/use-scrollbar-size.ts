import * as React from 'react';

export interface ScrollbarSize {
	height: number;
	width: number;
}

export function measureScrollbarSize(): ScrollbarSize {
	const measurement = document.createElement('div');
	measurement.setAttribute('aria-hidden', 'true');
	Object.assign(measurement.style, {
		height: '100px',
		overflow: 'scroll',
		position: 'absolute',
		visibility: 'hidden',
		width: '100px'
	});
	document.body.appendChild(measurement);

	const size = {
		height: measurement.offsetHeight - measurement.clientHeight,
		width: measurement.offsetWidth - measurement.clientWidth
	};

	measurement.remove();
	return size;
}

export function useScrollbarSize(debounceMs = 100): ScrollbarSize {
	const [size, setSize] = React.useState<ScrollbarSize>({height: 0, width: 0});

	React.useLayoutEffect(() => {
		let active = true;
		let timeout: number | undefined;
		const measure = () => {
			const next = measureScrollbarSize();

			if (active) {
				setSize(current =>
					current.height === next.height && current.width === next.width
						? current
						: next
				);
			}
		};
		const queueMeasurement = () => {
			if (timeout !== undefined) {
				window.clearTimeout(timeout);
			}
			timeout = window.setTimeout(measure, debounceMs);
		};

		measure();
		window.addEventListener('resize', queueMeasurement);

		return () => {
			active = false;
			window.removeEventListener('resize', queueMeasurement);
			if (timeout !== undefined) {
				window.clearTimeout(timeout);
			}
		};
	}, [debounceMs]);

	return size;
}
