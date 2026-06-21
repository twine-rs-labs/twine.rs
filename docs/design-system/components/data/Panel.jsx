import React from 'react';

const CSS = `
.tw-panel { display: flex; flex-direction: column; min-height: 0; background: var(--ink-2);
	border: 1px solid var(--line-1); border-radius: var(--r-lg); overflow: hidden; }
.tw-panel--flush { border-radius: 0; border: 0; }
.tw-panel__head { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px 0 12px;
	border-bottom: 1px solid var(--line-1); background: var(--ink-2); flex: none; }
.tw-panel__title { font-family: var(--font-ui); font-size: var(--fs-xs); font-weight: var(--fw-semibold);
	letter-spacing: var(--ls-caps); text-transform: uppercase; color: var(--tx-3); }
.tw-panel__icon { color: var(--tx-3); font-size: 16px; display: inline-flex; }
.tw-panel__count { font-family: var(--font-mono); font-size: 10px; color: var(--tx-4); }
.tw-panel__actions { margin-left: auto; display: flex; align-items: center; gap: 2px; }
.tw-panel__body { flex: 1; min-height: 0; overflow: auto; }
.tw-panel__body--pad { padding: 12px; }
`;

function ensureStyle() {
	if (typeof document === 'undefined') return;
	if (document.getElementById('tw-panel-css')) return;
	const el = document.createElement('style');
	el.id = 'tw-panel-css';
	el.textContent = CSS;
	document.head.appendChild(el);
}

/** Dock/inspector panel: an uppercase titled header + scrolling body. */
export function Panel({
	title,
	icon,
	count,
	actions,
	children,
	pad = false,
	flush = false,
	className = '',
	bodyClassName = '',
	...rest
}) {
	ensureStyle();
	return (
		<section
			className={['tw-panel', flush ? 'tw-panel--flush' : '', className]
				.filter(Boolean)
				.join(' ')}
			{...rest}
		>
			{(title || actions) && (
				<header className="tw-panel__head">
					{icon && (
						<span className="tw-panel__icon">
							<i className={`ti ti-${icon}`} aria-hidden="true" />
						</span>
					)}
					{title && <span className="tw-panel__title">{title}</span>}
					{count != null && <span className="tw-panel__count">{count}</span>}
					{actions && <span className="tw-panel__actions">{actions}</span>}
				</header>
			)}
			<div
				className={[
					'tw-panel__body',
					pad ? 'tw-panel__body--pad' : '',
					bodyClassName
				]
					.filter(Boolean)
					.join(' ')}
			>
				{children}
			</div>
		</section>
	);
}
