import React from 'react';

/* Inject this component's CSS once per document. */
const CSS = `
.tw-btn {
	--_h: var(--ctl-h);
	display: inline-flex; align-items: center; justify-content: center;
	gap: 7px; height: var(--_h); padding: 0 var(--ctl-pad-x);
	font-family: var(--font-ui); font-size: var(--fs-sm); font-weight: var(--fw-medium);
	line-height: 1; letter-spacing: var(--ls-snug); white-space: nowrap;
	border: 1px solid transparent; border-radius: var(--r-sm);
	cursor: pointer; user-select: none; position: relative;
	transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out),
		color var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.tw-btn:focus-visible { outline: none; box-shadow: var(--glow-focus); }
.tw-btn:active { transform: translateY(0.5px); }
.tw-btn[disabled] { opacity: 0.45; cursor: not-allowed; pointer-events: none; }
.tw-btn--sm { --_h: var(--ctl-h-sm); font-size: var(--fs-xs); padding: 0 var(--ctl-pad-x-sm); gap: 5px; }
.tw-btn--lg { --_h: var(--ctl-h-lg); font-size: var(--fs-md); padding: 0 18px; }
.tw-btn--block { display: flex; width: 100%; }
.tw-btn .ti { font-size: 1.25em; }

/* primary — accent fill */
.tw-btn--primary { background: var(--acc-blue); color: var(--tx-on-accent); box-shadow: var(--edge-hi); }
.tw-btn--primary:hover { background: var(--acc-blue-hi); }
.tw-btn--primary:active { background: var(--acc-blue-lo); color: var(--tx-1); }

/* default — raised surface */
.tw-btn--default { background: var(--ink-4); color: var(--tx-1); border-color: var(--line-2); box-shadow: var(--edge-hi); }
.tw-btn--default:hover { background: var(--ink-5); border-color: var(--line-3); }
.tw-btn--default:active { background: var(--ink-3); }

/* ghost — transparent */
.tw-btn--ghost { background: transparent; color: var(--tx-2); }
.tw-btn--ghost:hover { background: var(--ink-4); color: var(--tx-1); }
.tw-btn--ghost:active { background: var(--ink-3); }

/* danger */
.tw-btn--danger { background: transparent; color: var(--sem-error); border-color: var(--sem-error-soft); }
.tw-btn--danger:hover { background: var(--sem-error-soft); border-color: var(--sem-error); }

.tw-btn__spin { width: 13px; height: 13px; border-radius: 50%;
	border: 2px solid currentColor; border-right-color: transparent; opacity: 0.85;
	animation: tw-btn-spin 0.6s linear infinite; }
@keyframes tw-btn-spin { to { transform: rotate(360deg); } }
`;

function ensureStyle() {
	if (typeof document === 'undefined') return;
	if (document.getElementById('tw-btn-css')) return;
	const el = document.createElement('style');
	el.id = 'tw-btn-css';
	el.textContent = CSS;
	document.head.appendChild(el);
}

/**
 * Primary action button for twine.rs. Text-labelled by default
 * (the design system uses icon-only buttons sparingly — see IconButton).
 */
export function Button({
	children,
	variant = 'default',
	size = 'md',
	icon,
	iconRight,
	loading = false,
	block = false,
	disabled = false,
	className = '',
	...rest
}) {
	ensureStyle();
	const cls = [
		'tw-btn',
		`tw-btn--${variant}`,
		size !== 'md' ? `tw-btn--${size}` : '',
		block ? 'tw-btn--block' : '',
		className
	]
		.filter(Boolean)
		.join(' ');
	return (
		<button className={cls} disabled={disabled || loading} {...rest}>
			{loading ? (
				<span className="tw-btn__spin" aria-hidden="true" />
			) : (
				icon && <i className={`ti ti-${icon}`} aria-hidden="true" />
			)}
			{children && <span>{children}</span>}
			{iconRight && !loading && (
				<i className={`ti ti-${iconRight}`} aria-hidden="true" />
			)}
		</button>
	);
}
