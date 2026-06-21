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

	const ITEMS = [
		{ id: 'projects', icon: 'stack-2', label: 'Projects', href: '../launcher/index.html' },
		{ id: 'workbench', icon: 'layout-columns', label: 'Workbench', href: '../workbench/index.html' },
		{ id: 'contents', icon: 'list-tree', label: 'Contents', href: '../contents/index.html' },
		{ id: 'diagnostics', icon: 'alert-triangle', label: 'Diagnostics', href: '../diagnostics/index.html', badge: 37 },
		{ id: 'assets', icon: 'photo', label: 'Assets', href: '../assets/index.html' },
		{ id: 'formats', icon: 'puzzle', label: 'Story Formats', href: '../formats/index.html' },
		{ id: 'build', icon: 'package-export', label: 'Build & Export', href: '../build/index.html' },
		{ id: 'play', icon: 'player-play', label: 'Play & Test', href: '../play/index.html' }
	];
	const BOTTOM = [
		{ id: 'new', icon: 'square-rounded-plus', label: 'New Project', href: '../new-project/index.html' },
		{ id: 'settings', icon: 'settings', label: 'Settings', href: '../settings/index.html' }
	];

	function Item(it, active) {
		return React.createElement(
			'a',
			{ key: it.id, href: it.href, className: 'twr__item' + (active === it.id ? ' is-on' : ''),
				title: it.label, 'aria-label': it.label },
			React.createElement('i', { className: 'ti ti-' + it.icon, 'aria-hidden': 'true' }),
			it.badge ? React.createElement('span', { className: 'twr__badge' }, it.badge) : null
		);
	}

	window.TwineRail = function TwineRail(props) {
		ensure();
		const active = props && props.active;
		return React.createElement(
			'nav', { className: 'twr' },
			React.createElement('a', { className: 'twr__brand', href: '../launcher/index.html', title: 'twine.rs' },
				React.createElement('img', { src: '../../assets/twine-mark.svg', alt: 'twine.rs' })),
			ITEMS.map(it => Item(it, active)),
			React.createElement('div', { className: 'twr__sp' }),
			BOTTOM.map(it => Item(it, active))
		);
	};
})();
