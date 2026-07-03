export type NativeProjectDeltaDisposition = 'continue' | 'pause';

export interface NativeProjectDeltaIdentity {
	id: string;
	rootPath: string;
}

interface RootQueue<T> {
	items: T[];
	paused: boolean;
	running: boolean;
}

export class NativeProjectDeltaQueue<T extends NativeProjectDeltaIdentity> {
	private readonly roots = new Map<string, RootQueue<T>>();
	private readonly seenIds = new Set<string>();
	private readonly seenOrder: string[] = [];

	constructor(
		private readonly process: (
			delta: T
		) => Promise<NativeProjectDeltaDisposition>,
		private readonly onError: (error: Error, delta: T) => void
	) {}

	enqueue(delta: T) {
		if (this.seenIds.has(delta.id)) {
			return;
		}

		this.remember(delta.id);
		const root = this.roots.get(delta.rootPath) ?? {
			items: [],
			paused: false,
			running: false
		};

		root.items.push(delta);
		this.roots.set(delta.rootPath, root);
		void this.drain(delta.rootPath, root);
	}

	resume(rootPath: string) {
		const root = this.roots.get(rootPath);

		if (!root) {
			return;
		}

		root.paused = false;
		void this.drain(rootPath, root);
	}

	clearRoot(rootPath: string) {
		this.roots.delete(rootPath);
	}

	private async drain(rootPath: string, root: RootQueue<T>) {
		if (root.running || root.paused) {
			return;
		}

		root.running = true;
		try {
			while (!root.paused && root.items.length > 0) {
				const delta = root.items.shift()!;

				try {
					root.paused = (await this.process(delta)) === 'pause';
				} catch (error) {
					root.paused = true;
					this.onError(error as Error, delta);
				}
			}
		} finally {
			root.running = false;
			if (!root.paused && root.items.length === 0) {
				this.roots.delete(rootPath);
			}
		}
	}

	private remember(id: string) {
		this.seenIds.add(id);
		this.seenOrder.push(id);

		while (this.seenOrder.length > 512) {
			this.seenIds.delete(this.seenOrder.shift()!);
		}
	}
}
