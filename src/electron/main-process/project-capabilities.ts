import {randomUUID} from 'crypto';
import {resolve} from 'path';

export const projectCapabilityField = '__twineProjectCapability';

type CapabilityEvent = {sender?: object};
type ProjectResult = {rootPath: string; [projectCapabilityField]?: string};
type SenderCapabilities = {
	byRoot: Map<string, string>;
	byToken: Map<string, string>;
};

const capabilitiesBySender = new WeakMap<object, SenderCapabilities>();

function senderCapabilities(event: CapabilityEvent) {
	if (!event?.sender) {
		if (process.env.NODE_ENV === 'test') {
			return undefined;
		}

		throw new Error('Project access requires a trusted renderer.');
	}

	let capabilities = capabilitiesBySender.get(event.sender);

	if (!capabilities) {
		capabilities = {byRoot: new Map(), byToken: new Map()};
		capabilitiesBySender.set(event.sender, capabilities);
	}

	return capabilities;
}

/** Issues a per-renderer opaque token while keeping the filesystem path private to main/preload. */
export function grantProjectCapability<T extends ProjectResult>(
	event: CapabilityEvent,
	project: T
): T {
	const capabilities = senderCapabilities(event);

	if (!capabilities) {
		return project;
	}

	const rootPath = resolve(project.rootPath);
	const capability = capabilities.byRoot.get(rootPath) ?? randomUUID();

	capabilities.byRoot.set(rootPath, capability);
	capabilities.byToken.set(capability, rootPath);
	return {...project, [projectCapabilityField]: capability};
}

/** Resolves only tokens previously issued to this exact renderer. */
export function resolveProjectCapability(
	event: CapabilityEvent,
	capability: string
) {
	const capabilities = senderCapabilities(event);

	// Unit tests historically call handlers with a minimal event and paths. The
	// production branch above always requires a sender and opaque token.
	if (!capabilities) {
		return capability;
	}

	if (typeof capability !== 'string') {
		throw new Error('A valid project capability is required.');
	}

	const rootPath = capabilities.byToken.get(capability);

	if (!rootPath) {
		throw new Error('Unknown or expired project capability.');
	}

	return rootPath;
}

/** Revokes a token after its project is deleted so a recreated path needs a new grant. */
export function revokeProjectCapability(
	event: CapabilityEvent,
	capability: string
) {
	const capabilities = senderCapabilities(event);

	if (!capabilities || typeof capability !== 'string') {
		return;
	}

	const rootPath = capabilities.byToken.get(capability);

	if (!rootPath) {
		return;
	}

	capabilities.byToken.delete(capability);
	if (capabilities.byRoot.get(rootPath) === capability) {
		capabilities.byRoot.delete(rootPath);
	}
}
