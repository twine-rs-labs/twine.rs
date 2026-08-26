export interface WorkbenchDirtyBuffer {
	bufferId: string;
	flush(): Promise<void> | void;
	hasPendingChanges(): boolean;
	revision(): number;
	storyId: string;
}

export interface WorkbenchBufferSnapshot {
	buffer: WorkbenchDirtyBuffer;
	revision: number;
}

/**
 * Coordinates the workbench's renderer-local editor buffers with operations
 * that consume or retire a Rust project session. A flush is stable only when
 * no edit was admitted while the previous commit was awaiting Core.
 */
export class WorkbenchBufferCoordinator {
	private readonly buffers = new Map<string, WorkbenchDirtyBuffer>();

	register(buffer: WorkbenchDirtyBuffer) {
		const key = `${buffer.storyId}:${buffer.bufferId}`;

		this.buffers.set(key, buffer);
		return () => {
			if (this.buffers.get(key) === buffer) {
				this.buffers.delete(key);
			}
		};
	}

	async flushAll() {
		await this.flushBuffers([...this.buffers.values()]);
	}

	async flushStory(storyId: string) {
		await this.flushBuffers(
			[...this.buffers.values()].filter(buffer => buffer.storyId === storyId)
		);
	}

	hasPendingChanges(storyId?: string) {
		return [...this.buffers.values()].some(
			buffer =>
				(storyId === undefined || buffer.storyId === storyId) &&
				buffer.hasPendingChanges()
		);
	}

	/** Captures both registration identity and edit revision for ABA-safe rollback. */
	captureSnapshot(storyId: string, bufferId: string) {
		const buffer = this.buffers.get(`${storyId}:${bufferId}`);
		return buffer ? {buffer, revision: buffer.revision()} : undefined;
	}

	isSnapshotCurrent(
		storyId: string,
		bufferId: string,
		snapshot: WorkbenchBufferSnapshot | undefined
	) {
		return (
			!!snapshot &&
			this.buffers.get(`${storyId}:${bufferId}`) === snapshot.buffer &&
			snapshot.buffer.revision() === snapshot.revision
		);
	}

	/** Checks edit ownership after the buffer has intentionally unmounted. */
	isSnapshotRevisionCurrent(snapshot: WorkbenchBufferSnapshot | undefined) {
		return !!snapshot && snapshot.buffer.revision() === snapshot.revision;
	}

	private async flushBuffer(buffer: WorkbenchDirtyBuffer) {
		for (;;) {
			const revision = buffer.revision();

			await buffer.flush();
			if (buffer.revision() === revision && !buffer.hasPendingChanges()) {
				return;
			}
		}
	}

	private async flushBuffers(buffers: WorkbenchDirtyBuffer[]) {
		const results = await Promise.allSettled(
			buffers.map(buffer => this.flushBuffer(buffer))
		);
		const failures = results.flatMap(result =>
			result.status === 'rejected' ? [result.reason] : []
		);

		if (failures.length === 1) {
			throw failures[0];
		}
		if (failures.length > 1) {
			throw new AggregateError(
				failures,
				`${failures.length} workbench buffers could not be saved.`
			);
		}
	}
}

export const workbenchBufferCoordinator = new WorkbenchBufferCoordinator();
