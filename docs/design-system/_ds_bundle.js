/* @ds-bundle: {"format":3,"namespace":"TwineRsDesignSystem_073217","components":[{"name":"Panel","sourcePath":"components/data/Panel.jsx"},{"name":"PassageNode","sourcePath":"components/data/PassageNode.jsx"},{"name":"Badge","sourcePath":"components/feedback/Badge.jsx"},{"name":"Tag","sourcePath":"components/feedback/Tag.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"IconButton","sourcePath":"components/forms/IconButton.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"SegmentedControl","sourcePath":"components/forms/SegmentedControl.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"}],"sourceHashes":{"components/data/Panel.jsx":"0312d431005a","components/data/PassageNode.jsx":"d339e2d369b0","components/feedback/Badge.jsx":"24eeae77197d","components/feedback/Tag.jsx":"3c1c24ff719e","components/forms/Button.jsx":"2bae4be06a84","components/forms/Checkbox.jsx":"b30cb0f32206","components/forms/IconButton.jsx":"2b68ca397ea4","components/forms/Input.jsx":"cdff6d8736dc","components/forms/SegmentedControl.jsx":"ebcea00d19cc","components/forms/Select.jsx":"94546e1f0d2f","components/forms/Switch.jsx":"44164cbc23ed","ui_kits/nav.js":"d6f29d0eb2ed","ui_kits/workbench/CommandPalette.jsx":"9ad8980944b1","ui_kits/workbench/GraphMode.jsx":"7c1813d86f7d","ui_kits/workbench/TextMode.jsx":"7d8c07accd85","ui_kits/workbench/data.js":"fecd556e8e3a"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.TwineRsDesignSystem_073217 = window.TwineRsDesignSystem_073217 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/data/Panel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Panel({
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
  return /*#__PURE__*/React.createElement("section", _extends({
    className: ['tw-panel', flush ? 'tw-panel--flush' : '', className].filter(Boolean).join(' ')
  }, rest), (title || actions) && /*#__PURE__*/React.createElement("header", {
    className: "tw-panel__head"
  }, icon && /*#__PURE__*/React.createElement("span", {
    className: "tw-panel__icon"
  }, /*#__PURE__*/React.createElement("i", {
    className: `ti ti-${icon}`,
    "aria-hidden": "true"
  })), title && /*#__PURE__*/React.createElement("span", {
    className: "tw-panel__title"
  }, title), count != null && /*#__PURE__*/React.createElement("span", {
    className: "tw-panel__count"
  }, count), actions && /*#__PURE__*/React.createElement("span", {
    className: "tw-panel__actions"
  }, actions)), /*#__PURE__*/React.createElement("div", {
    className: ['tw-panel__body', pad ? 'tw-panel__body--pad' : '', bodyClassName].filter(Boolean).join(' ')
  }, children));
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Panel.jsx", error: String((e && e.message) || e) }); }

// components/data/PassageNode.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
  red: 'var(--sem-error)',
  orange: 'var(--sem-dirty)',
  yellow: 'var(--sem-warn)',
  green: 'var(--sem-saved)',
  teal: 'var(--sem-generated)',
  cyan: 'var(--sem-var)',
  blue: 'var(--sem-link)',
  purple: 'var(--sem-tag)'
};

