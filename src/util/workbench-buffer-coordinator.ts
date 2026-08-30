export interface WorkbenchDirtyBuffer {
	applyRefactorTextEdits?(edits: readonly WorkbenchBufferTextEdit[]): boolean;
	bufferId: string;
	/** Temporarily prevents a new edit from racing an atomic core mutation. */
	closeAdmission?(): void;
	flush(): Promise<void> | void;
	hasPendingChanges(): boolean;
	isComposing?(): boolean;
	/** Restores admission after a mutation barrier has been released. */
	reopenAdmission?(): void;
	revision(): number;
	storyId: string;
	/** Canonical Core source identity; bufferId is renderer-local only. */
	sourceId?: string;
	sourceKind?: 'passage' | 'script' | 'stylesheet';
}

export interface WorkbenchReceiptSource {
	storyId: string;
	sourceId: string;
	sourceKind: 'passage' | 'script' | 'stylesheet';
}

export type WorkbenchReceiptDeliveryResult =
	'delivered' | 'not-registered' | 'rejected';

export class WorkbenchReceiptDeliveryError extends Error {
	readonly code = 'receipt-delivery-failed';
	constructor(readonly source: WorkbenchReceiptSource) {
		super(
			`Could not deliver the authoritative receipt for ${source.storyId}/${source.sourceKind}/${source.sourceId}.`
		);
		this.name = 'WorkbenchReceiptDeliveryError';
	}
}

export interface WorkbenchBufferTextEdit {
	end: number;
	expectedText: string;
	replacementText: string;
	start: number;
}

/** Retryable admission failure: no refactor plan has been created or applied. */
export class WorkbenchBufferCompositionError extends Error {
	readonly code = 'buffer-composing';
	constructor(bufferId: string) {
		super(`Workbench buffer "${bufferId}" is composing text.`);
		this.name = 'WorkbenchBufferCompositionError';
	}
}

export interface WorkbenchBufferSnapshot {
	buffer: WorkbenchDirtyBuffer;
	bufferId: string;
	registrationId: string;
	revision: number;
	storyId: string;
}

export interface WorkbenchBufferPrecondition {
	bufferId: string;
	generation: number;
	registrationId: string;
}

export interface WorkbenchStoryMutationBarrier {
	readonly preconditions: readonly WorkbenchBufferPrecondition[];
	/** Keyed by registration ID so duplicate editors for one source are retained. */
	readonly snapshots: ReadonlyMap<string, WorkbenchBufferSnapshot>;
	release(): void;
	isCurrent(): boolean;
	deliverTextEdits(
		source: WorkbenchReceiptSource,
		edits: readonly WorkbenchBufferTextEdit[]
	): WorkbenchReceiptDeliveryResult;
}

interface RegisteredBuffer {
	buffer: WorkbenchDirtyBuffer;
	registrationId: string;
}

const MAX_STABLE_FLUSH_ATTEMPTS = 3;

/**
 * Coordinates the workbench's renderer-local editor buffers with operations
 * that consume or retire a Rust project session. A flush is stable only when
 * no edit was admitted while the previous commit was awaiting Core.
 */
export class WorkbenchBufferCoordinator {
	private readonly activeAdmissions = new Map<string, Set<RegisteredBuffer>>();
	private readonly barriers = new Map<string, Promise<void>>();
	private readonly buffers = new Map<string, RegisteredBuffer>();
	private nextRegistrationId = 1;

	register(buffer: WorkbenchDirtyBuffer) {
		const registration: RegisteredBuffer = {
			buffer,
			registrationId: `buffer-registration-${this.nextRegistrationId++}`
		};

		this.buffers.set(registration.registrationId, registration);
		const admission = this.activeAdmissions.get(buffer.storyId);
		if (admission) {
			buffer.closeAdmission?.();
			admission.add(registration);
		}
		return () => {
			if (this.buffers.get(registration.registrationId) === registration) {
				this.buffers.delete(registration.registrationId);
			}
			this.activeAdmissions.get(buffer.storyId)?.delete(registration);
		};
	}

	async flushAll() {
		await this.flushBuffers([...this.buffers.values()]);
	}

	async flushStory(storyId: string) {
		await this.flushBuffers(this.storyBuffers(storyId));
	}

