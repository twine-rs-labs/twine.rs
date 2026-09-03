import type {RefactorBufferPrecondition} from './bindings/RefactorBufferPrecondition';
import type {RefactorExternalPrecondition} from './bindings/RefactorExternalPrecondition';
import type {RefactorProviderPrecondition} from './bindings/RefactorProviderPrecondition';
import type {RefactorRuntimeState} from './bindings/RefactorRuntimeState';

/** An exact semantic capability; native editor registration alone is not one. */
export interface RefactorSemanticProviderDescriptor {
	capabilityRevision: number;
	formatVersion: string;
	identifier: string;
}

export interface RefactorRuntimeLease {
	release(): void;
}

/**
 * Owns renderer runtime facts for one Core project session. Its lease is
 * acquired before workbench barriers and the store mutation queue.
 */
export class RefactorRuntimeCoordinator {
	private readonly externalByStory = new Map<
		string,
		RefactorExternalPrecondition
	>();
	private readonly providerByStory = new Map<
		string,
		RefactorProviderPrecondition
	>();
	private leaseTail: Promise<void> = Promise.resolve();
	private nextProviderRegistrationId = 1;
	private readonly providerRegistrationByStory = new Map<string, number>();

	async acquireLease(): Promise<RefactorRuntimeLease> {
		const previous = this.leaseTail;
		let release!: () => void;
		const queued = new Promise<void>(resolve => {
			release = resolve;
		});
		this.leaseTail = previous.then(() => queued);
		await previous;
		let released = false;
		return {
			release: () => {
				if (released) return;
				released = true;
				release();
			}
		};
	}

	async recordExternalSession(
		storyIds: readonly string[],
		state: RefactorExternalPrecondition
	) {
		const lease = await this.acquireLease();
		try {
			for (const storyId of storyIds)
				this.externalByStory.set(storyId, {...state});
		} finally {
			lease.release();
		}
	}

	async clearExternalSession(
		storyIds: readonly string[],
		sessionInstanceId: string
	) {
		const lease = await this.acquireLease();
		try {
			for (const storyId of storyIds) {
				if (
					this.externalByStory.get(storyId)?.sessionInstanceId ===
					sessionInstanceId
				) {
					this.externalByStory.delete(storyId);
				}
			}
		} finally {
			lease.release();
		}
	}

	/** Registers an exact provider and returns an ABA-safe disposal callback. */
	async registerSemanticProvider(
		storyId: string,
		descriptor: RefactorSemanticProviderDescriptor
	) {
		const lease = await this.acquireLease();
		const registrationId = this.nextProviderRegistrationId++;
		try {
			this.providerRegistrationByStory.set(storyId, registrationId);
			this.providerByStory.set(storyId, {...descriptor});
		} finally {
			lease.release();
		}
		return async () => {
			const disposeLease = await this.acquireLease();
			try {
				if (this.providerRegistrationByStory.get(storyId) === registrationId) {
					this.providerRegistrationByStory.delete(storyId);
					this.providerByStory.delete(storyId);
				}
			} finally {
				disposeLease.release();
			}
		};
	}

	runtimeState(
		storyId: string,
		projectRevision: number,
		buffers: readonly RefactorBufferPrecondition[]
	): RefactorRuntimeState {
		const external = this.externalByStory.get(storyId);
		const provider = this.providerByStory.get(storyId);
		return {
			buffers: buffers.map(buffer => ({...buffer})),
			external: external ? {...external} : null,
			projectRevision,
			provider: provider ? {...provider} : null
		};
	}
}
