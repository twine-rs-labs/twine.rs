import {
	grantProjectCapability,
	projectCapabilityField,
	resolveProjectCapability,
	revokeProjectCapability
} from '../project-capabilities';

function capabilityOf(project: object) {
	return (
		project as typeof project & Record<typeof projectCapabilityField, string>
	)[projectCapabilityField];
}

describe('project capabilities', () => {
	it('resolves only an opaque token issued to the same renderer', () => {
		const sender = {};
		const otherSender = {};
		const granted = grantProjectCapability(
			{sender},
			{rootPath: '/projects/story.twine.rs', stories: [], storyIds: []}
		);
		const capability = capabilityOf(granted);

		expect(capability).toEqual(expect.any(String));
		expect(capability).not.toContain('/projects/');
		expect(resolveProjectCapability({sender}, capability!)).toBe(
			'/projects/story.twine.rs'
		);
		expect(() =>
			resolveProjectCapability({sender: otherSender}, capability!)
		).toThrow('Unknown or expired project capability');
		expect(() =>
			resolveProjectCapability({sender}, '/projects/story.twine.rs')
		).toThrow('Unknown or expired project capability');
	});

	it('reuses one token per renderer and canonical project root', () => {
		const sender = {};
		const project = {rootPath: '/projects/story.twine.rs'};
		const first = grantProjectCapability({sender}, project);
		const second = grantProjectCapability(
			{sender},
			{rootPath: '/projects/./story.twine.rs'}
		);

		expect(capabilityOf(first)).toBe(capabilityOf(second));
	});

	it('revokes deleted projects and does not authorize a replacement path', () => {
		const sender = {};
		const project = {rootPath: '/projects/story.twine.rs'};
		const first = grantProjectCapability({sender}, project);
		const firstCapability = capabilityOf(first);

		revokeProjectCapability({sender}, firstCapability);

		expect(() => resolveProjectCapability({sender}, firstCapability)).toThrow(
			'Unknown or expired project capability'
		);

		const replacement = grantProjectCapability({sender}, project);

		expect(capabilityOf(replacement)).not.toBe(firstCapability);
	});
});
