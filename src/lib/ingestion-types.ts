export type CodebaseIngestionStatus = {
  running: boolean;
  state: "idle" | "indexing" | "ready" | "error";
  symbolCount: number;
  recentFiles: string[];
  lastEventAt?: string;
  lastIndexedAt?: string;
  error?: string;
};
