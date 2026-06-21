import React from 'react';

const CSS = `
.tw-seg { display: inline-flex; align-items: center; gap: 2px; padding: 2px;
	background: var(--ink-1); border: 1px solid var(--line-1); border-radius: var(--r-md);
	box-shadow: inset 0 1px 2px oklch(0 0 0 / 0.25); }
.tw-seg__opt {
	display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 12px;
	font-family: var(--font-ui); font-size: var(--fs-sm); font-weight: var(--fw-medium);
	color: var(--tx-3); background: transparent; border: none; border-radius: var(--r-sm);
	cursor: pointer; white-space: nowrap; position: relative;
	transition: color var(--dur-1) var(--ease-out), background var(--dur-1) var(--ease-out);
}
.tw-seg__opt .ti { font-size: 16px; }
.tw-seg__opt:hover { color: var(--tx-1); }
.tw-seg__opt:focus-visible { outline: none; box-shadow: var(--glow-focus); }
.tw-seg__opt--on { color: var(--tx-1); background: var(--ink-4);
	box-shadow: var(--edge-hi), 0 1px 2px oklch(0 0 0 / 0.3); }
.tw-seg__opt--on::after { content: ""; position: absolute; left: 10px; right: 10px; bottom: 2px; height: 2px;
	border-radius: 2px; background: var(--acc-twine); }
.tw-seg--sm .tw-seg__opt { height: 22px; padding: 0 9px; font-size: var(--fs-xs); }
`;

function ensureStyle() {
	if (typeof document === 'undefined') return;
	if (document.getElementById('tw-seg-css')) return;
	const el = document.createElement('style');
	el.id = 'tw-seg-css';
	el.textContent = CSS;
	document.head.appendChild(el);
}

/**
 * Segmented control — the signature Text | Graph | Split mode switch.
 * The active segment carries the twine gradient underline.
 */
export function SegmentedControl({
	options,
	value,
	onChange,
	size = 'md',
	className = ''
}) {
	ensureStyle();
	return (
		<div
			className={['tw-seg', size === 'sm' ? 'tw-seg--sm' : '', className]
				.filter(Boolean)
				.join(' ')}
			role="tablist"
		>
			{options.map(opt => {
				const v = typeof opt === 'string' ? opt : opt.value;
				const lbl = typeof opt === 'string' ? opt : opt.label;
				const icon = typeof opt === 'string' ? undefined : opt.icon;
				const on = v === value;
				return (
					<button
						key={v}
						type="button"
						role="tab"
						aria-selected={on}
						className={`tw-seg__opt${on ? ' tw-seg__opt--on' : ''}`}
						onClick={() => onChange && onChange(v)}
					>
						{icon && <i className={`ti ti-${icon}`} aria-hidden="true" />}
						{lbl}
					</button>
				);
			})}
		</div>
	);
}
