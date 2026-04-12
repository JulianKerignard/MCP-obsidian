/** Maximum character limit for a single response */
export const CHARACTER_LIMIT = 100_000;

/** Default number of results for list operations */
export const DEFAULT_LIMIT = 50;

/** Supported file extensions in an Obsidian vault */
export const SUPPORTED_EXTENSIONS = [".md", ".markdown"] as const;

/** Obsidian metadata regex patterns */
export const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;
export const TAG_REGEX = /#([a-zA-Z0-9_\-/]+)/g;
export const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
export const MARKDOWN_LINK_REGEX = /\[([^\]]*)\]\(([^)]+)\)/g;
