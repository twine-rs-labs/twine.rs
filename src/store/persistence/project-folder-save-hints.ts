export type ProjectFolderSaveHint =
	| {
			passageId: string;
			storyId: string;
			type: 'passageText';
	  }
	| {
			reason: string;
			storyId: string;
			type: 'full';
	  };

export interface ProjectFolderSaveOptions {
	hints?: ProjectFolderSaveHint[];
	revision?: number;
	sessionId?: string;
}
