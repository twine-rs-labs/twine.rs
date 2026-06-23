/* Command palette overlay. Exports window.CommandPalette. */
function CommandPalette({ onClose }) {
	const groups = [
		{ label: 'Commands', items: [
			{ icon: 'layout-columns', label: 'Switch to Split Mode', kbd: '⌘3' },
			{ icon: 'binary-tree', label: 'Generate Graph Layout', kbd: '' },
			{ icon: 'package-export', label: 'Export HTML…', kbd: '⌘E' },
			{ icon: 'refresh', label: 'Rebuild Indexes', kbd: '' }
		] },
		{ label: 'Passages', items: [
			{ icon: 'file-text', label: 'The Keeper\u2019s Door', sub: 'passages/lighthouse', kbd: '' },
			{ icon: 'file-text', label: 'Marian\u2019s Letters', sub: 'passages/lighthouse', kbd: '' }
		] },
		{ label: 'Diagnostics', items: [
			{ icon: 'unlink', label: 'Tide Pools → broken link', sub: '1 error', tone: 'error', kbd: '' }
		] }
	];
	return (
		<div className="cp__scrim" onClick={onClose}>
			<div className="cp" onClick={e => e.stopPropagation()}>
				<div className="cp__input">
					<i className="ti ti-search" />
					<input autoFocus placeholder="Type a command, passage, file, tag, variable, asset, or setting" defaultValue="" />
					<span className="cp__esc">ESC</span>
				</div>
				<div className="cp__results">
					{groups.map(g => (
						<div key={g.label} className="cp__group">
							<div className="cp__group-label">{g.label}</div>
							{g.items.map((it, i) => (
								<div key={i} className={'cp__row' + (g.label === 'Commands' && i === 0 ? ' is-active' : '')}>
									<i className={'ti ti-' + it.icon + ' cp__ic'}
										style={{ color: it.tone === 'error' ? 'var(--sem-error)' : undefined }} />
									<span className="cp__label">{it.label}</span>
									{it.sub && <span className="cp__sub">{it.sub}</span>}
									{it.kbd && <span className="cp__kbd">{it.kbd}</span>}
								</div>
							))}
						</div>
					))}
				</div>
				<div className="cp__foot">
					<span><b>↑↓</b> navigate</span>
					<span><b>↵</b> run</span>
					<span><b>⌘P</b> files</span>
					<span><b>⌘⇧O</b> symbols</span>
				</div>
			</div>
		</div>
	);
}
window.CommandPalette = CommandPalette;
