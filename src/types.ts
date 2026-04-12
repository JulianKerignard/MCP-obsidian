export interface NoteMeta {
  path: string;
  name: string;
  folder: string;
  extension: string;
  size: number;
  created: string;
  modified: string;
}

export interface NoteContent extends NoteMeta {
  content: string;
  frontmatter: Record<string, unknown> | null;
  tags: string[];
  links: string[];
}

export interface SearchResult {
  note: NoteMeta;
  matches: MatchContext[];
  score: number;
}

export interface MatchContext {
  line: number;
  text: string;
}

export interface VaultStats {
  totalNotes: number;
  totalFolders: number;
  totalSize: number;
  tags: Record<string, number>;
}
