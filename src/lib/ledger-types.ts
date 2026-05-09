export type RageLedgerState = {
  activeFilePath?: string;
  advice?: string;
  connectionState: string;
  frustration: number;
  isLocked: boolean;
  isRecalibrating: boolean;
  isScreenSharing: boolean;
  prompt?: string;
  reason?: string;
  updatedAt: string;
};

export type RageLedger = {
  latest: RageLedgerState | null;
  history: RageLedgerState[];
};
