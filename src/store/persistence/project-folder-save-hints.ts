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

export interface ProjectFolderSaveOptions {
	documentUpdates?: ProjectFolderDocumentUpdate[];
	hints?: ProjectFolderSaveHint[];
	incrementalOnly?: boolean;
	revision?: number;
	sessionId?: string;
}
