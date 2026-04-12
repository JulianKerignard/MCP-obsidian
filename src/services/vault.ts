import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import {
  SUPPORTED_EXTENSIONS,
  FRONTMATTER_REGEX,
  TAG_REGEX,
  WIKILINK_REGEX,
} from "../constants.js";
import type { NoteMeta, NoteContent, SearchResult, MatchContext, VaultStats } from "../types.js";

export class VaultService {
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = path.resolve(vaultPath);
  }

  /** Resolve a relative note path to an absolute path inside the vault */
  private resolve(notePath: string): string {
    const resolved = path.resolve(this.vaultPath, notePath);
    if (!resolved.startsWith(this.vaultPath)) {
      throw new Error(`Path traversal detected: "${notePath}" escapes the vault.`);
    }
    return resolved;
  }

  /** Ensure file has a markdown extension */
  private ensureExtension(notePath: string): string {
    const ext = path.extname(notePath);
    if (SUPPORTED_EXTENSIONS.includes(ext as typeof SUPPORTED_EXTENSIONS[number])) {
      return notePath;
    }
    return `${notePath}.md`;
  }

  /** Extract frontmatter YAML as a simple key-value map */
  private parseFrontmatter(content: string): Record<string, unknown> | null {
    const match = content.match(FRONTMATTER_REGEX);
    if (!match) return null;

    const yaml = match[1];
    const result: Record<string, unknown> = {};
    for (const line of yaml.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key) {
        // Try to parse arrays in [a, b] format
        if (value.startsWith("[") && value.endsWith("]")) {
          result[key] = value
            .slice(1, -1)
            .split(",")
            .map((v) => v.trim().replace(/^["']|["']$/g, ""));
        } else if (value === "true") {
          result[key] = true;
        } else if (value === "false") {
          result[key] = false;
        } else if (!isNaN(Number(value)) && value !== "") {
          result[key] = Number(value);
        } else {
          result[key] = value.replace(/^["']|["']$/g, "");
        }
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  /** Extract tags from note content (both frontmatter and inline) */
  private extractTags(content: string, frontmatter: Record<string, unknown> | null): string[] {
    const tags = new Set<string>();

    // Tags from frontmatter
    if (frontmatter?.tags) {
      const fmTags = Array.isArray(frontmatter.tags)
        ? frontmatter.tags
        : typeof frontmatter.tags === "string"
          ? frontmatter.tags.split(",").map((t: string) => t.trim())
          : [];
      for (const tag of fmTags) {
        tags.add(String(tag).replace(/^#/, ""));
      }
    }

    // Inline tags
    const bodyContent = content.replace(FRONTMATTER_REGEX, "");
    let match: RegExpExecArray | null;
    const tagRegex = new RegExp(TAG_REGEX.source, TAG_REGEX.flags);
    while ((match = tagRegex.exec(bodyContent)) !== null) {
      tags.add(match[1]);
    }

    return [...tags];
  }

  /** Extract wikilinks from note content */
  private extractLinks(content: string): string[] {
    const links = new Set<string>();
    const bodyContent = content.replace(FRONTMATTER_REGEX, "");
    let match: RegExpExecArray | null;
    const wikiRegex = new RegExp(WIKILINK_REGEX.source, WIKILINK_REGEX.flags);
    while ((match = wikiRegex.exec(bodyContent)) !== null) {
      links.add(match[1]);
    }
    return [...links];
  }

  /** Get file metadata */
  private async getNoteMeta(filePath: string): Promise<NoteMeta> {
    const stat = await fs.stat(filePath);
    const relative = path.relative(this.vaultPath, filePath);
    return {
      path: relative,
      name: path.basename(filePath, path.extname(filePath)),
      folder: path.dirname(relative) === "." ? "/" : path.dirname(relative),
      extension: path.extname(filePath),
      size: stat.size,
      created: stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString(),
    };
  }

  /** List all markdown notes in the vault */
  async listNotes(folder?: string, limit = 50, offset = 0): Promise<{
    notes: NoteMeta[];
    total: number;
    hasMore: boolean;
  }> {
    const searchBase = folder ? this.resolve(folder) : this.vaultPath;
    const pattern = `${searchBase}/**/*.md`;
    const files = await glob(pattern, { nodir: true, ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"] });

    files.sort();
    const total = files.length;
    const slice = files.slice(offset, offset + limit);
    const notes = await Promise.all(slice.map((f) => this.getNoteMeta(f)));

    return { notes, total, hasMore: offset + limit < total };
  }

  /** Read a specific note with full content and metadata */
  async readNote(notePath: string): Promise<NoteContent> {
    const fullPath = this.resolve(this.ensureExtension(notePath));
    const content = await fs.readFile(fullPath, "utf-8");
    const meta = await this.getNoteMeta(fullPath);
    const frontmatter = this.parseFrontmatter(content);
    const tags = this.extractTags(content, frontmatter);
    const links = this.extractLinks(content);

    return { ...meta, content, frontmatter, tags, links };
  }

  /** Create a new note */
  async createNote(notePath: string, content: string): Promise<NoteMeta> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);

    // Check if exists
    try {
      await fs.access(fullPath);
      throw new Error(`Note already exists: "${withExt}". Use obsidian_update_note to modify it.`);
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      if (err instanceof Error && !("code" in err)) throw err;
    }

    // Create directories if needed
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");

    return this.getNoteMeta(fullPath);
  }

  /** Update an existing note */
  async updateNote(notePath: string, content: string): Promise<NoteMeta> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);

    // Verify it exists
    await fs.access(fullPath);
    await fs.writeFile(fullPath, content, "utf-8");

    return this.getNoteMeta(fullPath);
  }

  /** Append content to an existing note */
  async appendToNote(notePath: string, content: string): Promise<NoteMeta> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);

    await fs.access(fullPath);
    await fs.appendFile(fullPath, `\n${content}`, "utf-8");

    return this.getNoteMeta(fullPath);
  }

  /** Delete a note */
  async deleteNote(notePath: string): Promise<{ deleted: string }> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);

    await fs.access(fullPath);
    await fs.unlink(fullPath);

    return { deleted: withExt };
  }

  /** Search notes by content or title */
  async searchNotes(
    query: string,
    options: { folder?: string; tagFilter?: string; limit?: number; caseSensitive?: boolean } = {}
  ): Promise<{ results: SearchResult[]; total: number }> {
    const { folder, tagFilter, limit = 20, caseSensitive = false } = options;
    const searchBase = folder ? this.resolve(folder) : this.vaultPath;
    const pattern = `${searchBase}/**/*.md`;
    const files = await glob(pattern, { nodir: true, ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"] });

    const searchQuery = caseSensitive ? query : query.toLowerCase();
    const results: SearchResult[] = [];

    for (const file of files) {
      const raw = await fs.readFile(file, "utf-8");
      const content = caseSensitive ? raw : raw.toLowerCase();
      const meta = await this.getNoteMeta(file);

      // Tag filter
      if (tagFilter) {
        const frontmatter = this.parseFrontmatter(raw);
        const tags = this.extractTags(raw, frontmatter);
        if (!tags.some((t) => t.toLowerCase() === tagFilter.toLowerCase())) continue;
      }

      // Search in content
      const lines = raw.split("\n");
      const matches: MatchContext[] = [];
      let score = 0;

      // Title match (higher score)
      const name = caseSensitive ? meta.name : meta.name.toLowerCase();
      if (name.includes(searchQuery)) {
        score += 10;
      }

      for (let i = 0; i < lines.length; i++) {
        const line = caseSensitive ? lines[i] : lines[i].toLowerCase();
        if (line.includes(searchQuery)) {
          matches.push({ line: i + 1, text: lines[i].trim() });
          score += 1;
        }
      }

      if (score > 0) {
        results.push({ note: meta, matches: matches.slice(0, 5), score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const total = results.length;

    return { results: results.slice(0, limit), total };
  }

  /** Find all notes that link to a given note (backlinks) */
  async getBacklinks(noteName: string): Promise<{ backlinks: Array<{ note: NoteMeta; contexts: string[] }> }> {
    const files = await glob(`${this.vaultPath}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    const target = noteName.replace(/\.md$/, "");
    const backlinks: Array<{ note: NoteMeta; contexts: string[] }> = [];

    for (const file of files) {
      const content = await fs.readFile(file, "utf-8");
      const links = this.extractLinks(content);

      const matchingLinks = links.filter((link) => link === target || link.endsWith(`/${target}`));
      if (matchingLinks.length > 0) {
        const meta = await this.getNoteMeta(file);
        const contexts: string[] = [];
        const lines = content.split("\n");
        for (const line of lines) {
          // Check if line contains a wikilink to any matching link variant
          if (matchingLinks.some((link) => line.includes(`[[${link}`)) || line.includes(`[[${target}`)) {
            contexts.push(line.trim());
          }
        }
        backlinks.push({ note: meta, contexts: contexts.slice(0, 3) });
      }
    }

    return { backlinks };
  }

  /** Get all tags across the vault */
  async getAllTags(): Promise<{ tags: Record<string, number>; total: number }> {
    const files = await glob(`${this.vaultPath}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    const tagCounts: Record<string, number> = {};

    for (const file of files) {
      const content = await fs.readFile(file, "utf-8");
      const frontmatter = this.parseFrontmatter(content);
      const tags = this.extractTags(content, frontmatter);
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    return { tags: tagCounts, total: Object.keys(tagCounts).length };
  }

  /** Get vault statistics */
  async getVaultStats(): Promise<VaultStats> {
    const files = await glob(`${this.vaultPath}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    const folders = new Set<string>();
    let totalSize = 0;
    const tagCounts: Record<string, number> = {};

    for (const file of files) {
      const stat = await fs.stat(file);
      totalSize += stat.size;
      const dir = path.dirname(path.relative(this.vaultPath, file));
      if (dir !== ".") folders.add(dir);

      const content = await fs.readFile(file, "utf-8");
      const frontmatter = this.parseFrontmatter(content);
      const tags = this.extractTags(content, frontmatter);
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    return {
      totalNotes: files.length,
      totalFolders: folders.size,
      totalSize,
      tags: tagCounts,
    };
  }

  /** List all folders in the vault */
  async listFolders(): Promise<string[]> {
    const files = await glob(`${this.vaultPath}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    const folders = new Set<string>();
    for (const file of files) {
      const dir = path.dirname(path.relative(this.vaultPath, file));
      if (dir !== ".") {
        // Add all parent folders too
        const parts = dir.split(path.sep);
        for (let i = 1; i <= parts.length; i++) {
          folders.add(parts.slice(0, i).join("/"));
        }
      }
    }

    return [...folders].sort();
  }
}
