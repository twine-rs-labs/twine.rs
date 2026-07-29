export type ProjectFolderSaveHint =
	| {
			passageId: string;
			storyId: string;
			type: 'passageText';
	  }
	| {
			storyId: string;
			type: 'script' | 'stylesheet';
	  }
	| {
			passageId: string;
			storyId: string;
			type: 'passageMetadata';
	  }
	| {
			passageId: string;
			storyId: string;
			type: 'passageLayout';
	  }
	| {
			reason: string;
			storyId: string;
			type: 'full';
	  };

export type ProjectFolderDocumentUpdate =
	| {
			passageId: string;
			storyId: string;
			text: string;
			type: 'passageText';
	  }
	| {storyId: string; text: string; type: 'script' | 'stylesheet'};

export interface ProjectFolderExpectedFile {
	contentDigest?: string;
	fingerprint: string;
	kind:
		| 'manifest'
		| 'metadata'
		| 'graph'
		| 'passage'
		| 'script'
		| 'stylesheet'
		| 'asset';
	modifiedAt: string;
	mtimeMs: number;
	path: string;
	sizeBytes: number;
}

export interface ProjectFolderSaveOptions {
	documentUpdates?: ProjectFolderDocumentUpdate[];
	expectedFileBaseline?: ProjectFolderExpectedFile[];
	hints?: ProjectFolderSaveHint[];
	incrementalOnly?: boolean;
	revision?: number;
	sessionId?: string;
}
