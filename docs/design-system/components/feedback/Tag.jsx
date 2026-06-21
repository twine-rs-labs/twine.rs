import React from 'react';

const CSS = `
.tw-tag { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px;
	font-family: var(--font-ui); font-size: var(--fs-xs); font-weight: var(--fw-medium);
	color: var(--tx-1); background: var(--ink-4); border: 1px solid var(--line-2);
	border-radius: var(--r-pill); white-space: nowrap; line-height: 1; }
.tw-tag__dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.tw-tag__hash { color: var(--tx-4); font-family: var(--font-mono); font-size: 10px; }
.tw-tag--button { cursor: pointer; transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out); }
.tw-tag--button:hover { background: var(--ink-5); border-color: var(--line-3); }
.tw-tag__x { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px;
	margin-right: -3px; border-radius: 50%; color: var(--tx-3); cursor: pointer; }
.tw-tag__x:hover { background: var(--ink-2); color: var(--tx-1); }
.tw-tag__x .ti { font-size: 12px; }
`;

const HUES = {
	red: 'var(--sem-error)',
	orange: 'var(--sem-dirty)',
	yellow: 'var(--sem-warn)',
	green: 'var(--sem-saved)',
	teal: 'var(--sem-generated)',
	cyan: 'var(--sem-var)',
	blue: 'var(--sem-link)',
	purple: 'var(--sem-tag)'
};

function ensureStyle() {
	if (typeof document === 'undefined') return;
	if (document.getElementById('tw-tag-css')) return;
	const el = document.createElement('style');
	el.id = 'tw-tag-css';
	el.textContent = CSS;
	document.head.appendChild(el);
}

/** Passage/story tag chip with a color dot and optional remove button. */
export function Tag({
	children,
	color = 'blue',
	onRemove,
	onClick,
	hash = true,
	className = '',
	...rest
}) {
	ensureStyle();
	const dot = HUES[color] || color;
	const interactive = !!onClick;
	return (
		<span
			className={['tw-tag', interactive ? 'tw-tag--button' : '', className]
				.filter(Boolean)
				.join(' ')}
			onClick={onClick}
			{...rest}
		>
			<span className="tw-tag__dot" style={{background: dot}} />
			{hash && <span className="tw-tag__hash">#</span>}
			{children}
			{onRemove && (
				<span
					className="tw-tag__x"
					role="button"
					aria-label="Remove tag"
					onClick={e => {
						e.stopPropagation();
						onRemove();
					}}
				>
					<i className="ti ti-x" aria-hidden="true" />
				</span>
			)}
		</span>
	);
}
