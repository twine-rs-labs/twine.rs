import React from 'react';

const CSS = `
.tw-switch { display: inline-flex; align-items: center; gap: 9px; cursor: pointer; user-select: none;
	font-family: var(--font-ui); font-size: var(--fs-sm); color: var(--tx-2); }
.tw-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.tw-switch__track { position: relative; width: 32px; height: 18px; flex: none; border-radius: var(--r-pill);
	background: var(--ink-1); border: 1px solid var(--line-2); box-shadow: inset 0 1px 2px oklch(0 0 0 / 0.3);
	transition: background var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out); }
.tw-switch__thumb { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%;
	background: var(--tx-3); box-shadow: 0 1px 2px oklch(0 0 0 / 0.5);
	transition: transform var(--dur-2) var(--ease-snap), background var(--dur-2) var(--ease-out); }
.tw-switch input:checked + .tw-switch__track { background: var(--acc-blue); border-color: var(--acc-blue); }
.tw-switch input:checked + .tw-switch__track .tw-switch__thumb { transform: translateX(14px); background: var(--tx-on-accent); }
.tw-switch input:focus-visible + .tw-switch__track { box-shadow: var(--glow-focus); }
.tw-switch--disabled { opacity: 0.45; cursor: not-allowed; }
`;

function ensureStyle() {
	if (typeof document === 'undefined') return;
	if (document.getElementById('tw-switch-css')) return;
	const el = document.createElement('style');
	el.id = 'tw-switch-css';
	el.textContent = CSS;
	document.head.appendChild(el);
}

/** On/off toggle for settings (Reduced Motion, Snap to Grid, Follow Cursor). */
export function Switch({
	checked,
	onChange,
	label,
	disabled = false,
	className = '',
	...rest
}) {
	ensureStyle();
	return (
		<label
			className={['tw-switch', disabled ? 'tw-switch--disabled' : '', className]
				.filter(Boolean)
				.join(' ')}
		>
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={e => onChange && onChange(e.target.checked)}
				{...rest}
			/>
			<span className="tw-switch__track">
				<span className="tw-switch__thumb" />
			</span>
			{label && <span>{label}</span>}
		</label>
	);
}
