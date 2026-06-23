/* Graph mode — native story-graph canvas. Exports window.GraphMode.

   The whole graph (grid + edges + nodes) lives inside ONE transformed
   "world" layer:  transform: translate(x,y) scale(k); transform-origin 0 0.
   Pan = change x/y. Zoom = change k while keeping the world point under the
   cursor fixed. There is NO scrolling, no animation fighting the wheel, and
   edges never "redraw" on selection — they just ride the same transform.

   Selection never moves or centers a node. Dragging snaps to the SAME 25px
   grid the dots are drawn on, so passages land exactly on the dots. */

const GM_NS = window.TwineRsDesignSystem_073217;

const NODE_W = 184;
const NODE_H = { structure: 52, names: 66, excerpt: 122 };
const MIN_K = 0.2;
const MAX_K = 2.4;

function clampK(k) { return Math.max(MIN_K, Math.min(MAX_K, k)); }

function GraphMode({
	passages, edges, positions, setPositions,
	selectedIds, onSelect, onOpenPassage, onContextAction,
	density, setDensity, snap, setSnap, tool, setTool
}) {
	const { PassageNode, IconButton, Badge } = GM_NS;
	const { TAGS, GRID } = window.TWINE_DATA;

	const [view, setView] = React.useState({ x: 120, y: 60, k: 0.92 });
	const [marquee, setMarquee] = React.useState(null);   // screen-space rect
	const [menu, setMenu] = React.useState(null);
	const [spaceDown, setSpaceDown] = React.useState(false);

	const vpRef = React.useRef(null);
	const dragRef = React.useRef(null);
	const panRef = React.useRef(null);
	const downRef = React.useRef(null);   // pointer-down bookkeeping for click vs drag

	const byId = React.useMemo(
		() => Object.fromEntries(passages.map(p => [p.id, p])), [passages]);
	const nh = NODE_H[density];

	// ---- coordinate helpers --------------------------------------------
	const vpRect = () => vpRef.current.getBoundingClientRect();
	const toWorld = (clientX, clientY) => {
		const r = vpRect();
		return {
			x: (clientX - r.left - view.x) / view.k,
			y: (clientY - r.top - view.y) / view.k
		};
	};
	const snapVal = v => snap ? Math.round(v / GRID) * GRID : Math.round(v);

	// ---- wheel: zoom anchored at cursor (shift = horizontal pan) --------
	React.useEffect(() => {
		const vp = vpRef.current;
		const onWheel = e => {
			e.preventDefault();
			if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
				// pan with the wheel when shift is held
				setView(v => ({ ...v, x: v.x - (e.deltaX + e.deltaY), y: v.y }));
				return;
			}
			const r = vp.getBoundingClientRect();
			const mx = e.clientX - r.left;
			const my = e.clientY - r.top;
			setView(v => {
				const factor = Math.exp(-e.deltaY * 0.0016);   // smooth, continuous
				const k = clampK(v.k * factor);
				if (k === v.k) return v;
				// keep the world point under the cursor pinned
				const wx = (mx - v.x) / v.k;
				const wy = (my - v.y) / v.k;
				return { x: mx - wx * k, y: my - wy * k, k };
			});
		};
		vp.addEventListener('wheel', onWheel, { passive: false });
		return () => vp.removeEventListener('wheel', onWheel);
	}, [view.k, view.x, view.y]);

	// ---- spacebar = temporary pan tool ---------------------------------
	React.useEffect(() => {
		const dn = e => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); setSpaceDown(true); } };
		const up = e => { if (e.code === 'Space') setSpaceDown(false); };
		window.addEventListener('keydown', dn);
		window.addEventListener('keyup', up);
		return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
	}, []);

	const panning = tool === 'pan' || spaceDown;

	// ---- background pointer: pan OR marquee ----------------------------
	function onCanvasPointerDown(e) {
		if (e.button === 2) return;       // right-click handled separately
		setMenu(null);
		const wantPan = panning || e.button === 1;
		if (wantPan) {
			panRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
			const move = ev => {
				const p = panRef.current; if (!p) return;
				setView(v => ({ ...v, x: p.ox + (ev.clientX - p.sx), y: p.oy + (ev.clientY - p.sy) }));
			};
			const up = () => { panRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
			window.addEventListener('pointermove', move);
			window.addEventListener('pointerup', up);
			return;
		}
		// marquee
		const start = { x: e.clientX, y: e.clientY };
		const additive = e.shiftKey || e.metaKey || e.ctrlKey;
		const base = additive ? new Set(selectedIds) : new Set();
		const move = ev => {
			const r = vpRect();
			const rect = {
				left: Math.min(start.x, ev.clientX) - r.left,
				top: Math.min(start.y, ev.clientY) - r.top,
				w: Math.abs(ev.clientX - start.x),
				h: Math.abs(ev.clientY - start.y)
			};
			setMarquee(rect);
			// hit-test in world space
			const w0 = toWorld(Math.min(start.x, ev.clientX), Math.min(start.y, ev.clientY));
			const w1 = toWorld(Math.max(start.x, ev.clientX), Math.max(start.y, ev.clientY));
			const hit = new Set(base);
			passages.forEach(p => {
				const pos = positions[p.id];
				const intersect = pos.x < w1.x && pos.x + NODE_W > w0.x && pos.y < w1.y && pos.y + nh > w0.y;
				if (intersect) hit.add(p.id);
			});
			onSelect(Array.from(hit), 'replace');
		};
		const up = ev => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			setMarquee(null);
			// plain click on empty space clears selection
			if (Math.abs(ev.clientX - start.x) < 3 && Math.abs(ev.clientY - start.y) < 3 && !additive) {
				onSelect([], 'replace');
			}
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	// ---- node pointer: select + drag (snap on release) -----------------
	function onNodePointerDown(e, id) {
		if (e.button === 2) return;
		e.stopPropagation();
		setMenu(null);
		const additive = e.shiftKey || e.metaKey || e.ctrlKey;

		let workingSel = selectedIds;
		if (additive) {
			const next = new Set(selectedIds);
			next.has(id) ? next.delete(id) : next.add(id);
			workingSel = Array.from(next);
			onSelect(workingSel, 'replace');
		} else if (!selectedIds.includes(id)) {
			workingSel = [id];
			onSelect(workingSel, 'replace');
		}

		const movers = (additive ? workingSel : (selectedIds.includes(id) ? selectedIds : [id]))
			.filter(Boolean);
		const startPos = Object.fromEntries(movers.map(mid => [mid, { ...positions[mid] }]));
		downRef.current = { id, sx: e.clientX, sy: e.clientY, moved: false };

		const move = ev => {
			const d = downRef.current; if (!d) return;
			const dx = (ev.clientX - d.sx) / view.k;
			const dy = (ev.clientY - d.sy) / view.k;
			if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 4) return;
			d.moved = true;
			setPositions(prev => {
				const next = { ...prev };
				movers.forEach(mid => {
					next[mid] = { x: snapVal(startPos[mid].x + dx), y: snapVal(startPos[mid].y + dy) };
				});
				return next;
			});
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			downRef.current = null;
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	function onNodeContext(e, id) {
		e.preventDefault(); e.stopPropagation();
		if (!selectedIds.includes(id)) onSelect([id], 'replace');
		const r = vpRect();
		setMenu({ x: e.clientX - r.left, y: e.clientY - r.top, kind: 'node', id });
	}
	function onCanvasContext(e) {
		e.preventDefault();
		const r = vpRect();
		const w = toWorld(e.clientX, e.clientY);
		setMenu({ x: e.clientX - r.left, y: e.clientY - r.top, kind: 'canvas', world: w });
	}

	// ---- fit-to-content -------------------------------------------------
	function fit() {
		const xs = passages.map(p => positions[p.id].x);
		const ys = passages.map(p => positions[p.id].y);
		const minX = Math.min(...xs), maxX = Math.max(...xs) + NODE_W;
		const minY = Math.min(...ys), maxY = Math.max(...ys) + nh;
		const r = vpRect();
		const k = clampK(Math.min((r.width - 120) / (maxX - minX), (r.height - 120) / (maxY - minY)));
		setView({ k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: (r.height - (maxY - minY) * k) / 2 - minY * k });
	}

	const zoomAtCenter = dir => setView(v => {
		const r = vpRect(); const mx = r.width / 2, my = r.height / 2;
		const k = clampK(v.k * (dir > 0 ? 1.18 : 1 / 1.18));
		const wx = (mx - v.x) / v.k, wy = (my - v.y) / v.k;
		return { x: mx - wx * k, y: my - wy * k, k };
	});

	const selSet = new Set(selectedIds);
	const tagColor = t => `var(--sem-${({blue:'link',teal:'generated',yellow:'warn',purple:'tag',cyan:'var',green:'saved',orange:'dirty',red:'error'})[TAGS[t]] || 'link'})`;

	function edgePath(a, b) {
		const pa = positions[a], pb = positions[b];
		const ax = pa.x + NODE_W, ay = pa.y + nh / 2;
		const bx = pb.x, by = pb.y + nh / 2;
		const bend = Math.max(Math.abs(bx - ax) * 0.45, 60);
		return `M ${ax} ${ay} C ${ax + bend} ${ay}, ${bx - bend} ${by}, ${bx} ${by}`;
	}

	const cursor = panning ? (panRef.current ? 'grabbing' : 'grab') : 'default';

	return (
		<div className="gm" ref={vpRef}
			onPointerDown={onCanvasPointerDown}
			onContextMenu={onCanvasContext}
			style={{ cursor }}>

			{/* dotted grid — dots sit at the SNAP corners (multiples of 25), not
			    tile centers, so a snapped passage lands exactly on a dot */}
			<div className="gm__grid" style={{
				backgroundPosition:
					`${view.x - GRID * view.k / 2}px ${view.y - GRID * view.k / 2}px, ` +
					`${view.x - GRID * 5 * view.k / 2}px ${view.y - GRID * 5 * view.k / 2}px`,
				backgroundSize: `${GRID * view.k}px ${GRID * view.k}px, ${GRID * 5 * view.k}px ${GRID * 5 * view.k}px`,
				opacity: snap ? 1 : 0.4
			}} />

			{/* one transformed world: edges + nodes ride together */}
			<div className="gm__world" style={{
				transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
				transformOrigin: '0 0'
			}}>
				<svg className="gm__edges" width="2000" height="1200">
					<defs>
						<marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
							<path d="M0,0 L6,3 L0,6 Z" fill="var(--line-3)" /></marker>
						<marker id="ah-sel" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
							<path d="M0,0 L6,3 L0,6 Z" fill="var(--sel-line)" /></marker>
						<marker id="ah-bad" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
							<path d="M0,0 L6,3 L0,6 Z" fill="var(--sem-error)" /></marker>
					</defs>
					{edges.map(([a, b], i) => {
						const broken = byId[b] && byId[b].broken > 0 && b === 3;
						const connected = selSet.has(a) || selSet.has(b);
						const dim = selSet.size > 0 && !connected;
						return (
							<path key={i} d={edgePath(a, b)} fill="none"
								stroke={broken ? 'var(--sem-error)' : connected ? 'var(--sel-line)' : 'var(--line-2)'}
								strokeWidth={connected ? 2.4 : 1.5}
								strokeDasharray={broken ? '6 5' : 'none'}
								markerEnd={broken ? 'url(#ah-bad)' : connected ? 'url(#ah-sel)' : 'url(#ah)'}
								opacity={dim ? 0.28 : 1} />
						);
					})}
				</svg>
				<div className="gm__nodes">
					{passages.map(p => {
						const pos = positions[p.id];
						return (
							<div key={p.id} className="gm__node" style={{ left: pos.x, top: pos.y }}
								onPointerDown={e => onNodePointerDown(e, p.id)}
								onContextMenu={e => onNodeContext(e, p.id)}
								onDoubleClick={e => { e.stopPropagation(); onOpenPassage(p.id); }}>
								<PassageNode title={p.name} start={p.start}
									excerpt={density === 'excerpt' ? p.excerpt : undefined}
									tags={density === 'structure' ? [] : p.tags.map(tagColor)}
									links={p.links} broken={p.broken}
									selected={selSet.has(p.id)} />
							</div>
						);
					})}
				</div>
			</div>

			{/* marquee overlay (screen space) */}
			{marquee && <div className="gm__marquee" style={{
				left: marquee.left, top: marquee.top, width: marquee.w, height: marquee.h }} />}

			{/* context menu */}
			{menu && (
				<div className="gm__menu" style={{ left: menu.x, top: menu.y }}
					onPointerDown={e => e.stopPropagation()}>
					{menu.kind === 'node' ? (
						<>
							<button className="gm__mi" onClick={() => { onOpenPassage(menu.id); setMenu(null); }}>
								<i className="ti ti-edit" /> {selectedIds.length > 1 ? `Edit ${selectedIds.length} passages` : 'Edit passage'}
								<kbd>↵</kbd></button>
							<button className="gm__mi" onClick={() => { onContextAction('test', menu.id); setMenu(null); }}>
								<i className="ti ti-player-play" /> Test from here</button>
							<button className="gm__mi" onClick={() => { onContextAction('rename', menu.id); setMenu(null); }}>
								<i className="ti ti-cursor-text" /> Rename</button>
							<div className="gm__msep" />
							<button className="gm__mi danger" onClick={() => { onContextAction('delete', menu.id); setMenu(null); }}>
								<i className="ti ti-trash" /> Delete {selectedIds.length > 1 ? `${selectedIds.length} passages` : ''}<kbd>⌫</kbd></button>
						</>
					) : (
						<>
							<button className="gm__mi" onClick={() => { onContextAction('new', menu.world); setMenu(null); }}>
								<i className="ti ti-plus" /> New passage here</button>
							<button className="gm__mi" onClick={() => { fit(); setMenu(null); }}>
								<i className="ti ti-maximize" /> Fit graph to window</button>
							<div className="gm__msep" />
							<button className="gm__mi" onClick={() => { setSnap(s => !s); setMenu(null); }}>
								<i className={'ti ti-' + (snap ? 'check' : 'grid-dots')} /> Snap to grid</button>
						</>
					)}
				</div>
			)}

			{/* floating left tool dock */}
			<div className="gm__toolbar" onPointerDown={e => e.stopPropagation()}>
				<IconButton icon="pointer" label="Select (V)" active={tool === 'select'} solid onClick={() => setTool('select')} />
				<IconButton icon="hand-stop" label="Pan (hold Space)" active={tool === 'pan'} solid onClick={() => setTool('pan')} />
				<div className="gm__tbsep" />
				<IconButton icon="plus" label="New passage" solid onClick={() => onContextAction('new', { x: snapVal((vpRect().width / 2 - view.x) / view.k), y: snapVal((vpRect().height / 2 - view.y) / view.k) })} />
				<IconButton icon="grid-dots" label="Snap to grid" active={snap} solid onClick={() => setSnap(s => !s)} />
			</div>

			{/* density (top-right) */}
			<div className="gm__density" onPointerDown={e => e.stopPropagation()}>
				{[['structure', 'Structure', 'layout-list'], ['names', 'Names', 'tag'], ['excerpt', 'Excerpts', 'align-left']].map(([v, lb, ic]) => (
					<button key={v} className={'gm__den' + (density === v ? ' is-on' : '')} onClick={() => setDensity(v)} title={lb}>
						<i className={'ti ti-' + ic} /> {lb}
					</button>
				))}
			</div>

			{/* zoom (bottom-right) */}
			<div className="gm__zoom" onPointerDown={e => e.stopPropagation()}>
				<IconButton icon="minus" label="Zoom out" size="sm" solid onClick={() => zoomAtCenter(-1)} />
				<span className="gm__zoomval">{Math.round(view.k * 100)}%</span>
				<IconButton icon="plus" label="Zoom in" size="sm" solid onClick={() => zoomAtCenter(1)} />
				<div className="gm__tbsep gm__tbsep--v" />
				<IconButton icon="maximize" label="Fit (⇧1)" size="sm" solid onClick={fit} />
			</div>

			{/* layout status (bottom-left) */}
			<div className="gm__status" onPointerDown={e => e.stopPropagation()}>
				<Badge tone="generated" dot>Generated Layout</Badge>
				{selectedIds.length > 0 && <span className="gm__selcount">{selectedIds.length} selected</span>}
			</div>
		</div>
	);
}
window.GraphMode = GraphMode;
