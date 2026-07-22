export type NativeProjectDeltaDisposition = 'continue' | 'pause';

export interface NativeProjectDeltaIdentity {
	id: string;
	rootPath: string;
}

interface RootQueue<T> {
	abortController: AbortController;
	drainPromise?: Promise<void>;
	items: T[];
	paused: boolean;
	running: boolean;
}

export class NativeProjectDeltaQueue<T extends NativeProjectDeltaIdentity> {
	private readonly clearing = new Map<string, Promise<void>>();
	private readonly roots = new Map<string, RootQueue<T>>();
	private readonly seenIds = new Set<string>();
	private readonly seenOrder: string[] = [];
	private readonly seenRoots = new Map<string, string>();

	constructor(
		private readonly process: (
			delta: T,
			signal: AbortSignal
		) => Promise<NativeProjectDeltaDisposition>,
		private readonly onError: (error: Error, delta: T) => void
	) {}

	enqueue(delta: T) {
		if (this.seenIds.has(delta.id)) {
			return;
		}

		this.remember(delta.id, delta.rootPath);
		const root = this.roots.get(delta.rootPath) ?? {
			abortController: new AbortController(),
			items: [],
			paused: false,
			running: false
		};

		root.items.push(delta);
		this.roots.set(delta.rootPath, root);
		this.scheduleDrain(delta.rootPath, root);
	}

	resume(rootPath: string) {
		const root = this.roots.get(rootPath);

		if (!root) {
			return;
		}

		root.paused = false;
		this.scheduleDrain(rootPath, root);
	}

	clearRoot(rootPath: string) {
		this.forgetRoot(rootPath);
		const root = this.roots.get(rootPath);

		if (!root) {
			return this.clearing.get(rootPath);
		}

		root.abortController.abort();
		root.items.length = 0;
		root.paused = false;
		if (this.roots.get(rootPath) === root) {
			this.roots.delete(rootPath);
		}

		if (!root.drainPromise) {
			return this.clearing.get(rootPath);
		}

		const clearing = root.drainPromise.finally(() => {
			if (this.clearing.get(rootPath) === clearing) {
				this.clearing.delete(rootPath);
			}
		});

		this.clearing.set(rootPath, clearing);
		return clearing;
	}

	private scheduleDrain(rootPath: string, root: RootQueue<T>) {
		const clearing = this.clearing.get(rootPath);

		if (clearing) {
			void clearing.then(() => {
				if (this.roots.get(rootPath) === root) {
					this.scheduleDrain(rootPath, root);
				}
			});
			return;
		}

		void this.drain(rootPath, root);
	}

	private drain(rootPath: string, root: RootQueue<T>) {
		if (root.running || root.paused || root.abortController.signal.aborted) {
			return root.drainPromise;
		}

		root.running = true;
		root.drainPromise = (async () => {
			try {
				while (
					!root.paused &&
					!root.abortController.signal.aborted &&
					root.items.length > 0
				) {
					const delta = root.items.shift()!;

					try {
						const disposition = await this.process(
							delta,
							root.abortController.signal
						);

						if (!root.abortController.signal.aborted) {
							root.paused = disposition === 'pause';
						}
					} catch (error) {
						if (!root.abortController.signal.aborted) {
							root.paused = true;
							this.onError(error as Error, delta);
						}
					}
				}
			} finally {
				root.running = false;
				root.drainPromise = undefined;
				if (
					this.roots.get(rootPath) === root &&
					!root.paused &&
					root.items.length === 0
				) {
					this.roots.delete(rootPath);
				}
			}
		})();

		return root.drainPromise;
	}

	private forgetRoot(rootPath: string) {
		const forgotten = new Set<string>();

		for (const [id, seenRootPath] of this.seenRoots) {
			if (seenRootPath === rootPath) {
				this.seenIds.delete(id);
				this.seenRoots.delete(id);
				forgotten.add(id);
			}
		}
		for (let index = this.seenOrder.length - 1; index >= 0; index--) {
			if (forgotten.has(this.seenOrder[index])) {
				this.seenOrder.splice(index, 1);
			}
		}
	}

	private remember(id: string, rootPath: string) {
		this.seenIds.add(id);
		this.seenOrder.push(id);
		this.seenRoots.set(id, rootPath);

		while (this.seenOrder.length > 512) {
			const oldest = this.seenOrder.shift()!;

			this.seenIds.delete(oldest);
			this.seenRoots.delete(oldest);
		}
	}
}
