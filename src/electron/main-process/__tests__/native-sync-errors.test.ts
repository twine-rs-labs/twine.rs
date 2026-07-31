export {};

async function loadAdapter(createProjectFolderJson: jest.Mock) {
	const nativeRequire = jest.fn().mockReturnValue({createProjectFolderJson});

	jest.resetModules();
	jest.doMock('fs', () => ({existsSync: jest.fn(() => true)}));
	jest.doMock('module', () => ({
		createRequire: jest.fn(() => nativeRequire)
	}));

	return import('../native');
}

describe('native synchronous errors', () => {
	beforeEach(() => {
		process.env.TWINE_NATIVE = 'force';
	});

	afterEach(() => {
		delete process.env.TWINE_NATIVE;
	});

	it('propagates an Error value returned by an older addon before JSON parsing', async () => {
		const returnedError = Object.assign(
			new Error('A new project cannot replace an existing filesystem entry.'),
			{code: 'GenericFailure'}
		);
		const createProjectFolderJson = jest.fn(() => returnedError);
		const {createNativeProjectFolder, nativeProjectDiagnostic} =
			await loadAdapter(createProjectFolderJson);
		let caught: unknown;

		try {
			createNativeProjectFolder('/mock/project.twine.rs', {} as never);
		} catch (error) {
			caught = error;
		}

		expect(caught).toBe(returnedError);
		expect(nativeProjectDiagnostic()).toBe(
			'Native project backend project create failed: A new project cannot replace an existing filesystem entry.'
		);
	});
});
