/* Graph mode — native story-graph canvas. Exports window.GraphMode. */
const NS = window.TwineRsDesignSystem_073217;

function GraphMode({ selected, setSelected }) {
	const { PassageNode, IconButton, Badge, SegmentedControl } = NS;
	const { passages, edges, stats, TAGS } = window.TWINE_DATA;
	const [density, setDensity] = React.useState('excerpt');
	const [zoom, setZoom] = React.useState(82);

	const byId = React.useMemo(() => Object.fromEntries(passages.map(p => [p.id, p])), [passages]);
	const NODE_W = 184;
	// estimated node height by density for edge anchoring
	const nh = density === 'structure' ? 30 : density === 'names' ? 42 : 118;

	function edgePath(a, b) {
		const x1 = a.x + NODE_W, y1 = a.y + nh / 2;
		const x2 = b.x, y2 = b.y + nh / 2;
		const mx = (x1 + x2) / 2;
		return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
	}

	const tagColor = t => `var(--sem-${({blue:'link',teal:'generated',yellow:'warn',purple:'tag',cyan:'var',green:'saved',orange:'dirty',red:'error'})[TAGS[t]] || 'link'})`;

	return (
		<div className="gm">
			{/* Canvas */}
			<div className="gm__canvas">
				<svg className="gm__edges" width="1320" height="520">
					<defs>
						<marker id="ah" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
							<path d="M0,0 L6,3 L0,6 Z" fill="var(--line-3)" />
						</marker>
						<marker id="ah-broken" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
							<path d="M0,0 L6,3 L0,6 Z" fill="var(--sem-error)" />
						</marker>
					</defs>
					{edges.map(([a, b], i) => {
						const pa = byId[a], pb = byId[b];
						const broken = pb && pb.broken > 0 && pb.id === 3;
						const active = selected && (a === selected || b === selected);
						return (
							<path key={i} d={edgePath(pa, pb)} fill="none"
								stroke={broken ? 'var(--sem-error)' : active ? 'var(--sel-line)' : 'var(--line-2)'}
								strokeWidth={active ? 2 : 1.5}
								strokeDasharray={broken ? '5 4' : 'none'}
								markerEnd={broken ? 'url(#ah-broken)' : 'url(#ah)'}
								opacity={active ? 1 : 0.7} />
						);
					})}
				</svg>
				<div className="gm__nodes">
					{passages.map(p => (
						<div key={p.id} className="gm__node" style={{ left: p.x, top: p.y }}>
							<PassageNode title={p.name} start={p.start}
								excerpt={density === 'excerpt' ? p.excerpt : undefined}
								tags={density === 'structure' ? [] : p.tags.map(tagColor)}
								links={p.links} broken={p.broken}
								selected={selected === p.id}
								onClick={() => setSelected(p.id)} />
						</div>
					))}
				</div>
			</div>

			{/* Floating left toolbar */}
			<div className="gm__toolbar">
				<IconButton icon="pointer" label="Select" active solid />
				<IconButton icon="hand-stop" label="Pan" solid />
				<div className="gm__tbsep" />
				<IconButton icon="plus" label="New Passage" solid />
				<IconButton icon="arrows-join" label="Connect" solid />
				<IconButton icon="folder" label="Group" solid />
				<IconButton icon="message-2" label="Annotate" solid />
				<div className="gm__tbsep" />
				<IconButton icon="layout-align-left" label="Align" solid />
				<IconButton icon="layout-distribute-horizontal" label="Distribute" solid />
				<IconButton icon="grid-dots" label="Snap to grid" active solid />
			</div>

			{/* Top-right: layers */}
			<div className="gm__layers">
				<span className="gm__layers-l">Layers</span>
				{[['link','Links',true],['unlink','Broken',true],['arrow-back-up','Backlinks',false],
				  ['variable','Variables',false],['tag','Tags',true],['alert-triangle','Diagnostics',true]].map(([ic,lb,on]) => (
					<button key={lb} className={'gm__layer' + (on ? ' is-on' : '')}>
						<i className={'ti ti-' + ic} /> {lb}
					</button>
				))}
			</div>

			{/* Bottom-left: layout status */}
			<div className="gm__status">
				<Badge tone="generated" dot>Generated Layout</Badge>
				<button className="gm__savebtn"><i className="ti ti-device-floppy" /> Save Layout</button>
				<span className="gm__keep">Keep Text-Only</span>
			</div>

			{/* Bottom-right: zoom + density */}
			<div className="gm__zoom">
				<SegmentedControl size="sm" value={density} onChange={setDensity} options={[
					{ value: 'structure', label: 'Structure' },
					{ value: 'names', label: 'Names' },
					{ value: 'excerpt', label: 'Excerpts' }]} />
				<div className="gm__zoomctl">
					<IconButton icon="minus" label="Zoom out" size="sm" onClick={() => setZoom(z => Math.max(25, z - 10))} />
					<span className="gm__zoomval">{zoom}%</span>
					<IconButton icon="plus" label="Zoom in" size="sm" onClick={() => setZoom(z => Math.min(200, z + 10))} />
					<IconButton icon="maximize" label="Fit" size="sm" />
				</div>
			</div>

			{/* Minimap */}
			<div className="gm__minimap">
				<div className="gm__mm-label">12,483 passages</div>
				<div className="gm__mm-dots">
					{Array.from({ length: 220 }).map((_, i) => (
						<span key={i} className="gm__mm-dot" style={{
							opacity: 0.18 + (i % 7) * 0.05,
							background: i % 23 === 0 ? 'var(--sem-error)' : i % 5 === 0 ? 'var(--acc-blue)' : 'var(--tx-4)'
						}} />
					))}
					<div className="gm__mm-view" />
				</div>
			</div>
		</div>
	);
}
window.GraphMode = GraphMode;
