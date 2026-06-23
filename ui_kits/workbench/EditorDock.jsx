/* EditorDock — the multi-window source editor. Exports window.EditorDock.

   THE PATTERN (what the real app got wrong):
   - Each open buffer is ONE window in a horizontal flex strip.
   - Story-level chrome (format, project, validate) lives ONCE, above the
     strip — never repeated per window.
   - A window's titlebar shows only what is PER-BUFFER: its name, dirty dot,
     close (✕, top-right), and a find toggle.
   - JavaScript & Stylesheet are story-wide singletons: opening one focuses
     the existing window instead of making a duplicate. Passage windows can
     stack freely (open as many passages as you like).
   - 1–3 windows tile evenly; 4+ keep a comfortable min width and the strip
     scrolls horizontally. */

const ED_NS = window.TwineRsDesignSystem_073217;

function highlight(line, lang) {
	const out = [];
	let m;
	if (lang === 'twee') {
		if ((m = line.match(/^(::\s*)([^\{#]+)(\{[^}]*\})?\s*(#.*)?$/))) {
			out.push({ t: m[1], c: 'pn' });
			out.push({ t: m[2].trimEnd(), c: 'title' });
			if (m[2].endsWith(' ')) out.push({ t: ' ', c: '' });
			if (m[3]) out.push({ t: ' ' + m[3] + ' ', c: 'meta' });
			if (m[4]) out.push({ t: m[4], c: 'tag' });
			return out;
		}
		if (/^\s*<!--/.test(line)) return [{ t: line, c: 'comment' }];
		// [[links]], (macro:), $var.props
		const re = /(\[\[[^\]]*\]\])|(\([a-z][\w-]*:)|(\$[a-zA-Z_]\w*(?:\.\w+)*)/g;
		let last = 0;
		while ((m = re.exec(line))) {
			if (m.index > last) out.push({ t: line.slice(last, m.index), c: '' });
			if (m[1]) out.push({ t: m[1], c: 'link' });
			else if (m[2]) out.push({ t: m[2], c: 'macro' });
			else if (m[3]) out.push({ t: m[3], c: 'var' });
			last = re.lastIndex;
		}
		if (last < line.length) out.push({ t: line.slice(last), c: '' });
		return out.length ? out : [{ t: line, c: '' }];
	}
	// js / css: comments, strings, keywords, properties
	if (lang === 'css') {
		if (/^\s*\/\*/.test(line) || /\*\//.test(line)) return [{ t: line, c: 'comment' }];
		const re = /(--[\w-]+|[a-z-]+(?=\s*:))|("[^"]*"|'[^']*')|(#[0-9a-fA-F]{3,8})|(:root|tw-\w+)/g;
		let last = 0;
		while ((m = re.exec(line))) {
			if (m.index > last) out.push({ t: line.slice(last, m.index), c: '' });
			if (m[1]) out.push({ t: m[1], c: 'prop' });
			else if (m[2]) out.push({ t: m[2], c: 'str' });
			else if (m[3]) out.push({ t: m[3], c: 'num' });
			else if (m[4]) out.push({ t: m[4], c: 'kw' });
			last = re.lastIndex;
		}
		if (last < line.length) out.push({ t: line.slice(last), c: '' });
		return out.length ? out : [{ t: line, c: '' }];
	}
	// js
	if (/^\s*\/\//.test(line)) return [{ t: line, c: 'comment' }];
	const re = /(\b(?:const|let|var|function|return|if|else|window|new|this)\b)|("[^"]*"|'[^']*'|`[^`]*`)|(\b\d+\b)|([A-Z]\w+)/g;
	let last = 0;
	while ((m = re.exec(line))) {
		if (m.index > last) out.push({ t: line.slice(last, m.index), c: '' });
		if (m[1]) out.push({ t: m[1], c: 'kw' });
		else if (m[2]) out.push({ t: m[2], c: 'str' });
		else if (m[3]) out.push({ t: m[3], c: 'num' });
		else if (m[4]) out.push({ t: m[4], c: 'type' });
		last = re.lastIndex;
	}
	if (last < line.length) out.push({ t: line.slice(last), c: '' });
	return out.length ? out : [{ t: line, c: '' }];
}

function langOf(win) {
	return win.kind === 'js' ? 'js' : win.kind === 'css' ? 'css' : 'twee';
}
function iconOf(win) {
	return win.kind === 'js' ? 'braces' : win.kind === 'css' ? 'hash' : 'file-text';
}

function EditorWindow({ win, lines, active, dirty, broken, onFocus, onClose, onDragStart }) {
	const { IconButton, Tag } = ED_NS;
	const [find, setFind] = React.useState(false);
	const lang = langOf(win);
	return (
		<div className={'ew' + (active ? ' ew--active' : '')} onMouseDown={onFocus}>
			<div className="ew__bar" draggable onDragStart={onDragStart}>
				<i className="ti ti-grip-vertical ew__grip" title="Drag to rearrange" />
				<i className={'ti ti-' + iconOf(win) + ' ew__ic'} />
				<span className="ew__name">{win.title}</span>
				{dirty && <span className="ew__dirty" title="Unsaved" />}
				<div className="ew__bar-sp" />
				<button className={'ew__act' + (find ? ' is-on' : '')} title="Find in file (⌘F)" onClick={() => setFind(f => !f)}>
					<i className="ti ti-search" /></button>
				<button className="ew__close" title="Close (⌘W)" onClick={onClose}>
					<i className="ti ti-x" /></button>
			</div>

			{/* per-passage controls live INSIDE the passage window only */}
			{win.kind === 'passage' && (
				<div className="ew__sub">
					<button className="ew__tagbtn"><i className="ti ti-tag" /> {win.tags && win.tags[0] ? win.tags[0] : 'Add tag'}</button>
					<div className="ew__sub-sp" />
					<span className="ew__meta"><i className="ti ti-arrow-up-right" /> {win.links}</span>
					{broken > 0 && <span className="ew__meta is-bad"><i className="ti ti-unlink" /> {broken}</span>}
				</div>
			)}

			{find && (
				<div className="ew__find">
					<i className="ti ti-search" />
					<input placeholder={'Find in ' + win.title} autoFocus />
					<span className="ew__find-count">0 / 0</span>
					<button title="Previous"><i className="ti ti-chevron-up" /></button>
					<button title="Next"><i className="ti ti-chevron-down" /></button>
					<button title="Close" onClick={() => setFind(false)}><i className="ti ti-x" /></button>
				</div>
			)}

			<div className="ew__code">
				{lines.map((ln, i) => {
					const no = i + 1;
					const isBad = win.kind === 'passage' && broken > 0 && no === 11;
					return (
						<div key={i} className={'ew__line' + (no === 4 && active ? ' is-cursor' : '')}>
							<span className="ew__gutter">{isBad && <i className="ti ti-point-filled ew__gmark" />}{no}</span>
							<span className="ew__src">
								{highlight(ln, lang).map((tok, j) => (
									<span key={j} className={tok.c ? 'h-' + tok.c : ''}>{tok.t}</span>
								))}
								{ln === '' && '\u200b'}
							</span>
						</div>
					);
				})}
			</div>

			{win.kind === 'passage' && broken > 0 && (
				<div className="ew__diag">
					<i className="ti ti-alert-octagon" />
					<b>Broken link</b>&nbsp;[[tide pools below-&gt;Tide&nbsp;Pools]] — target renamed.
					<button className="ew__fix">Quick Fix</button>
				</div>
			)}
		</div>
	);
}

function EditorDock({ windows, activeId, onFocus, onClose, onOpen, onReorder, compact }) {
	const { format } = window.TWINE_DATA;
	const data = window.TWINE_DATA;
	const [openMenu, setOpenMenu] = React.useState(false);
	const [dragIdx, setDragIdx] = React.useState(null);
	const [overIdx, setOverIdx] = React.useState(null);

	function linesFor(win) {
		if (win.kind === 'js') return data.storyJs;
		if (win.kind === 'css') return data.storyCss;
		return data.passageSource[win.passageId] || data.passageSource[1];
	}

	return (
		<div className={'dock' + (compact ? ' dock--compact' : '')}>
			{/* story-level chrome — ONCE, not per window */}
			<div className="dock__chrome">
				<div className="dock__open">
					<button className="dock__openbtn" onClick={() => setOpenMenu(m => !m)}>
						<i className="ti ti-plus" /> Open editor <i className="ti ti-chevron-down" />
					</button>
					{openMenu && (
						<div className="dock__openmenu" onMouseLeave={() => setOpenMenu(false)}>
							<button onClick={() => { onOpen({ kind: 'passage', passageId: 1 }); setOpenMenu(false); }}>
								<i className="ti ti-file-text" /> Passage…</button>
							<button onClick={() => { onOpen({ kind: 'js' }); setOpenMenu(false); }}>
								<i className="ti ti-braces" /> Story JavaScript</button>
							<button onClick={() => { onOpen({ kind: 'css' }); setOpenMenu(false); }}>
								<i className="ti ti-hash" /> Story Stylesheet</button>
						</div>
					)}
				</div>
				<div className="dock__chrome-sp" />
				<span className="dock__fmt"><i className="ti ti-puzzle" /> {format}</span>
				<span className="dock__diag"><i className="ti ti-alert-octagon" /> 1 issue</span>
			</div>

			{windows.length === 0 ? (
				<div className="dock__empty">
					<i className="ti ti-windows" />
					<p>No editors open</p>
					<span>Double-click a passage in the graph, or use <b>Open editor</b>.</span>
				</div>
			) : (
				(() => {
					const n = windows.length;
					// adapt to available space: stack vertically in the narrow split
					// column, tile in a 2-D grid when the dock has full width.
					const cols = compact ? 1 : n <= 1 ? 1 : n <= 4 ? 2 : 3;
					return (
						<div className="dock__grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
							{windows.map((win, i) => {
								// a lone tile on the final row spans the full width
								const orphan = cols > 1 && i === n - 1 && n % cols === 1;
								const cls = 'dock__cell' + (dragIdx === i ? ' is-dragging' : '')
									+ (overIdx === i && dragIdx !== null && dragIdx !== i ? ' is-over' : '');
								return (
									<div className={cls} key={win.id}
										style={orphan ? { gridColumn: '1 / -1' } : undefined}
										onDragOver={e => { if (dragIdx !== null) { e.preventDefault(); setOverIdx(i); } }}
										onDrop={e => { e.preventDefault(); if (dragIdx !== null && dragIdx !== i) onReorder(dragIdx, i); setDragIdx(null); setOverIdx(null); }}>
										<EditorWindow win={win} lines={linesFor(win)}
											active={win.id === activeId} dirty={win.dirty}
											broken={win.kind === 'passage' ? (win.broken || 0) : 0}
											onFocus={() => onFocus(win.id)} onClose={() => onClose(win.id)}
											onDragStart={e => { setDragIdx(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }} />
									</div>
								);
							})}
						</div>
					);
				})()
			)}
		</div>
	);
}
window.EditorDock = EditorDock;
