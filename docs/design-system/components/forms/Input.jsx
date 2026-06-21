import React from 'react';

const CSS = `
.tw-field { display: inline-flex; flex-direction: column; gap: 5px; min-width: 0; }
.tw-field--block { display: flex; width: 100%; }
.tw-field__label { font-family: var(--font-ui); font-size: var(--fs-xs); font-weight: var(--fw-medium);
	color: var(--tx-3); letter-spacing: var(--ls-snug); }
.tw-input {
	display: flex; align-items: center; gap: 7px; height: var(--ctl-h);
	padding: 0 10px; background: var(--ink-1); color: var(--tx-1);
	border: 1px solid var(--line-2); border-radius: var(--r-sm);
	box-shadow: inset 0 1px 2px oklch(0 0 0 / 0.25);
	transition: border-color var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out);
}
.tw-input:hover { border-color: var(--line-3); }
.tw-input:focus-within { border-color: var(--focus-ring); box-shadow: var(--glow-focus), inset 0 1px 2px oklch(0 0 0 / 0.25); }
.tw-input .ti { font-size: 16px; color: var(--tx-4); flex: none; }
.tw-input input {
	flex: 1; min-width: 0; background: none; border: none; outline: none; padding: 0;
	color: inherit; font-family: var(--font-ui); font-size: var(--fs-sm);
}
.tw-input input::placeholder { color: var(--tx-4); }
.tw-input--mono input { font-family: var(--font-mono); }
.tw-input--invalid { border-color: var(--sem-error); }
.tw-input--invalid:focus-within { border-color: var(--sem-error); box-shadow: 0 0 0 2px var(--sem-error-soft), inset 0 1px 2px oklch(0 0 0 / 0.25); }
.tw-input[aria-disabled="true"] { opacity: 0.5; pointer-events: none; }
.tw-input__kbd { font-family: var(--font-mono); font-size: 10px; color: var(--tx-4);
	border: 1px solid var(--line-2); border-radius: var(--r-xs); padding: 1px 5px; flex: none; }
`;

function ensureStyle() {
	if (typeof document === 'undefined') return;
	if (document.getElementById('tw-input-css')) return;
	const el = document.createElement('style');
	el.id = 'tw-input-css';
	el.textContent = CSS;
	document.head.appendChild(el);
}

/** Single-line text field with optional leading icon, label and trailing kbd hint. */
export function Input({
	label,
	icon,
	kbd,
	invalid = false,
	mono = false,
	block = false,
	disabled = false,
	id,
	className = '',
	...rest
}) {
	ensureStyle();
	const inputId = id || (label ? `tw-in-${Math.random().toString(36).slice(2, 8)}` : undefined);
	const box = (
		<div
			className={[
				'tw-input',
				invalid ? 'tw-input--invalid' : '',
				mono ? 'tw-input--mono' : '',
				className
			]
				.filter(Boolean)
				.join(' ')}
			aria-disabled={disabled || undefined}
		>
			{icon && <i className={`ti ti-${icon}`} aria-hidden="true" />}
			<input id={inputId} disabled={disabled} {...rest} />
			{kbd && <span className="tw-input__kbd">{kbd}</span>}
		</div>
	);
	if (!label) return block ? <div className="tw-field tw-field--block">{box}</div> : box;
	return (
		<label
			htmlFor={inputId}
			className={`tw-field${block ? ' tw-field--block' : ''}`}
		>
			<span className="tw-field__label">{label}</span>
			{box}
		</label>
	);
}
