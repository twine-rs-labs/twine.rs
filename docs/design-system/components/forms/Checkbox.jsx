import React from 'react';

const CSS = `
.tw-check { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;
	font-family: var(--font-ui); font-size: var(--fs-sm); color: var(--tx-2); }
.tw-check input { position: absolute; opacity: 0; width: 0; height: 0; }
.tw-check__box { width: 16px; height: 16px; flex: none; border-radius: var(--r-xs);
	background: var(--ink-1); border: 1px solid var(--line-2); box-shadow: inset 0 1px 2px oklch(0 0 0 / 0.3);
	display: inline-flex; align-items: center; justify-content: center; color: transparent;
	transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out); }
.tw-check__box .ti { font-size: 13px; }
.tw-check:hover .tw-check__box { border-color: var(--line-3); }
.tw-check input:checked + .tw-check__box { background: var(--acc-blue); border-color: var(--acc-blue); color: var(--tx-on-accent); }
.tw-check input:indeterminate + .tw-check__box { background: var(--acc-blue); border-color: var(--acc-blue); color: var(--tx-on-accent); }
.tw-check input:focus-visible + .tw-check__box { box-shadow: var(--glow-focus); }
.tw-check--disabled { opacity: 0.45; cursor: not-allowed; }
`;

function ensureStyle() {
	if (typeof document === 'undefined') return;
	if (document.getElementById('tw-check-css')) return;
	const el = document.createElement('style');
	el.id = 'tw-check-css';
	el.textContent = CSS;
	document.head.appendChild(el);
}

/** Checkbox with checked + indeterminate states (e.g. "Match Case", bulk select). */
export function Checkbox({
	checked,
	indeterminate = false,
	onChange,
	label,
	disabled = false,
	className = '',
	...rest
}) {
	ensureStyle();
	const ref = React.useRef(null);
	React.useEffect(() => {
		if (ref.current) ref.current.indeterminate = indeterminate;
	}, [indeterminate]);
	return (
		<label
			className={['tw-check', disabled ? 'tw-check--disabled' : '', className]
				.filter(Boolean)
				.join(' ')}
		>
			<input
				ref={ref}
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={e => onChange && onChange(e.target.checked)}
				{...rest}
			/>
			<span className="tw-check__box">
				<i className={`ti ti-${indeterminate ? 'minus' : 'check'}`} aria-hidden="true" />
			</span>
			{label && <span>{label}</span>}
		</label>
	);
}
