import React from 'react';

const CSS = `
.tw-iconbtn {
	display: inline-flex; align-items: center; justify-content: center;
	width: var(--ctl-h); height: var(--ctl-h); padding: 0;
	color: var(--tx-3); background: transparent;
	border: 1px solid transparent; border-radius: var(--r-sm);
	cursor: pointer; position: relative;
	transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out),
		border-color var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out);
}
.tw-iconbtn .ti { font-size: 19px; }
.tw-iconbtn:hover { background: var(--ink-4); color: var(--tx-1); }
.tw-iconbtn:active { background: var(--ink-3); }
.tw-iconbtn:focus-visible { outline: none; box-shadow: var(--glow-focus); }
.tw-iconbtn[disabled] { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
.tw-iconbtn--sm { width: var(--ctl-h-sm); height: var(--ctl-h-sm); }
.tw-iconbtn--sm .ti { font-size: 16px; }
.tw-iconbtn--active { background: var(--acc-blue-soft); color: var(--acc-blue); }
.tw-iconbtn--active:hover { background: var(--acc-blue-soft); color: var(--acc-blue-hi); }
.tw-iconbtn--solid { background: var(--ink-4); border-color: var(--line-2); color: var(--tx-2); box-shadow: var(--edge-hi); }
.tw-iconbtn--solid:hover { background: var(--ink-5); color: var(--tx-1); }
`;

function ensureStyle() {
	if (typeof document === 'undefined') return;
	if (document.getElementById('tw-iconbtn-css')) return;
	const el = document.createElement('style');
	el.id = 'tw-iconbtn-css';
	el.textContent = CSS;
	document.head.appendChild(el);
}

/**
 * Square icon-only button for repeated toolbar tools (always pair with a
 * tooltip). Use sparingly — decisive commands should be text-labelled.
 */
export function IconButton({
	icon,
	label,
	active = false,
	solid = false,
	size = 'md',
	disabled = false,
	className = '',
	...rest
}) {
	ensureStyle();
	const cls = [
		'tw-iconbtn',
		active ? 'tw-iconbtn--active' : '',
		solid ? 'tw-iconbtn--solid' : '',
		size === 'sm' ? 'tw-iconbtn--sm' : '',
		className
	]
		.filter(Boolean)
		.join(' ');
	return (
		<button
			className={cls}
			disabled={disabled}
			aria-label={label}
			title={label}
			aria-pressed={active || undefined}
			{...rest}
		>
			<i className={`ti ti-${icon}`} aria-hidden="true" />
		</button>
	);
}
