import React from 'react';

const CSS = `
.tw-badge { display: inline-flex; align-items: center; gap: 4px; height: 18px; padding: 0 7px;
	font-family: var(--font-ui); font-size: var(--fs-micro); font-weight: var(--fw-semibold);
	letter-spacing: 0.01em; border-radius: var(--r-xs); white-space: nowrap;
	border: 1px solid transparent; line-height: 1; }
.tw-badge .ti { font-size: 12px; }
.tw-badge__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.tw-badge--mono { font-family: var(--font-mono); font-size: 9.5px; }
/* solid */
.tw-badge--solid { color: var(--tx-on-accent); }
/* tones (soft) */
.tw-badge--neutral { background: var(--ink-4); color: var(--tx-2); border-color: var(--line-2); }
.tw-badge--link { background: var(--sem-link-soft); color: var(--sem-link); border-color: color-mix(in oklab, var(--sem-link) 35%, transparent); }
.tw-badge--tag { background: var(--sem-tag-soft); color: var(--sem-tag); border-color: color-mix(in oklab, var(--sem-tag) 35%, transparent); }
.tw-badge--var { background: var(--sem-var-soft); color: var(--sem-var); border-color: color-mix(in oklab, var(--sem-var) 35%, transparent); }
.tw-badge--warn { background: var(--sem-warn-soft); color: var(--sem-warn); border-color: color-mix(in oklab, var(--sem-warn) 35%, transparent); }
.tw-badge--error { background: var(--sem-error-soft); color: var(--sem-error); border-color: color-mix(in oklab, var(--sem-error) 40%, transparent); }
.tw-badge--dirty { background: var(--sem-dirty-soft); color: var(--sem-dirty); border-color: color-mix(in oklab, var(--sem-dirty) 35%, transparent); }
.tw-badge--saved { background: var(--sem-saved-soft); color: var(--sem-saved); border-color: color-mix(in oklab, var(--sem-saved) 35%, transparent); }
.tw-badge--generated { background: var(--sem-generated-soft); color: var(--sem-generated); border-color: color-mix(in oklab, var(--sem-generated) 35%, transparent); }
.tw-badge--build { background: var(--sem-build-soft); color: var(--sem-build); border-color: color-mix(in oklab, var(--sem-build) 35%, transparent); }
`;

function ensureStyle() {
	if (typeof document === 'undefined') return;
	if (document.getElementById('tw-badge-css')) return;
	const el = document.createElement('style');
	el.id = 'tw-badge-css';
	el.textContent = CSS;
	document.head.appendChild(el);
}

/** Small status/count pill. Each authoring concept gets its own tone. */
export function Badge({
	children,
	tone = 'neutral',
	icon,
	dot = false,
	mono = false,
	className = '',
	...rest
}) {
	ensureStyle();
	return (
		<span
			className={['tw-badge', `tw-badge--${tone}`, mono ? 'tw-badge--mono' : '', className]
				.filter(Boolean)
				.join(' ')}
			{...rest}
		>
			{dot && <span className="tw-badge__dot" />}
			{icon && <i className={`ti ti-${icon}`} aria-hidden="true" />}
			{children}
		</span>
	);
}
