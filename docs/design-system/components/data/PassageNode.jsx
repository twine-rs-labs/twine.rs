import React from 'react';

const CSS = `
.tw-node { position: relative; width: 184px; text-align: left; display: block;
	background: var(--ink-3); border: 1px solid var(--line-2); border-radius: var(--r-md);
	box-shadow: var(--shadow-card), var(--edge-hi); cursor: pointer; overflow: hidden;
	font-family: var(--font-ui); transition: border-color var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out); }
.tw-node:hover { border-color: var(--line-3); transform: translateY(-1px); box-shadow: var(--shadow-pop), var(--edge-hi); }
.tw-node--selected { border-color: var(--sel-line); box-shadow: 0 0 0 2px var(--sel-wash), var(--shadow-pop); }
.tw-node--start::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--acc-twine); }
.tw-node__bar { height: 3px; background: var(--accent, transparent); }
.tw-node__body { padding: 9px 11px 10px; }
.tw-node__head { display: flex; align-items: center; gap: 6px; }
.tw-node__title { font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--tx-1);
	white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
.tw-node__start { color: var(--acc-green); font-size: 13px; display: inline-flex; flex: none; }
.tw-node__excerpt { margin-top: 5px; font-size: 11px; line-height: 1.4; color: var(--tx-3);
	display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tw-node__tags { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
.tw-node__tag { height: 5px; width: 16px; border-radius: var(--r-pill); }
.tw-node__foot { display: flex; align-items: center; gap: 9px; margin-top: 9px;
	font-family: var(--font-mono); font-size: 9.5px; color: var(--tx-4); }
.tw-node__stat { display: inline-flex; align-items: center; gap: 3px; }
.tw-node__stat .ti { font-size: 12px; }
.tw-node__stat--broken { color: var(--sem-error); }
`;

function ensureStyle() {
	if (typeof document === 'undefined') return;
	if (document.getElementById('tw-node-css')) return;
	const el = document.createElement('style');
	el.id = 'tw-node-css';
	el.textContent = CSS;
	document.head.appendChild(el);
}

const HUES = {
	red: 'var(--sem-error)', orange: 'var(--sem-dirty)', yellow: 'var(--sem-warn)',
	green: 'var(--sem-saved)', teal: 'var(--sem-generated)', cyan: 'var(--sem-var)',
	blue: 'var(--sem-link)', purple: 'var(--sem-tag)'
};

/** Graph-mode passage card: title, tags, excerpt and link/broken-link badges. */
export function PassageNode({
	title,
	excerpt,
	tags = [],
	links = 0,
	broken = 0,
	start = false,
	selected = false,
	accent,
	className = '',
	...rest
}) {
	ensureStyle();
	return (
		<div
			className={[
				'tw-node',
				selected ? 'tw-node--selected' : '',
				start ? 'tw-node--start' : '',
				className
			]
				.filter(Boolean)
				.join(' ')}
			{...rest}
		>
			{accent && <div className="tw-node__bar" style={{background: HUES[accent] || accent}} />}
			<div className="tw-node__body">
				<div className="tw-node__head">
					<span className="tw-node__title">{title}</span>
					{start && (
						<span className="tw-node__start" title="Start passage">
							<i className="ti ti-rocket" aria-hidden="true" />
						</span>
					)}
				</div>
				{excerpt && <div className="tw-node__excerpt">{excerpt}</div>}
				{tags.length > 0 && (
					<div className="tw-node__tags">
						{tags.map((t, i) => (
							<span
								key={i}
								className="tw-node__tag"
								style={{background: HUES[t] || t}}
							/>
						))}
					</div>
				)}
				<div className="tw-node__foot">
					<span className="tw-node__stat">
						<i className="ti ti-arrow-up-right" aria-hidden="true" />
						{links}
					</span>
					{broken > 0 && (
						<span className="tw-node__stat tw-node__stat--broken">
							<i className="ti ti-unlink" aria-hidden="true" />
							{broken}
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
