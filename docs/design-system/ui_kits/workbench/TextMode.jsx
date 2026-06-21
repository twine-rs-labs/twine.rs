/* Text mode — Twine-aware source editor. Exports window.TextMode. */
const TM_NS = window.TwineRsDesignSystem_073217;

function highlight(line) {
	// lightweight twee/harlowe highlighter → array of {t, c}
	const out = [];
	let m;
	if ((m = line.match(/^(::\s*)([^\{#]+)(\{[^}]*\})?\s*(#.*)?$/))) {
		out.push({ t: m[1], c: 'pn' });
		out.push({ t: m[2].trimEnd(), c: 'title' });
		if (m[2].endsWith(' ')) out.push({ t: ' ', c: '' });
		if (m[3]) out.push({ t: ' ' + m[3] + ' ', c: 'meta' });
		if (m[4]) out.push({ t: m[4], c: 'tag' });
		return out;
	}
	if (/^\s*<!--/.test(line)) return [{ t: line, c: 'comment' }];
	// inline tokens
	const re = /(\[\[[^\]]*\]\])|(\([a-z-]+:)|(\$[a-zA-Z_]\w*)/g;
	let last = 0;
	while ((m = re.exec(line))) {
		if (m.index > last) out.push({ t: line.slice(last, m.index), c: '' });
		if (m[1]) out.push({ t: m[1], c: line.includes('Tide') && false ? 'broken' : 'link' });
		else if (m[2]) out.push({ t: m[2], c: 'macro' });
		else if (m[3]) out.push({ t: m[3], c: 'var' });
		last = re.lastIndex;
	}
	if (last < line.length) out.push({ t: line.slice(last), c: '' });
	return out.length ? out : [{ t: line, c: '' }];
}

function TextMode({ compact }) {
	const { Badge, IconButton, Tag } = TM_NS;
	const { tree, source } = window.TWINE_DATA;
	const diagLine = 11; // broken link squiggle target (Tide Pools)

	return (
		<div className={'tm' + (compact ? ' tm--compact' : '')}>
			{/* File tree */}
			{!compact && (
				<div className="tm__tree">
					<div className="tm__tree-head">
						<span className="tm__tree-title">the-lighthouse</span>
						<IconButton icon="dots" label="More" size="sm" />
					</div>
					<div className="tm__tree-body">
						{tree.map((n, i) => (
							<div key={i} className={'tm__row' + (n.name === 'arrival.twee' ? ' is-active' : '')}
								style={{ paddingLeft: 8 + n.depth * 14 + 'px' }}>
								{n.type === 'dir' && <i className={'ti ti-chevron-' + (n.open ? 'down' : 'right') + ' tm__caret'} />}
								<i className={'ti ti-' + (n.type === 'dir' ? (n.open ? 'folder-open' : 'folder') : n.icon) + ' tm__ficon'}
									style={{ color: n.type === 'dir' ? 'var(--sem-warn)' : undefined }} />
								<span className="tm__fname">{n.name}</span>
								{n.dirty && <span className="tm__dot" title="Unsaved" />}
								{n.broken && <i className="ti ti-unlink tm__broken" title="Broken link" />}
							</div>
						))}
					</div>
				</div>
			)}

			{/* Editor */}
			<div className="tm__editor">
				<div className="tm__tabs">
					<div className="tm__tab is-active">
						<i className="ti ti-file-text" /> arrival.twee <span className="tm__tab-dot" />
					</div>
					<div className="tm__tab">
						<i className="ti ti-file-text" /> gravel-path.twee
					</div>
					<div className="tm__tab">
						<i className="ti ti-braces" /> story.js
					</div>
					<div className="tm__tab-fill" />
					<IconButton icon="layout-columns" label="Split editor" size="sm" />
				</div>

				<div className="tm__crumb">
					<i className="ti ti-folder" /> passages <i className="ti ti-chevron-right tm__cr-sep" />
					<span className="tm__cr-cur">Arrival</span>
					<div className="tm__crumb-meta">
						<Badge tone="neutral" mono>Harlowe 3.3</Badge>
						<Badge tone="error" icon="unlink">1</Badge>
						<Badge tone="link" icon="arrow-up-right">2</Badge>
						<Badge tone="neutral" icon="arrow-back-up">5 backlinks</Badge>
					</div>
				</div>

				<div className="tm__code">
					{source.map((ln, i) => {
						const lineNo = i + 1;
						const isDiag = lineNo === diagLine;
						return (
							<div key={i} className={'tm__line' + (lineNo === 4 ? ' is-cursor' : '')}>
								<span className="tm__gutter">
									{isDiag && <i className="ti ti-point-filled tm__gmark" />}
									{lineNo}
								</span>
								<span className="tm__src">
									{highlight(ln).map((tok, j) => (
										<span key={j} className={tok.c ? 'h-' + tok.c : ''}>{tok.t}</span>
									))}
									{ln === '' && '\u200b'}
								</span>
							</div>
						);
					})}
				</div>

				{/* inline diagnostic chip */}
				<div className="tm__inline-diag">
					<i className="ti ti-alert-octagon" />
					<b>Broken link</b> &nbsp;[[tide pools below-&gt;Tide Pools]] — target has unsaved rename.
					<button className="tm__fix">Quick Fix</button>
				</div>
			</div>

			{/* Right outline */}
			{!compact && (
				<div className="tm__outline">
					<OutlineSection icon="arrow-up-right" title="Outgoing Links" count={2}>
						<OutlineItem color="var(--sem-link)" label="The Gravel Path" sub="line 4" />
						<OutlineItem color="var(--sem-error)" label="Tide Pools" sub="line 11 · broken" broken />
					</OutlineSection>
					<OutlineSection icon="arrow-back-up" title="Backlinks" count={5}>
						<OutlineItem color="var(--tx-4)" label="Title Screen" sub="ferry → arrival" />
						<OutlineItem color="var(--tx-4)" label="The Long Dark" sub="memory → arrival" />
						<OutlineItem color="var(--tx-4)" label="+ 3 more" sub="" muted />
					</OutlineSection>
					<OutlineSection icon="variable" title="Variables" count={2}>
						<OutlineItem color="var(--sem-var)" label="$arrived" sub="set · boolean" mono />
						<OutlineItem color="var(--sem-var)" label="$visitedBefore" sub="read · boolean" mono />
					</OutlineSection>
					<div className="tm__ol-tags">
						<span className="tm__ol-head"><i className="ti ti-tags" /> Tags</span>
						<div className="tm__ol-tagrow"><Tag color="blue">intro</Tag></div>
					</div>
				</div>
			)}
		</div>
	);
}

function OutlineSection({ icon, title, count, children }) {
	return (
		<div className="tm__ol-sec">
			<div className="tm__ol-head">
				<i className={'ti ti-' + icon} /> {title}
				<span className="tm__ol-count">{count}</span>
			</div>
			{children}
		</div>
	);
}
function OutlineItem({ color, label, sub, broken, muted, mono }) {
	return (
		<div className="tm__ol-item">
			<span className="tm__ol-dot" style={{ background: color }} />
			<span className={'tm__ol-label' + (mono ? ' is-mono' : '') + (muted ? ' is-muted' : '')}>{label}</span>
			{sub && <span className={'tm__ol-sub' + (broken ? ' is-broken' : '')}>{sub}</span>}
		</div>
	);
}
window.TextMode = TextMode;
