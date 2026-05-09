export type CodeSymbol = {
  id: string;
  filePath: string;
  name: string;
  kind: "class" | "enum" | "file" | "function" | "interface" | "type" | "variable";
  signature: string;
  summary: string;
  line: number;
  language?: string;
  updatedAt: string;
};

export type SymbolSearchResult = CodeSymbol & {
  score: number;
};