/** Graph-mode passage card: title, tags, excerpt and link/broken-link badges. */
function PassageNode({
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
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ['tw-node', selected ? 'tw-node--selected' : '', start ? 'tw-node--start' : '', className].filter(Boolean).join(' ')
  }, rest), accent && /*#__PURE__*/React.createElement("div", {
    className: "tw-node__bar",
    style: {
      background: HUES[accent] || accent
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "tw-node__body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tw-node__head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tw-node__title"
  }, title), start && /*#__PURE__*/React.createElement("span", {
    className: "tw-node__start",
    title: "Start passage"
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-rocket",
    "aria-hidden": "true"
  }))), excerpt && /*#__PURE__*/React.createElement("div", {
    className: "tw-node__excerpt"
  }, excerpt), tags.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "tw-node__tags"
  }, tags.map((t, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: "tw-node__tag",
    style: {
      background: HUES[t] || t
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "tw-node__foot"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tw-node__stat"
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-arrow-up-right",
    "aria-hidden": "true"
  }), links), broken > 0 && /*#__PURE__*/React.createElement("span", {
    className: "tw-node__stat tw-node__stat--broken"
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-unlink",
    "aria-hidden": "true"
  }), broken))));
}
Object.assign(__ds_scope, { PassageNode });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/PassageNode.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Badge({
  children,
  tone = 'neutral',
  icon,
  dot = false,
  mono = false,
  className = '',
  ...rest
}) {
  ensureStyle();
  return /*#__PURE__*/React.createElement("span", _extends({
    className: ['tw-badge', `tw-badge--${tone}`, mono ? 'tw-badge--mono' : '', className].filter(Boolean).join(' ')
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    className: "tw-badge__dot"
  }), icon && /*#__PURE__*/React.createElement("i", {
    className: `ti ti-${icon}`,
    "aria-hidden": "true"
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Badge.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Tag({
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
  return /*#__PURE__*/React.createElement("span", _extends({
    className: ['tw-tag', interactive ? 'tw-tag--button' : '', className].filter(Boolean).join(' '),
    onClick: onClick
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: "tw-tag__dot",
    style: {
      background: dot
    }
  }), hash && /*#__PURE__*/React.createElement("span", {
    className: "tw-tag__hash"
  }, "#"), children, onRemove && /*#__PURE__*/React.createElement("span", {
    className: "tw-tag__x",
    role: "button",
    "aria-label": "Remove tag",
    onClick: e => {
      e.stopPropagation();
      onRemove();
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-x",
    "aria-hidden": "true"
  })));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tag.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Button({
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
  const cls = ['tw-btn', `tw-btn--${variant}`, size !== 'md' ? `tw-btn--${size}` : '', block ? 'tw-btn--block' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("button", _extends({
    className: cls,
    disabled: disabled || loading
  }, rest), loading ? /*#__PURE__*/React.createElement("span", {
    className: "tw-btn__spin",
    "aria-hidden": "true"
  }) : icon && /*#__PURE__*/React.createElement("i", {
    className: `ti ti-${icon}`,
    "aria-hidden": "true"
  }), children && /*#__PURE__*/React.createElement("span", null, children), iconRight && !loading && /*#__PURE__*/React.createElement("i", {
    className: `ti ti-${iconRight}`,
    "aria-hidden": "true"
  }));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.tw-check { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;
	font-family: var(--font-ui); font-size: var(--fs-sm); color: var(--tx-2); }
.tw-check input { position: absolute; opacity: 0; width: 0; height: 0; }
.tw-check__box { width: 16px; height: 16px; flex: none; border-radius: var(--r-xs);
	background: var(--ink-1); border: 1px solid var(--line-2); box-shadow: inset 0 1px 2px oklch(0 0 0 / 0.3);
	display: inline-flex; align-items: center; justify-content: center; color: transparent;
	transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out); }
.tw-check__box .ti { font-size: 13px; }
.tw-check:hover .tw-check__box { border-color: var(--line-3); }
.tw-check input:checked + .tw-check__box { background: var(--acc-blue); border-color: var(--acc-blue); color: var(--tx-on-accent); }
.tw-check input:indeterminate + .tw-check__box { background: var(--acc-blue); border-color: var(--acc-blue); color: var(--tx-on-accent); }
.tw-check input:focus-visible + .tw-check__box { box-shadow: var(--glow-focus); }
.tw-check--disabled { opacity: 0.45; cursor: not-allowed; }
`;
function ensureStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('tw-check-css')) return;
  const el = document.createElement('style');
  el.id = 'tw-check-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}

/** Checkbox with checked + indeterminate states (e.g. "Match Case", bulk select). */
function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled = false,
  className = '',
  ...rest
}) {
  ensureStyle();
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return /*#__PURE__*/React.createElement("label", {
    className: ['tw-check', disabled ? 'tw-check--disabled' : '', className].filter(Boolean).join(' ')
  }, /*#__PURE__*/React.createElement("input", _extends({
    ref: ref,
    type: "checkbox",
    checked: checked,
    disabled: disabled,
    onChange: e => onChange && onChange(e.target.checked)
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "tw-check__box"
  }, /*#__PURE__*/React.createElement("i", {
    className: `ti ti-${indeterminate ? 'minus' : 'check'}`,
    "aria-hidden": "true"
  })), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function IconButton({
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
  const cls = ['tw-iconbtn', active ? 'tw-iconbtn--active' : '', solid ? 'tw-iconbtn--solid' : '', size === 'sm' ? 'tw-iconbtn--sm' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("button", _extends({
    className: cls,
    disabled: disabled,
    "aria-label": label,
    title: label,
    "aria-pressed": active || undefined
  }, rest), /*#__PURE__*/React.createElement("i", {
    className: `ti ti-${icon}`,
    "aria-hidden": "true"
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Input({
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
  const box = /*#__PURE__*/React.createElement("div", {
    className: ['tw-input', invalid ? 'tw-input--invalid' : '', mono ? 'tw-input--mono' : '', className].filter(Boolean).join(' '),
    "aria-disabled": disabled || undefined
  }, icon && /*#__PURE__*/React.createElement("i", {
    className: `ti ti-${icon}`,
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    disabled: disabled
  }, rest)), kbd && /*#__PURE__*/React.createElement("span", {
    className: "tw-input__kbd"
  }, kbd));
  if (!label) return block ? /*#__PURE__*/React.createElement("div", {
    className: "tw-field tw-field--block"
  }, box) : box;
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    className: `tw-field${block ? ' tw-field--block' : ''}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "tw-field__label"
  }, label), box);
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/SegmentedControl.jsx
try { (() => {
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
function SegmentedControl({
  options,
  value,
  onChange,
  size = 'md',
  className = ''
}) {
  ensureStyle();
  return /*#__PURE__*/React.createElement("div", {
    className: ['tw-seg', size === 'sm' ? 'tw-seg--sm' : '', className].filter(Boolean).join(' '),
    role: "tablist"
  }, options.map(opt => {
    const v = typeof opt === 'string' ? opt : opt.value;
    const lbl = typeof opt === 'string' ? opt : opt.label;
    const icon = typeof opt === 'string' ? undefined : opt.icon;
    const on = v === value;
    return /*#__PURE__*/React.createElement("button", {
      key: v,
      type: "button",
      role: "tab",
      "aria-selected": on,
      className: `tw-seg__opt${on ? ' tw-seg__opt--on' : ''}`,
      onClick: () => onChange && onChange(v)
    }, icon && /*#__PURE__*/React.createElement("i", {
      className: `ti ti-${icon}`,
      "aria-hidden": "true"
    }), lbl);
  }));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Select({
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
  return /*#__PURE__*/React.createElement("div", {
    className: ['tw-select', size === 'sm' ? 'tw-select--sm' : '', block ? 'tw-select--block' : '', className].filter(Boolean).join(' ')
  }, /*#__PURE__*/React.createElement("select", _extends({
    value: value,
    disabled: disabled,
    onChange: e => onChange && onChange(e.target.value)
  }, rest), options.map(opt => {
    const v = typeof opt === 'string' ? opt : opt.value;
    const lbl = typeof opt === 'string' ? opt : opt.label;
    return /*#__PURE__*/React.createElement("option", {
      key: v,
      value: v
    }, lbl);
  })), /*#__PURE__*/React.createElement("span", {
    className: "tw-select__chev"
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-chevron-down",
    "aria-hidden": "true"
  })));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  className = '',
  ...rest
}) {
  ensureStyle();
  return /*#__PURE__*/React.createElement("label", {
    className: ['tw-switch', disabled ? 'tw-switch--disabled' : '', className].filter(Boolean).join(' ')
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: checked,
    disabled: disabled,
    onChange: e => onChange && onChange(e.target.checked)
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "tw-switch__track"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tw-switch__thumb"
  })), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// ui_kits/nav.js
try { (() => {
/* Shared cross-screen activity rail for all twine.rs UI-kit screens.
   Plain JS (uses React.createElement) → define window.TwineRail before
   any babel script reads it. Inject its own CSS once. */
(function () {
  const CSS = `
.kit { position: absolute; inset: 0; display: flex; font-family: var(--font-ui); color: var(--text-body); background: var(--bg-app); }
.kit__main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.twr { width: 52px; flex: none; background: var(--ink-0); border-right: 1px solid var(--line-1);
	display: flex; flex-direction: column; align-items: center; padding: 10px 0 12px; gap: 4px; }
.twr__brand { width: 30px; height: 30px; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; }
.twr__brand img { width: 24px; height: 24px; }
.twr__item { position: relative; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;
	color: var(--tx-3); border-radius: var(--r-md); cursor: pointer; text-decoration: none;
	transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out); }
.twr__item .ti { font-size: 20px; }
.twr__item:hover { background: var(--ink-3); color: var(--tx-1); }
.twr__item.is-on { background: var(--acc-blue-soft); color: var(--acc-blue); }
.twr__item.is-on::before { content: ""; position: absolute; left: -10px; top: 9px; bottom: 9px; width: 3px;
	border-radius: 3px; background: var(--acc-twine); }
.twr__badge { position: absolute; top: 4px; right: 4px; min-width: 14px; height: 14px; padding: 0 3px;
	display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 8.5px;
	font-weight: 600; color: var(--tx-on-accent); background: var(--sem-error); border-radius: var(--r-pill);
	border: 1.5px solid var(--ink-0); }
.twr__sp { flex: 1; }
`;
  function ensure() {
    if (document.getElementById('twr-css')) return;
    const s = document.createElement('style');
    s.id = 'twr-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  const ITEMS = [{
    id: 'projects',
    icon: 'stack-2',
    label: 'Projects',
    href: '../launcher/index.html'
  }, {
    id: 'workbench',
    icon: 'layout-columns',
    label: 'Workbench',
    href: '../workbench/index.html'
  }, {
    id: 'contents',
    icon: 'list-tree',
    label: 'Contents',
    href: '../contents/index.html'
  }, {
    id: 'diagnostics',
    icon: 'alert-triangle',
    label: 'Diagnostics',
    href: '../diagnostics/index.html',
    badge: 37
  }, {
    id: 'assets',
    icon: 'photo',
    label: 'Assets',
    href: '../assets/index.html'
  }, {
    id: 'formats',
    icon: 'puzzle',
    label: 'Story Formats',
    href: '../formats/index.html'
  }, {
    id: 'build',
    icon: 'package-export',
    label: 'Build & Export',
    href: '../build/index.html'
  }, {
    id: 'play',
    icon: 'player-play',
    label: 'Play & Test',
    href: '../play/index.html'
  }];
  const BOTTOM = [{
    id: 'new',
    icon: 'square-rounded-plus',
    label: 'New Project',
    href: '../new-project/index.html'
  }, {
    id: 'settings',
    icon: 'settings',
    label: 'Settings',
    href: '../settings/index.html'
  }];
  function Item(it, active) {
    return React.createElement('a', {
      key: it.id,
      href: it.href,
      className: 'twr__item' + (active === it.id ? ' is-on' : ''),
      title: it.label,
      'aria-label': it.label
    }, React.createElement('i', {
      className: 'ti ti-' + it.icon,
      'aria-hidden': 'true'
    }), it.badge ? React.createElement('span', {
      className: 'twr__badge'
    }, it.badge) : null);
  }
  window.TwineRail = function TwineRail(props) {
    ensure();
    const active = props && props.active;
    return React.createElement('nav', {
      className: 'twr'
    }, React.createElement('a', {
      className: 'twr__brand',
      href: '../launcher/index.html',
      title: 'twine.rs'
    }, React.createElement('img', {
      src: '../../assets/twine-mark.svg',
      alt: 'twine.rs'
    })), ITEMS.map(it => Item(it, active)), React.createElement('div', {
      className: 'twr__sp'
    }), BOTTOM.map(it => Item(it, active)));
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/nav.js", error: String((e && e.message) || e) }); }

// ui_kits/workbench/CommandPalette.jsx
try { (() => {
/* Command palette overlay. Exports window.CommandPalette. */
function CommandPalette({
  onClose
}) {
  const groups = [{
    label: 'Commands',
    items: [{
      icon: 'layout-columns',
      label: 'Switch to Split Mode',
      kbd: '⌘3'
    }, {
      icon: 'binary-tree',
      label: 'Generate Graph Layout',
      kbd: ''
    }, {
      icon: 'package-export',
      label: 'Export HTML…',
      kbd: '⌘E'
    }, {
      icon: 'refresh',
      label: 'Rebuild Indexes',
      kbd: ''
    }]
  }, {
    label: 'Passages',
    items: [{
      icon: 'file-text',
      label: 'The Keeper\u2019s Door',
      sub: 'passages/lighthouse',
      kbd: ''
    }, {
      icon: 'file-text',
      label: 'Marian\u2019s Letters',
      sub: 'passages/lighthouse',
      kbd: ''
    }]
  }, {
    label: 'Diagnostics',
    items: [{
      icon: 'unlink',
      label: 'Tide Pools → broken link',
      sub: '1 error',
      tone: 'error',
      kbd: ''
    }]
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "cp__scrim",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "cp",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "cp__input"
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-search"
  }), /*#__PURE__*/React.createElement("input", {
    autoFocus: true,
    placeholder: "Type a command, passage, file, tag, variable, asset, or setting",
    defaultValue: ""
  }), /*#__PURE__*/React.createElement("span", {
    className: "cp__esc"
  }, "ESC")), /*#__PURE__*/React.createElement("div", {
    className: "cp__results"
  }, groups.map(g => /*#__PURE__*/React.createElement("div", {
    key: g.label,
    className: "cp__group"
  }, /*#__PURE__*/React.createElement("div", {
    className: "cp__group-label"
  }, g.label), g.items.map((it, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: 'cp__row' + (g.label === 'Commands' && i === 0 ? ' is-active' : '')
  }, /*#__PURE__*/React.createElement("i", {
    className: 'ti ti-' + it.icon + ' cp__ic',
    style: {
      color: it.tone === 'error' ? 'var(--sem-error)' : undefined
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "cp__label"
  }, it.label), it.sub && /*#__PURE__*/React.createElement("span", {
    className: "cp__sub"
  }, it.sub), it.kbd && /*#__PURE__*/React.createElement("span", {
    className: "cp__kbd"
  }, it.kbd)))))), /*#__PURE__*/React.createElement("div", {
    className: "cp__foot"
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "\u2191\u2193"), " navigate"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "\u21B5"), " run"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "\u2318P"), " files"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "\u2318\u21E7O"), " symbols"))));
}
window.CommandPalette = CommandPalette;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/workbench/CommandPalette.jsx", error: String((e && e.message) || e) }); }

// ui_kits/workbench/GraphMode.jsx
try { (() => {
/* Graph mode — native story-graph canvas. Exports window.GraphMode. */
const NS = window.TwineRsDesignSystem_073217;
function GraphMode({
  selected,
  setSelected
}) {
  const {
    PassageNode,
    IconButton,
    Badge,
    SegmentedControl
  } = NS;
  const {
    passages,
    edges,
    stats,
    TAGS
  } = window.TWINE_DATA;
  const [density, setDensity] = React.useState('excerpt');
  const [zoom, setZoom] = React.useState(82);
  const byId = React.useMemo(() => Object.fromEntries(passages.map(p => [p.id, p])), [passages]);
  const NODE_W = 184;
  // estimated node height by density for edge anchoring
  const nh = density === 'structure' ? 30 : density === 'names' ? 42 : 118;
  function edgePath(a, b) {
    const x1 = a.x + NODE_W,
      y1 = a.y + nh / 2;
    const x2 = b.x,
      y2 = b.y + nh / 2;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }
  const tagColor = t => `var(--sem-${{
    blue: 'link',
    teal: 'generated',
    yellow: 'warn',
    purple: 'tag',
    cyan: 'var',
    green: 'saved',
    orange: 'dirty',
    red: 'error'
  }[TAGS[t]] || 'link'})`;
  return /*#__PURE__*/React.createElement("div", {
    className: "gm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "gm__canvas"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "gm__edges",
    width: "1320",
    height: "520"
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("marker", {
    id: "ah",
    markerWidth: "7",
    markerHeight: "7",
    refX: "5.5",
    refY: "3",
    orient: "auto"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M0,0 L6,3 L0,6 Z",
    fill: "var(--line-3)"
  })), /*#__PURE__*/React.createElement("marker", {
    id: "ah-broken",
    markerWidth: "7",
    markerHeight: "7",
    refX: "5.5",
    refY: "3",
    orient: "auto"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M0,0 L6,3 L0,6 Z",
    fill: "var(--sem-error)"
  }))), edges.map(([a, b], i) => {
    const pa = byId[a],
      pb = byId[b];
    const broken = pb && pb.broken > 0 && pb.id === 3;
    const active = selected && (a === selected || b === selected);
    return /*#__PURE__*/React.createElement("path", {
      key: i,
      d: edgePath(pa, pb),
      fill: "none",
      stroke: broken ? 'var(--sem-error)' : active ? 'var(--sel-line)' : 'var(--line-2)',
      strokeWidth: active ? 2 : 1.5,
      strokeDasharray: broken ? '5 4' : 'none',
      markerEnd: broken ? 'url(#ah-broken)' : 'url(#ah)',
      opacity: active ? 1 : 0.7
    });
  })), /*#__PURE__*/React.createElement("div", {
    className: "gm__nodes"
  }, passages.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    className: "gm__node",
    style: {
      left: p.x,
      top: p.y
    }
  }, /*#__PURE__*/React.createElement(PassageNode, {
    title: p.name,
    start: p.start,
    excerpt: density === 'excerpt' ? p.excerpt : undefined,
    tags: density === 'structure' ? [] : p.tags.map(tagColor),
    links: p.links,
    broken: p.broken,
    selected: selected === p.id,
    onClick: () => setSelected(p.id)
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "gm__toolbar"
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: "pointer",
    label: "Select",
    active: true,
    solid: true
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "hand-stop",
    label: "Pan",
    solid: true
  }), /*#__PURE__*/React.createElement("div", {
    className: "gm__tbsep"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "plus",
    label: "New Passage",
    solid: true
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "arrows-join",
    label: "Connect",
    solid: true
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "folder",
    label: "Group",
    solid: true
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "message-2",
    label: "Annotate",
    solid: true
  }), /*#__PURE__*/React.createElement("div", {
    className: "gm__tbsep"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "layout-align-left",
    label: "Align",
    solid: true
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "layout-distribute-horizontal",
    label: "Distribute",
    solid: true
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "grid-dots",
    label: "Snap to grid",
    active: true,
    solid: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "gm__layers"
  }, /*#__PURE__*/React.createElement("span", {
    className: "gm__layers-l"
  }, "Layers"), [['link', 'Links', true], ['unlink', 'Broken', true], ['arrow-back-up', 'Backlinks', false], ['variable', 'Variables', false], ['tag', 'Tags', true], ['alert-triangle', 'Diagnostics', true]].map(([ic, lb, on]) => /*#__PURE__*/React.createElement("button", {
    key: lb,
    className: 'gm__layer' + (on ? ' is-on' : '')
  }, /*#__PURE__*/React.createElement("i", {
    className: 'ti ti-' + ic
  }), " ", lb))), /*#__PURE__*/React.createElement("div", {
    className: "gm__status"
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "generated",
    dot: true
  }, "Generated Layout"), /*#__PURE__*/React.createElement("button", {
    className: "gm__savebtn"
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-device-floppy"
  }), " Save Layout"), /*#__PURE__*/React.createElement("span", {
    className: "gm__keep"
  }, "Keep Text-Only")), /*#__PURE__*/React.createElement("div", {
    className: "gm__zoom"
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    size: "sm",
    value: density,
    onChange: setDensity,
    options: [{
      value: 'structure',
      label: 'Structure'
    }, {
      value: 'names',
      label: 'Names'
    }, {
      value: 'excerpt',
      label: 'Excerpts'
    }]
  }), /*#__PURE__*/React.createElement("div", {
    className: "gm__zoomctl"
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: "minus",
    label: "Zoom out",
    size: "sm",
    onClick: () => setZoom(z => Math.max(25, z - 10))
  }), /*#__PURE__*/React.createElement("span", {
    className: "gm__zoomval"
  }, zoom, "%"), /*#__PURE__*/React.createElement(IconButton, {
    icon: "plus",
    label: "Zoom in",
    size: "sm",
    onClick: () => setZoom(z => Math.min(200, z + 10))
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "maximize",
    label: "Fit",
    size: "sm"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "gm__minimap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "gm__mm-label"
  }, "12,483 passages"), /*#__PURE__*/React.createElement("div", {
    className: "gm__mm-dots"
  }, Array.from({
    length: 220
  }).map((_, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: "gm__mm-dot",
    style: {
      opacity: 0.18 + i % 7 * 0.05,
      background: i % 23 === 0 ? 'var(--sem-error)' : i % 5 === 0 ? 'var(--acc-blue)' : 'var(--tx-4)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "gm__mm-view"
  }))));
}
window.GraphMode = GraphMode;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/workbench/GraphMode.jsx", error: String((e && e.message) || e) }); }

// ui_kits/workbench/TextMode.jsx
try { (() => {
/* Text mode — Twine-aware source editor. Exports window.TextMode. */
const TM_NS = window.TwineRsDesignSystem_073217;
function highlight(line) {
  // lightweight twee/harlowe highlighter → array of {t, c}
  const out = [];
  let m;
  if (m = line.match(/^(::\s*)([^\{#]+)(\{[^}]*\})?\s*(#.*)?$/)) {
    out.push({
      t: m[1],
      c: 'pn'
    });
    out.push({
      t: m[2].trimEnd(),
      c: 'title'
    });
    if (m[2].endsWith(' ')) out.push({
      t: ' ',
      c: ''
    });
    if (m[3]) out.push({
      t: ' ' + m[3] + ' ',
      c: 'meta'
    });
    if (m[4]) out.push({
      t: m[4],
      c: 'tag'
    });
    return out;
  }
  if (/^\s*<!--/.test(line)) return [{
    t: line,
    c: 'comment'
  }];
  // inline tokens
  const re = /(\[\[[^\]]*\]\])|(\([a-z-]+:)|(\$[a-zA-Z_]\w*)/g;
  let last = 0;
  while (m = re.exec(line)) {
    if (m.index > last) out.push({
      t: line.slice(last, m.index),
      c: ''
    });
    if (m[1]) out.push({
      t: m[1],
      c: line.includes('Tide') && false ? 'broken' : 'link'
    });else if (m[2]) out.push({
      t: m[2],
      c: 'macro'
    });else if (m[3]) out.push({
      t: m[3],
      c: 'var'
    });
    last = re.lastIndex;
  }
  if (last < line.length) out.push({
    t: line.slice(last),
    c: ''
  });
  return out.length ? out : [{
    t: line,
    c: ''
  }];
}
function TextMode({
  compact
}) {
  const {
    Badge,
    IconButton,
    Tag
  } = TM_NS;
  const {
    tree,
    source
  } = window.TWINE_DATA;
  const diagLine = 11; // broken link squiggle target (Tide Pools)

  return /*#__PURE__*/React.createElement("div", {
    className: 'tm' + (compact ? ' tm--compact' : '')
  }, !compact && /*#__PURE__*/React.createElement("div", {
    className: "tm__tree"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tm__tree-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tm__tree-title"
  }, "the-lighthouse"), /*#__PURE__*/React.createElement(IconButton, {
    icon: "dots",
    label: "More",
    size: "sm"
  })), /*#__PURE__*/React.createElement("div", {
    className: "tm__tree-body"
  }, tree.map((n, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: 'tm__row' + (n.name === 'arrival.twee' ? ' is-active' : ''),
    style: {
      paddingLeft: 8 + n.depth * 14 + 'px'
    }
  }, n.type === 'dir' && /*#__PURE__*/React.createElement("i", {
    className: 'ti ti-chevron-' + (n.open ? 'down' : 'right') + ' tm__caret'
  }), /*#__PURE__*/React.createElement("i", {
    className: 'ti ti-' + (n.type === 'dir' ? n.open ? 'folder-open' : 'folder' : n.icon) + ' tm__ficon',
    style: {
      color: n.type === 'dir' ? 'var(--sem-warn)' : undefined
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "tm__fname"
  }, n.name), n.dirty && /*#__PURE__*/React.createElement("span", {
    className: "tm__dot",
    title: "Unsaved"
  }), n.broken && /*#__PURE__*/React.createElement("i", {
    className: "ti ti-unlink tm__broken",
    title: "Broken link"
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "tm__editor"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tm__tabs"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tm__tab is-active"
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-file-text"
  }), " arrival.twee ", /*#__PURE__*/React.createElement("span", {
    className: "tm__tab-dot"
  })), /*#__PURE__*/React.createElement("div", {
    className: "tm__tab"
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-file-text"
  }), " gravel-path.twee"), /*#__PURE__*/React.createElement("div", {
    className: "tm__tab"
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-braces"
  }), " story.js"), /*#__PURE__*/React.createElement("div", {
    className: "tm__tab-fill"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "layout-columns",
    label: "Split editor",
    size: "sm"
  })), /*#__PURE__*/React.createElement("div", {
    className: "tm__crumb"
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-folder"
  }), " passages ", /*#__PURE__*/React.createElement("i", {
    className: "ti ti-chevron-right tm__cr-sep"
  }), /*#__PURE__*/React.createElement("span", {
    className: "tm__cr-cur"
  }, "Arrival"), /*#__PURE__*/React.createElement("div", {
    className: "tm__crumb-meta"
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral",
    mono: true
  }, "Harlowe 3.3"), /*#__PURE__*/React.createElement(Badge, {
    tone: "error",
    icon: "unlink"
  }, "1"), /*#__PURE__*/React.createElement(Badge, {
    tone: "link",
    icon: "arrow-up-right"
  }, "2"), /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral",
    icon: "arrow-back-up"
  }, "5 backlinks"))), /*#__PURE__*/React.createElement("div", {
    className: "tm__code"
  }, source.map((ln, i) => {
    const lineNo = i + 1;
    const isDiag = lineNo === diagLine;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: 'tm__line' + (lineNo === 4 ? ' is-cursor' : '')
    }, /*#__PURE__*/React.createElement("span", {
      className: "tm__gutter"
    }, isDiag && /*#__PURE__*/React.createElement("i", {
      className: "ti ti-point-filled tm__gmark"
    }), lineNo), /*#__PURE__*/React.createElement("span", {
      className: "tm__src"
    }, highlight(ln).map((tok, j) => /*#__PURE__*/React.createElement("span", {
      key: j,
      className: tok.c ? 'h-' + tok.c : ''
    }, tok.t)), ln === '' && '\u200b'));
  })), /*#__PURE__*/React.createElement("div", {
    className: "tm__inline-diag"
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-alert-octagon"
  }), /*#__PURE__*/React.createElement("b", null, "Broken link"), " \xA0[[tide pools below->Tide Pools]] \u2014 target has unsaved rename.", /*#__PURE__*/React.createElement("button", {
    className: "tm__fix"
  }, "Quick Fix"))), !compact && /*#__PURE__*/React.createElement("div", {
    className: "tm__outline"
  }, /*#__PURE__*/React.createElement(OutlineSection, {
    icon: "arrow-up-right",
    title: "Outgoing Links",
    count: 2
  }, /*#__PURE__*/React.createElement(OutlineItem, {
    color: "var(--sem-link)",
    label: "The Gravel Path",
    sub: "line 4"
  }), /*#__PURE__*/React.createElement(OutlineItem, {
    color: "var(--sem-error)",
    label: "Tide Pools",
    sub: "line 11 \xB7 broken",
    broken: true
  })), /*#__PURE__*/React.createElement(OutlineSection, {
    icon: "arrow-back-up",
    title: "Backlinks",
    count: 5
  }, /*#__PURE__*/React.createElement(OutlineItem, {
    color: "var(--tx-4)",
    label: "Title Screen",
    sub: "ferry \u2192 arrival"
  }), /*#__PURE__*/React.createElement(OutlineItem, {
    color: "var(--tx-4)",
    label: "The Long Dark",
    sub: "memory \u2192 arrival"
  }), /*#__PURE__*/React.createElement(OutlineItem, {
    color: "var(--tx-4)",
    label: "+ 3 more",
    sub: "",
    muted: true
  })), /*#__PURE__*/React.createElement(OutlineSection, {
    icon: "variable",
    title: "Variables",
    count: 2
  }, /*#__PURE__*/React.createElement(OutlineItem, {
    color: "var(--sem-var)",
    label: "$arrived",
    sub: "set \xB7 boolean",
    mono: true
  }), /*#__PURE__*/React.createElement(OutlineItem, {
    color: "var(--sem-var)",
    label: "$visitedBefore",
    sub: "read \xB7 boolean",
    mono: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "tm__ol-tags"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tm__ol-head"
  }, /*#__PURE__*/React.createElement("i", {
    className: "ti ti-tags"
  }), " Tags"), /*#__PURE__*/React.createElement("div", {
    className: "tm__ol-tagrow"
  }, /*#__PURE__*/React.createElement(Tag, {
    color: "blue"
  }, "intro")))));
}
function OutlineSection({
  icon,
  title,
  count,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "tm__ol-sec"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tm__ol-head"
  }, /*#__PURE__*/React.createElement("i", {
    className: 'ti ti-' + icon
  }), " ", title, /*#__PURE__*/React.createElement("span", {
    className: "tm__ol-count"
  }, count)), children);
}
function OutlineItem({
  color,
  label,
  sub,
  broken,
  muted,
  mono
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "tm__ol-item"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tm__ol-dot",
    style: {
      background: color
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: 'tm__ol-label' + (mono ? ' is-mono' : '') + (muted ? ' is-muted' : '')
  }, label), sub && /*#__PURE__*/React.createElement("span", {
    className: 'tm__ol-sub' + (broken ? ' is-broken' : '')
  }, sub));
}
window.TextMode = TextMode;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/workbench/TextMode.jsx", error: String((e && e.message) || e) }); }

// ui_kits/workbench/data.js
try { (() => {
/* Shared fake project: "The Lighthouse" — an interactive-fiction sample.
   Exposes window.TWINE_DATA used by every workbench screen. */
(function () {
  const TAGS = {
    intro: 'blue',
    shore: 'teal',
    lighthouse: 'yellow',
    keeper: 'purple',
    sea: 'cyan',
    ending: 'green',
    flashback: 'orange',
    danger: 'red'
  };

  // A hand-authored neighborhood shown in the graph viewport.
  const passages = [{
    id: 1,
    name: 'Arrival',
    x: 60,
    y: 200,
    tags: ['intro'],
    links: 2,
    broken: 0,
    start: true,
    excerpt: 'The ferry pulls away. Salt wind, a gravel path, and the lighthouse waiting on the bluff.'
  }, {
    id: 2,
    name: 'The Gravel Path',
    x: 300,
    y: 120,
    tags: ['shore'],
    links: 3,
    broken: 0,
    excerpt: 'Two ruts wind uphill. A gull watches from a leaning fencepost.'
  }, {
    id: 3,
    name: 'Tide Pools',
    x: 300,
    y: 300,
    tags: ['shore', 'sea'],
    links: 2,
    broken: 1,
    excerpt: 'Anemones close as your shadow falls. Something glints beneath the water.'
  }, {
    id: 4,
    name: 'The Keeper\u2019s Door',
    x: 560,
    y: 90,
    tags: ['lighthouse', 'keeper'],
    links: 4,
    broken: 0,
    excerpt: 'Red paint, blistered by sun. A brass knocker shaped like a fish.'
  }, {
    id: 5,
    name: 'Below the Bluff',
    x: 560,
    y: 320,
    tags: ['sea', 'danger'],
    links: 2,
    broken: 0,
    excerpt: 'The rocks are slick. Spray needles your face with every wave.'
  }, {
    id: 6,
    name: 'The Lamp Room',
    x: 820,
    y: 70,
    tags: ['lighthouse'],
    links: 3,
    broken: 0,
    excerpt: 'The great lens throws fractured light across the walls like a slow kaleidoscope.'
  }, {
    id: 7,
    name: 'Marian\u2019s Letters',
    x: 820,
    y: 220,
    tags: ['keeper', 'flashback'],
    links: 2,
    broken: 0,
    excerpt: 'Bundled in oilcloth. The ink has run, but a date survives: October, 1931.'
  }, {
    id: 8,
    name: 'The Storm Breaks',
    x: 820,
    y: 380,
    tags: ['sea', 'danger'],
    links: 3,
    broken: 0,
    excerpt: 'Thunder folds the sky shut. The lamp gutters, then steadies.'
  }, {
    id: 9,
    name: 'What the Light Kept',
    x: 1080,
    y: 150,
    tags: ['ending'],
    links: 0,
    broken: 0,
    excerpt: 'You understand, finally, why the keeper never left.'
  }, {
    id: 10,
    name: 'The Long Dark',
    x: 1080,
    y: 320,
    tags: ['ending', 'danger'],
    links: 0,
    broken: 0,
    excerpt: 'The sea takes what it is owed. The light goes out.'
  }];
  const edges = [[1, 2], [1, 3], [2, 4], [2, 5], [3, 5], [4, 6], [4, 7], [5, 8], [6, 9], [7, 9], [8, 9], [8, 10], [6, 7]];

  // File tree for Text mode.
  const tree = [{
    type: 'file',
    name: 'twine.toml',
    icon: 'settings',
    depth: 0
  }, {
    type: 'file',
    name: 'story.twee',
    icon: 'file-text',
    depth: 0
  }, {
    type: 'dir',
    name: 'passages',
    icon: 'folder',
    depth: 0,
    open: true
  }, {
    type: 'file',
    name: 'arrival.twee',
    icon: 'file-text',
    depth: 1,
    dirty: true
  }, {
    type: 'dir',
    name: 'shore',
    icon: 'folder',
    depth: 1,
    open: true
  }, {
    type: 'file',
    name: 'gravel-path.twee',
    icon: 'file-text',
    depth: 2
  }, {
    type: 'file',
    name: 'tide-pools.twee',
    icon: 'file-text',
    depth: 2,
    broken: true
  }, {
    type: 'dir',
    name: 'lighthouse',
    icon: 'folder',
    depth: 1,
    open: false
  }, {
    type: 'dir',
    name: 'scripts',
    icon: 'folder',
    depth: 0,
    open: true
  }, {
    type: 'file',
    name: 'story.js',
    icon: 'braces',
    depth: 1
  }, {
    type: 'dir',
    name: 'styles',
    icon: 'folder',
    depth: 0,
    open: true
  }, {
    type: 'file',
    name: 'story.css',
    icon: 'hash',
    depth: 1
  }, {
    type: 'dir',
    name: 'assets',
    icon: 'folder',
    depth: 0,
    open: false
  }, {
    type: 'dir',
    name: '.twine',
    icon: 'folder',
    depth: 0,
    open: false
  }];

  // Source lines for the open passage (Arrival).
  const source = [':: Arrival {"position":"60,200","size":"100,100"} #intro', '', 'The ferry pulls away behind you, its engine fading into the', 'grey hush of the water. Ahead, a [[gravel path->The Gravel Path]]', 'climbs the bluff toward the lighthouse.', '', '(set: $arrived to true)', '(if: $visitedBefore)[You have stood here once before. ]', '', 'You could start up the path, or pick your way down to the', '[[tide pools below->Tide Pools]] while the light still holds.', '', '<!-- TODO: foreshadow the keeper -->'];

  // Big-project stats shown in the Contents view / status bar.
  const stats = {
    passages: 12483,
    words: 248917,
    characters: 1488203,
    links: 31402,
    broken: 37,
    orphans: 4,
    tags: 28,
    variables: 116,
    assets: 53
  };
  window.TWINE_DATA = {
    TAGS,
    passages,
    edges,
    tree,
    source,
    stats
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/workbench/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.PassageNode = __ds_scope.PassageNode;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

})();
