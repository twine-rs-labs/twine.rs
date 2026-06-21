import React from 'react';

const CSS = `
.tw-select { position: relative; display: inline-flex; align-items: center; min-width: 0; }
.tw-select--block { display: flex; width: 100%; }
.tw-select select {
	appearance: none; -webkit-appearance: none; width: 100%; height: var(--ctl-h);
	padding: 0 30px 0 10px; font-family: var(--font-ui); font-size: var(--fs-sm);
	color: var(--tx-1); background: var(--ink-4); border: 1px solid var(--line-2);
	border-radius: var(--r-sm); cursor: pointer; box-shadow: var(--edge-hi);
	transition: border-color var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out);
}
.tw-select select:hover { border-color: var(--line-3); background: var(--ink-5); }
.tw-select select:focus-visible { outline: none; border-color: var(--focus-ring); box-shadow: var(--glow-focus); }
.tw-select select:disabled { opacity: 0.5; cursor: not-allowed; }
.tw-select select option { background: var(--ink-5); color: var(--tx-1); }
.tw-select__chev { position: absolute; right: 8px; pointer-events: none; color: var(--tx-3); font-size: 16px;
	display: inline-flex; }
.tw-select--sm select { height: var(--ctl-h-sm); font-size: var(--fs-xs); padding: 0 26px 0 8px; }
`;

function ensureStyle() {
	if (typeof document === 'undefined') return;
	if (document.getElementById('tw-select-css')) return;
	const el = document.createElement('style');
	el.id = 'tw-select-css';
	el.textContent = CSS;
	document.head.appendChild(el);
}

/** Native select styled for the workbench (story format, sort, filter, etc.). */
export function Select({
	options,
	value,
	onChange,
	size = 'md',
	block = false,
	disabled = false,
	className = '',
	...rest
}) {
	ensureStyle();
	return (
		<div
			className={[
				'tw-select',
				size === 'sm' ? 'tw-select--sm' : '',
				block ? 'tw-select--block' : '',
				className
			]
				.filter(Boolean)
				.join(' ')}
		>
			<select
				value={value}
				disabled={disabled}
				onChange={e => onChange && onChange(e.target.value)}
				{...rest}
			>
				{options.map(opt => {
					const v = typeof opt === 'string' ? opt : opt.value;
					const lbl = typeof opt === 'string' ? opt : opt.label;
					return (
						<option key={v} value={v}>
							{lbl}
						</option>
					);
				})}
			</select>
			<span className="tw-select__chev">
				<i className="ti ti-chevron-down" aria-hidden="true" />
			</span>
		</div>
	);
}