	/**
	 * Closes admission, flushes, and captures ABA-safe buffer snapshots. The
	 * caller must release the returned barrier in a finally block. Registrations
	 * made while it is held are immediately closed and included before capture.
	 */
	async acquireStoryMutationBarrier(
		storyId: string
	): Promise<WorkbenchStoryMutationBarrier> {
		const previous = this.barriers.get(storyId) ?? Promise.resolve();
		let releaseQueue!: () => void;
		const queued = new Promise<void>(resolve => {
			releaseQueue = resolve;
		});
		const tail = previous.then(() => queued);
		this.barriers.set(storyId, tail);
		await previous;

		let released = false;
		const admitted = new Set<RegisteredBuffer>();
		this.activeAdmissions.set(storyId, admitted);
		const release = () => {
			if (released) return;
			released = true;
			for (const registration of admitted) {
				registration.buffer.reopenAdmission?.();
			}
			this.activeAdmissions.delete(storyId);
			releaseQueue();
			if (this.barriers.get(storyId) === tail) {
				this.barriers.delete(storyId);
			}
		};

		try {
			for (;;) {
				const buffers = this.storyBuffers(storyId);
				for (const registration of buffers) {
					if (!admitted.has(registration)) {
						registration.buffer.closeAdmission?.();
						admitted.add(registration);
					}
				}
				const composing = buffers.find(({buffer}) => buffer.isComposing?.());
				if (composing) {
					throw new WorkbenchBufferCompositionError(composing.buffer.bufferId);
				}
				await this.flushBuffers(buffers);
				const current = this.storyBuffers(storyId);
				if (
					current.length === buffers.length &&
					current.every(buffer => buffers.some(flushed => flushed === buffer))
				) {
					break;
				}
			}
			const snapshots = new Map<string, WorkbenchBufferSnapshot>();
			for (const registration of admitted) {
				if (this.buffers.get(registration.registrationId) === registration) {
					const {buffer, registrationId} = registration;
					snapshots.set(registrationId, {
						buffer,
						bufferId: buffer.bufferId,
						registrationId,
						revision: buffer.revision(),
						storyId
					});
				}
			}
			const preconditions = [...snapshots.values()]
				.map(snapshot => ({
					bufferId: snapshot.bufferId,
					generation: snapshot.revision,
					registrationId: snapshot.registrationId
				}))
				.sort((left, right) =>
					left.registrationId.localeCompare(right.registrationId)
				);
			return {
				deliverTextEdits: (
					source: WorkbenchReceiptSource,
					edits: readonly WorkbenchBufferTextEdit[]
				) => {
					let matched = false;
					let rejected = false;
					for (const snapshot of snapshots.values()) {
						if (
							snapshot.storyId === source.storyId &&
							snapshot.buffer.sourceKind === source.sourceKind &&
							snapshot.buffer.sourceId === source.sourceId &&
							this.isSnapshotCurrent(
								source.storyId,
								snapshot.bufferId,
								snapshot
							)
						) {
							matched = true;
							if (snapshot.buffer.applyRefactorTextEdits?.(edits) !== true)
								rejected = true;
						}
					}
					return !matched
						? 'not-registered'
						: rejected
							? 'rejected'
							: 'delivered';
				},
				preconditions,
				release,
				snapshots,
				isCurrent: () =>
					admitted.size === snapshots.size &&
					[...admitted].every(registration =>
						snapshots.has(registration.registrationId)
					) &&
					[...snapshots.values()].every(snapshot =>
						this.isSnapshotCurrent(
							snapshot.storyId,
							snapshot.bufferId,
							snapshot
						)
					)
			};
		} catch (error) {
			release();
			throw error;
		}
	}

	async acquireStoriesMutationBarrier(storyIds: readonly string[]) {
		const barriers: WorkbenchStoryMutationBarrier[] = [];
		try {
			for (const storyId of [...new Set(storyIds)].sort()) {
				barriers.push(await this.acquireStoryMutationBarrier(storyId));
			}
			return {
				deliverTextEdits: (
					source: WorkbenchReceiptSource,
					edits: readonly WorkbenchBufferTextEdit[]
				) => {
					const results = barriers.map(barrier =>
						barrier.deliverTextEdits(source, edits)
					);
					return results.includes('rejected')
						? 'rejected'
						: results.includes('delivered')
							? 'delivered'
							: 'not-registered';
				},
				preconditions: barriers.flatMap(barrier => barrier.preconditions),
				release: () => {
					for (const barrier of [...barriers].reverse()) barrier.release();
				},
				snapshots: new Map(
					barriers.flatMap(barrier => [...barrier.snapshots.entries()])
				),
				isCurrent: () => barriers.every(barrier => barrier.isCurrent())
			};
		} catch (error) {
			for (const barrier of barriers.reverse()) barrier.release();
			throw error;
		}
	}

	hasPendingChanges(storyId?: string) {
		return [...this.buffers.values()].some(
			({buffer}) =>
				(storyId === undefined || buffer.storyId === storyId) &&
				buffer.hasPendingChanges()
		);
	}

	/** Captures both registration identity and edit revision for ABA-safe rollback. */
	captureSnapshot(storyId: string, bufferId: string) {
		const registration = [...this.buffers.values()]
			.reverse()
			.find(
				({buffer}) => buffer.storyId === storyId && buffer.bufferId === bufferId
			);
		if (!registration) return undefined;
		return {
			buffer: registration.buffer,
			bufferId,
			registrationId: registration.registrationId,
			revision: registration.buffer.revision(),
			storyId
		};
	}

	isSnapshotCurrent(
		storyId: string,
		bufferId: string,
		snapshot: WorkbenchBufferSnapshot | undefined
	) {
		const registration = snapshot
			? this.buffers.get(snapshot.registrationId)
			: undefined;
		return (
			!!snapshot &&
			registration?.buffer === snapshot.buffer &&
			snapshot.storyId === storyId &&
			snapshot.bufferId === bufferId &&
			snapshot.buffer.revision() === snapshot.revision
		);
	}

	/** Checks edit ownership after the buffer has intentionally unmounted. */
	isSnapshotRevisionCurrent(snapshot: WorkbenchBufferSnapshot | undefined) {
		return !!snapshot && snapshot.buffer.revision() === snapshot.revision;
	}

	private async flushBuffer(registration: RegisteredBuffer) {
		for (let attempt = 0; attempt < MAX_STABLE_FLUSH_ATTEMPTS; attempt++) {
			const revision = registration.buffer.revision();

			await registration.buffer.flush();
			if (
				registration.buffer.revision() === revision &&
				!registration.buffer.hasPendingChanges()
			) {
				return;
			}
		}
		throw new Error(
			`Workbench buffer "${registration.buffer.bufferId}" did not reach a stable flushed generation.`
		);
	}

	private async flushBuffers(buffers: RegisteredBuffer[]) {
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

	private storyBuffers(storyId: string) {
		return [...this.buffers.values()].filter(
			({buffer}) => buffer.storyId === storyId
		);
	}
}

export const workbenchBufferCoordinator = new WorkbenchBufferCoordinator();
