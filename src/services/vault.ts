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

  /** Move or rename a note */
  async moveNote(oldPath: string, newPath: string): Promise<NoteMeta> {
    const oldWithExt = this.ensureExtension(oldPath);
    const newWithExt = this.ensureExtension(newPath);
    const oldFull = this.resolve(oldWithExt);
    const newFull = this.resolve(newWithExt);

    // Verify source exists
    await fs.access(oldFull);

    // Check destination doesn't exist
    try {
      await fs.access(newFull);
      throw new Error(`Destination already exists: "${newWithExt}".`);
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      if (err instanceof Error && !("code" in err)) throw err;
    }

    // Create destination directory if needed
    await fs.mkdir(path.dirname(newFull), { recursive: true });
    await fs.rename(oldFull, newFull);

    return this.getNoteMeta(newFull);
  }

  /** Create a folder in the vault */
  async createFolder(folderPath: string): Promise<{ created: string }> {
    const fullPath = this.resolve(folderPath);
    await fs.mkdir(fullPath, { recursive: true });
    return { created: folderPath };
  }

  /** Update frontmatter fields without touching the body */
  async updateFrontmatter(
    notePath: string,
    fields: Record<string, unknown>,
    remove?: string[]
  ): Promise<NoteMeta> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);
    const raw = await fs.readFile(fullPath, "utf-8");

    const existing = this.parseFrontmatter(raw) || {};

    // Apply updates
    for (const [key, value] of Object.entries(fields)) {
      existing[key] = value;
    }

    // Remove keys
    if (remove) {
      for (const key of remove) {
        delete existing[key];
      }
    }

    // Serialize frontmatter
    const fmLines: string[] = [];
    for (const [key, value] of Object.entries(existing)) {
      if (Array.isArray(value)) {
        fmLines.push(`${key}: [${value.map((v) => String(v)).join(", ")}]`);
      } else {
        fmLines.push(`${key}: ${String(value)}`);
      }
    }
    const newFrontmatter = `---\n${fmLines.join("\n")}\n---`;

    // Replace or prepend frontmatter
    const match = raw.match(FRONTMATTER_REGEX);
    const newContent = match
      ? raw.replace(FRONTMATTER_REGEX, newFrontmatter)
      : `${newFrontmatter}\n\n${raw}`;

    await fs.writeFile(fullPath, newContent, "utf-8");
    return this.getNoteMeta(fullPath);
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

  /** Get or create today's daily note */
  async dailyNote(
    date?: string,
    folder = "Daily",
    template?: string
  ): Promise<NoteContent> {
    const d = date || new Date().toISOString().slice(0, 10);
    const notePath = `${folder}/${d}`;
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);

    try {
      await fs.access(fullPath);
    } catch {
      // Create with template or default content
      const content = template || `---\ndate: ${d}\n---\n\n# ${d}\n\n`;
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
    }

    return this.readNote(notePath);
  }

  /** Insert content under a specific heading */
  async insertAtHeading(
    notePath: string,
    heading: string,
    content: string,
    position: "beginning" | "end" = "end"
  ): Promise<NoteMeta> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);
    const raw = await fs.readFile(fullPath, "utf-8");
    const lines = raw.split("\n");

    // Find the heading line
    const headingRegex = new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
    const headingIdx = lines.findIndex((l) => headingRegex.test(l));
    if (headingIdx === -1) {
      throw new Error(`Heading "${heading}" not found in "${withExt}".`);
    }

    const headingLevel = lines[headingIdx].match(/^(#+)/)?.[1].length || 1;

    if (position === "beginning") {
      // Insert right after the heading line
      lines.splice(headingIdx + 1, 0, content);
    } else {
      // Find the next heading of same or higher level
      let insertIdx = lines.length;
      for (let i = headingIdx + 1; i < lines.length; i++) {
        const match = lines[i].match(/^(#+)\s/);
        if (match && match[1].length <= headingLevel) {
          insertIdx = i;
          break;
        }
      }
      // Insert before the next heading (or at end), with a blank line
      lines.splice(insertIdx, 0, content);
    }

    await fs.writeFile(fullPath, lines.join("\n"), "utf-8");
    return this.getNoteMeta(fullPath);
  }

  /** Find and replace text in a note */
  async replaceInNote(
    notePath: string,
    search: string,
    replace: string,
    all = false
  ): Promise<{ meta: NoteMeta; replacements: number }> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);
    const raw = await fs.readFile(fullPath, "utf-8");

    let count = 0;
    let newContent: string;

    if (all) {
      const parts = raw.split(search);
      count = parts.length - 1;
      newContent = parts.join(replace);
    } else {
      const idx = raw.indexOf(search);
      if (idx === -1) {
        throw new Error(`Text "${search.slice(0, 50)}..." not found in "${withExt}".`);
      }
      newContent = raw.slice(0, idx) + replace + raw.slice(idx + search.length);
      count = 1;
    }

    if (count === 0) {
      throw new Error(`Text "${search.slice(0, 50)}..." not found in "${withExt}".`);
    }

    await fs.writeFile(fullPath, newContent, "utf-8");
    const meta = await this.getNoteMeta(fullPath);
    return { meta, replacements: count };
  }

  /** Rename a tag across all notes in the vault */
  async renameTag(oldTag: string, newTag: string): Promise<{ filesModified: number }> {
    const files = await glob(`${this.vaultPath}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    let filesModified = 0;

    for (const file of files) {
      const raw = await fs.readFile(file, "utf-8");
      let modified = false;
      let content = raw;

      // Replace inline #tags
      const inlineRegex = new RegExp(`#${oldTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s,;.!?\\])}]|$)`, "g");
      if (inlineRegex.test(content)) {
        content = content.replace(inlineRegex, `#${newTag}`);
        modified = true;
      }

      // Replace in frontmatter tags arrays
      const fmMatch = content.match(FRONTMATTER_REGEX);
      if (fmMatch) {
        const fmBlock = fmMatch[0];
        const tagLineRegex = new RegExp(`(tags\\s*:.*)\\b${oldTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
        if (tagLineRegex.test(fmBlock)) {
          const newFmBlock = fmBlock.replace(tagLineRegex, `$1${newTag}`);
          content = content.replace(fmBlock, newFmBlock);
          modified = true;
        }
      }

      if (modified) {
        await fs.writeFile(file, content, "utf-8");
        filesModified++;
      }
    }

    return { filesModified };
  }

  /** Find orphan notes (notes with no backlinks) */
  async listOrphans(): Promise<{ orphans: NoteMeta[]; total: number }> {
    const files = await glob(`${this.vaultPath}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    // Collect all wikilink targets across the vault
    const linkedNames = new Set<string>();
    for (const file of files) {
      const content = await fs.readFile(file, "utf-8");
      const links = this.extractLinks(content);
      for (const link of links) {
        linkedNames.add(link.toLowerCase());
      }
    }

    // Find notes that are never linked to
    const orphans: NoteMeta[] = [];
    for (const file of files) {
      const meta = await this.getNoteMeta(file);
      const name = meta.name.toLowerCase();
      const pathNoExt = meta.path.replace(/\.md$/, "").toLowerCase();
      if (!linkedNames.has(name) && !linkedNames.has(pathNoExt)) {
        orphans.push(meta);
      }
    }

    return { orphans, total: orphans.length };
  }

  /** List notes sorted by modification date (most recent first) */
  async listRecentNotes(
    limit = 20,
    folder?: string,
    days?: number
  ): Promise<{ notes: NoteMeta[]; total: number }> {
    const searchBase = folder ? this.resolve(folder) : this.vaultPath;
    const files = await glob(`${searchBase}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    const metas = await Promise.all(files.map((f) => this.getNoteMeta(f)));
    let filtered = metas;

    if (days !== undefined) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      filtered = metas.filter((m) => new Date(m.modified).getTime() >= cutoff);
    }

    filtered.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    return { notes: filtered.slice(0, limit), total: filtered.length };
  }

  /** Search notes by frontmatter field values */
  async searchByFrontmatter(
    filters: Record<string, unknown>,
    limit = 50
  ): Promise<{ results: Array<{ note: NoteMeta; frontmatter: Record<string, unknown> }>; total: number }> {
    const files = await glob(`${this.vaultPath}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    const results: Array<{ note: NoteMeta; frontmatter: Record<string, unknown> }> = [];

    for (const file of files) {
      const raw = await fs.readFile(file, "utf-8");
      const fm = this.parseFrontmatter(raw);
      if (!fm) continue;

      let match = true;
      for (const [key, expected] of Object.entries(filters)) {
        const actual = fm[key];
        if (actual === undefined) {
          match = false;
          break;
        }
        if (Array.isArray(actual)) {
          if (!actual.includes(expected as never)) {
            match = false;
            break;
          }
        } else if (String(actual) !== String(expected)) {
          match = false;
          break;
        }
      }

      if (match) {
        const meta = await this.getNoteMeta(file);
        results.push({ note: meta, frontmatter: fm });
      }
    }

    return { results: results.slice(0, limit), total: results.length };
  }

  /** Search notes with a regex pattern */
  async searchRegex(
    pattern: string,
    flags = "i",
    folder?: string,
    limit = 20
  ): Promise<{ results: Array<{ note: NoteMeta; matches: Array<{ line: number; text: string; groups: string[] }> }>; total: number }> {
    const searchBase = folder ? this.resolve(folder) : this.vaultPath;
    const files = await glob(`${searchBase}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch (err) {
      throw new Error(`Invalid regex: ${err instanceof Error ? err.message : String(err)}`);
    }

    const results: Array<{ note: NoteMeta; matches: Array<{ line: number; text: string; groups: string[] }> }> = [];

    for (const file of files) {
      const raw = await fs.readFile(file, "utf-8");
      const lines = raw.split("\n");
      const matches: Array<{ line: number; text: string; groups: string[] }> = [];

      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(regex);
        if (m) {
          matches.push({ line: i + 1, text: lines[i].trim(), groups: m.slice(1) });
        }
      }

      if (matches.length > 0) {
        const meta = await this.getNoteMeta(file);
        results.push({ note: meta, matches: matches.slice(0, 5) });
      }
    }

    return { results: results.slice(0, limit), total: results.length };
  }

  /** Get outgoing links from a note */
  async getOutgoingLinks(notePath: string): Promise<{ links: string[]; resolved: Array<{ link: string; exists: boolean; path?: string }> }> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);
    const content = await fs.readFile(fullPath, "utf-8");
    const links = this.extractLinks(content);

    const allFiles = await glob(`${this.vaultPath}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });
    const existing = new Map<string, string>();
    for (const f of allFiles) {
      const rel = path.relative(this.vaultPath, f);
      const name = path.basename(f, path.extname(f));
      existing.set(name.toLowerCase(), rel);
      existing.set(rel.replace(/\.md$/, "").toLowerCase(), rel);
    }

    const resolved = links.map((link) => {
      const match = existing.get(link.toLowerCase());
      return match ? { link, exists: true, path: match } : { link, exists: false };
    });

    return { links, resolved };
  }

  /** Get content of a specific section (under a heading) */
  async getSection(notePath: string, heading: string): Promise<{ heading: string; content: string; level: number }> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);
    const raw = await fs.readFile(fullPath, "utf-8");
    const lines = raw.split("\n");

    const headingRegex = new RegExp(`^(#+)\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
    const headingIdx = lines.findIndex((l) => headingRegex.test(l));
    if (headingIdx === -1) {
      throw new Error(`Heading "${heading}" not found in "${withExt}".`);
    }

    const level = lines[headingIdx].match(/^(#+)/)?.[1].length || 1;

    let endIdx = lines.length;
    for (let i = headingIdx + 1; i < lines.length; i++) {
      const match = lines[i].match(/^(#+)\s/);
      if (match && match[1].length <= level) {
        endIdx = i;
        break;
      }
    }

    return {
      heading: lines[headingIdx],
      content: lines.slice(headingIdx + 1, endIdx).join("\n").trim(),
      level,
    };
  }

  /** Delete a section (heading + content until next same-level heading) */
  async deleteSection(notePath: string, heading: string): Promise<NoteMeta> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);
    const raw = await fs.readFile(fullPath, "utf-8");
    const lines = raw.split("\n");

    const headingRegex = new RegExp(`^(#+)\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
    const headingIdx = lines.findIndex((l) => headingRegex.test(l));
    if (headingIdx === -1) {
      throw new Error(`Heading "${heading}" not found in "${withExt}".`);
    }

    const level = lines[headingIdx].match(/^(#+)/)?.[1].length || 1;

    let endIdx = lines.length;
    for (let i = headingIdx + 1; i < lines.length; i++) {
      const match = lines[i].match(/^(#+)\s/);
      if (match && match[1].length <= level) {
        endIdx = i;
        break;
      }
    }

    lines.splice(headingIdx, endIdx - headingIdx);
    await fs.writeFile(fullPath, lines.join("\n"), "utf-8");
    return this.getNoteMeta(fullPath);
  }

  /** Copy a note to a new location */
  async copyNote(srcPath: string, destPath: string): Promise<NoteMeta> {
    const srcWithExt = this.ensureExtension(srcPath);
    const destWithExt = this.ensureExtension(destPath);
    const srcFull = this.resolve(srcWithExt);
    const destFull = this.resolve(destWithExt);

    const content = await fs.readFile(srcFull, "utf-8");

    try {
      await fs.access(destFull);
      throw new Error(`Destination already exists: "${destWithExt}".`);
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      if (err instanceof Error && !("code" in err)) throw err;
    }

    await fs.mkdir(path.dirname(destFull), { recursive: true });
    await fs.writeFile(destFull, content, "utf-8");
    return this.getNoteMeta(destFull);
  }

  /** Prepend content to a note (at the beginning, after frontmatter if present) */
  async prependToNote(notePath: string, content: string): Promise<NoteMeta> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);
    const raw = await fs.readFile(fullPath, "utf-8");

    const fmMatch = raw.match(FRONTMATTER_REGEX);
    let newContent: string;
    if (fmMatch) {
      const fmBlock = fmMatch[0];
      const rest = raw.slice(fmBlock.length);
      newContent = `${fmBlock}\n\n${content}${rest}`;
    } else {
      newContent = `${content}\n${raw}`;
    }

    await fs.writeFile(fullPath, newContent, "utf-8");
    return this.getNoteMeta(fullPath);
  }

  /** Add or remove a tag on multiple notes at once */
  async bulkTag(
    paths: string[],
    tag: string,
    action: "add" | "remove"
  ): Promise<{ modified: number; skipped: string[] }> {
    const cleanTag = tag.replace(/^#/, "");
    let modified = 0;
    const skipped: string[] = [];

    for (const notePath of paths) {
      try {
        const withExt = this.ensureExtension(notePath);
        const fullPath = this.resolve(withExt);
        const raw = await fs.readFile(fullPath, "utf-8");

        const fm = this.parseFrontmatter(raw) || {};
        const currentTags = Array.isArray(fm.tags)
          ? (fm.tags as string[]).map((t) => String(t).replace(/^#/, ""))
          : typeof fm.tags === "string"
            ? (fm.tags as string).split(",").map((t) => t.trim().replace(/^#/, ""))
            : [];

        const hasTag = currentTags.includes(cleanTag);

        if (action === "add" && !hasTag) {
          fm.tags = [...currentTags, cleanTag];
        } else if (action === "remove" && hasTag) {
          fm.tags = currentTags.filter((t) => t !== cleanTag);
        } else {
          skipped.push(notePath);
          continue;
        }

        // Serialize frontmatter
        const fmLines: string[] = [];
        for (const [key, value] of Object.entries(fm)) {
          if (Array.isArray(value)) {
            fmLines.push(`${key}: [${value.map((v) => String(v)).join(", ")}]`);
          } else {
            fmLines.push(`${key}: ${String(value)}`);
          }
        }
        const newFm = `---\n${fmLines.join("\n")}\n---`;

        const fmMatch = raw.match(FRONTMATTER_REGEX);
        const newContent = fmMatch ? raw.replace(FRONTMATTER_REGEX, newFm) : `${newFm}\n\n${raw}`;
        await fs.writeFile(fullPath, newContent, "utf-8");
        modified++;
      } catch {
        skipped.push(notePath);
      }
    }

    return { modified, skipped };
  }

  /** Extract all tasks (- [ ] and - [x]) across the vault */
  async listTasks(
    folder?: string,
    status: "open" | "done" | "all" = "open",
    limit = 100
  ): Promise<{ tasks: Array<{ path: string; line: number; text: string; done: boolean }>; total: number }> {
    const searchBase = folder ? this.resolve(folder) : this.vaultPath;
    const files = await glob(`${searchBase}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    const taskRegex = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/;
    const tasks: Array<{ path: string; line: number; text: string; done: boolean }> = [];

    for (const file of files) {
      const raw = await fs.readFile(file, "utf-8");
      const lines = raw.split("\n");
      const rel = path.relative(this.vaultPath, file);

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(taskRegex);
        if (!match) continue;
        const done = match[1].toLowerCase() === "x";
        if (status === "open" && done) continue;
        if (status === "done" && !done) continue;
        tasks.push({ path: rel, line: i + 1, text: match[2].trim(), done });
      }
    }

    return { tasks: tasks.slice(0, limit), total: tasks.length };
  }

  /** Toggle (or set) a task's state in a note */
  async toggleTask(
    notePath: string,
    taskText: string,
    done?: boolean
  ): Promise<{ meta: NoteMeta; newState: boolean }> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);
    const raw = await fs.readFile(fullPath, "utf-8");
    const lines = raw.split("\n");

    const taskRegex = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(.+)$/;
    let foundIdx = -1;
    let currentDone = false;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(taskRegex);
      if (match && match[4].trim() === taskText.trim()) {
        foundIdx = i;
        currentDone = match[2].toLowerCase() === "x";
        break;
      }
    }

    if (foundIdx === -1) {
      throw new Error(`Task "${taskText.slice(0, 50)}..." not found in "${withExt}".`);
    }

    const newState = done !== undefined ? done : !currentDone;
    const newChar = newState ? "x" : " ";
    lines[foundIdx] = lines[foundIdx].replace(taskRegex, `$1${newChar}$3$4`);

    await fs.writeFile(fullPath, lines.join("\n"), "utf-8");
    return { meta: await this.getNoteMeta(fullPath), newState };
  }

  /** List all headings in a note (table of contents) */
  async listHeadings(notePath: string): Promise<{ headings: Array<{ level: number; text: string; line: number }> }> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);
    const raw = await fs.readFile(fullPath, "utf-8");
    const lines = raw.split("\n");

    const headings: Array<{ level: number; text: string; line: number }> = [];
    const headingRegex = /^(#{1,6})\s+(.+)$/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(headingRegex);
      if (match) {
        headings.push({ level: match[1].length, text: match[2].trim(), line: i + 1 });
      }
    }

    return { headings };
  }

  /** List non-markdown attachments in the vault */
  async listAttachments(
    folder?: string,
    extensions?: string[]
  ): Promise<{ attachments: Array<{ path: string; extension: string; size: number }>; total: number }> {
    const searchBase = folder ? this.resolve(folder) : this.vaultPath;
    const files = await glob(`${searchBase}/**/*`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    const mdExts = new Set(SUPPORTED_EXTENSIONS);
    const filterExts = extensions?.map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase());
    const attachments: Array<{ path: string; extension: string; size: number }> = [];

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (mdExts.has(ext as typeof SUPPORTED_EXTENSIONS[number])) continue;
      if (filterExts && !filterExts.includes(ext)) continue;

      try {
        const stat = await fs.stat(file);
        attachments.push({
          path: path.relative(this.vaultPath, file),
          extension: ext,
          size: stat.size,
        });
      } catch {
        // Skip unreadable files
      }
    }

    return { attachments, total: attachments.length };
  }

  /** Find attachments that are never referenced in any note */
  async findUnusedAttachments(): Promise<{ unused: Array<{ path: string; size: number }>; total: number }> {
    const allFiles = await glob(`${this.vaultPath}/**/*`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    const mdExts = new Set(SUPPORTED_EXTENSIONS);
    const mdFiles: string[] = [];
    const attachments: string[] = [];

    for (const file of allFiles) {
      const ext = path.extname(file).toLowerCase();
      if (mdExts.has(ext as typeof SUPPORTED_EXTENSIONS[number])) {
        mdFiles.push(file);
      } else {
        attachments.push(file);
      }
    }

    // Collect all references in markdown files (wikilinks and markdown links)
    const referenced = new Set<string>();
    const embedRegex = /!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    const mdLinkRegex = /!?\[[^\]]*\]\(([^)]+)\)/g;

    for (const file of mdFiles) {
      const content = await fs.readFile(file, "utf-8");
      let m: RegExpExecArray | null;

      const embedRe = new RegExp(embedRegex.source, embedRegex.flags);
      while ((m = embedRe.exec(content)) !== null) {
        referenced.add(path.basename(m[1]).toLowerCase());
      }

      const mdRe = new RegExp(mdLinkRegex.source, mdLinkRegex.flags);
      while ((m = mdRe.exec(content)) !== null) {
        const link = decodeURIComponent(m[1].split("#")[0].split("?")[0]);
        referenced.add(path.basename(link).toLowerCase());
      }

      const wikiRe = new RegExp(WIKILINK_REGEX.source, WIKILINK_REGEX.flags);
      while ((m = wikiRe.exec(content)) !== null) {
        referenced.add(path.basename(m[1]).toLowerCase());
      }
    }

    const unused: Array<{ path: string; size: number }> = [];
    for (const file of attachments) {
      const basename = path.basename(file).toLowerCase();
      const basenameNoExt = path.basename(file, path.extname(file)).toLowerCase();
      if (!referenced.has(basename) && !referenced.has(basenameNoExt)) {
        try {
          const stat = await fs.stat(file);
          unused.push({ path: path.relative(this.vaultPath, file), size: stat.size });
        } catch {
          // Skip
        }
      }
    }

    return { unused, total: unused.length };
  }

  /** Update all wikilinks pointing to a renamed note */
  async updateLinks(oldName: string, newName: string): Promise<{ filesModified: number; totalReplacements: number }> {
    const files = await glob(`${this.vaultPath}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    const oldTarget = oldName.replace(/\.md$/, "");
    const newTarget = newName.replace(/\.md$/, "");

    // Match [[oldName]] or [[oldName|alias]] or ![[oldName]]
    const escaped = oldTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const linkRegex = new RegExp(`(!?\\[\\[)${escaped}(\\||\\]\\])`, "g");

    let filesModified = 0;
    let totalReplacements = 0;

    for (const file of files) {
      const raw = await fs.readFile(file, "utf-8");
      const matches = raw.match(linkRegex);
      if (!matches) continue;

      const newContent = raw.replace(linkRegex, `$1${newTarget}$2`);
      await fs.writeFile(file, newContent, "utf-8");
      filesModified++;
      totalReplacements += matches.length;
    }

    return { filesModified, totalReplacements };
  }

  /** Merge multiple notes into a single destination note */
  async mergeNotes(
    sources: string[],
    destination: string,
    separator = "\n\n---\n\n",
    deleteSources = false
  ): Promise<{ meta: NoteMeta; mergedCount: number; deleted: string[] }> {
    const destWithExt = this.ensureExtension(destination);
    const destFull = this.resolve(destWithExt);

    // Check destination doesn't exist
    try {
      await fs.access(destFull);
      throw new Error(`Destination already exists: "${destWithExt}". Delete it first or use a different path.`);
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      if (err instanceof Error && !("code" in err)) throw err;
    }

    // Read all sources
    const contents: string[] = [];
    const sourceFulls: string[] = [];
    for (const src of sources) {
      const withExt = this.ensureExtension(src);
      const full = this.resolve(withExt);
      const raw = await fs.readFile(full, "utf-8");
      // Strip frontmatter from non-first notes to avoid duplicates
      const stripped = contents.length === 0 ? raw : raw.replace(FRONTMATTER_REGEX, "").trimStart();
      const header = `## From: ${path.basename(withExt, path.extname(withExt))}\n\n`;
      contents.push(contents.length === 0 ? raw : `${header}${stripped}`);
      sourceFulls.push(full);
    }

    await fs.mkdir(path.dirname(destFull), { recursive: true });
    await fs.writeFile(destFull, contents.join(separator), "utf-8");

    const deleted: string[] = [];
    if (deleteSources) {
      for (let i = 0; i < sourceFulls.length; i++) {
        try {
          await fs.unlink(sourceFulls[i]);
          deleted.push(sources[i]);
        } catch {
          // Skip
        }
      }
    }

    return { meta: await this.getNoteMeta(destFull), mergedCount: sources.length, deleted };
  }

  /** Get top notes by incoming link count */
  async mostLinked(limit = 20): Promise<{ notes: Array<{ note: NoteMeta; backlinkCount: number }>; total: number }> {
    const files = await glob(`${this.vaultPath}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    // Count incoming links per note name
    const linkCounts = new Map<string, number>();
    for (const file of files) {
      const content = await fs.readFile(file, "utf-8");
      const links = this.extractLinks(content);
      for (const link of links) {
        const name = path.basename(link).toLowerCase();
        linkCounts.set(name, (linkCounts.get(name) || 0) + 1);
      }
    }

    const ranked: Array<{ note: NoteMeta; backlinkCount: number }> = [];
    for (const file of files) {
      const meta = await this.getNoteMeta(file);
      const count = linkCounts.get(meta.name.toLowerCase()) || 0;
      if (count > 0) ranked.push({ note: meta, backlinkCount: count });
    }

    ranked.sort((a, b) => b.backlinkCount - a.backlinkCount);
    return { notes: ranked.slice(0, limit), total: ranked.length };
  }

  /** Get detailed stats for a single note */
  async getNoteStats(notePath: string): Promise<{
    path: string;
    words: number;
    characters: number;
    lines: number;
    headings: number;
    links: number;
    tags: number;
    tasks: { total: number; done: number; open: number };
    readingTimeMinutes: number;
  }> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);
    const raw = await fs.readFile(fullPath, "utf-8");
    const body = raw.replace(FRONTMATTER_REGEX, "");

    const words = body.split(/\s+/).filter(Boolean).length;
    const characters = body.length;
    const lines = body.split("\n").length;
    const headings = (body.match(/^#{1,6}\s+/gm) || []).length;
    const fm = this.parseFrontmatter(raw);
    const links = this.extractLinks(raw).length;
    const tags = this.extractTags(raw, fm).length;

    const taskMatches = body.matchAll(/^\s*[-*]\s+\[([ xX])\]\s+/gm);
    let taskTotal = 0;
    let taskDone = 0;
    for (const m of taskMatches) {
      taskTotal++;
      if (m[1].toLowerCase() === "x") taskDone++;
    }

    return {
      path: path.relative(this.vaultPath, fullPath),
      words,
      characters,
      lines,
      headings,
      links,
      tags,
      tasks: { total: taskTotal, done: taskDone, open: taskTotal - taskDone },
      readingTimeMinutes: Math.ceil(words / 200),
    };
  }

  /** Add a tag to a single note (frontmatter or inline) */
  async addTag(
    notePath: string,
    tag: string,
    location: "frontmatter" | "inline" = "frontmatter"
  ): Promise<NoteMeta> {
    const cleanTag = tag.replace(/^#/, "");
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);
    const raw = await fs.readFile(fullPath, "utf-8");

    if (location === "inline") {
      // Append inline #tag at the end
      const newContent = raw.endsWith("\n") ? `${raw}#${cleanTag}\n` : `${raw}\n#${cleanTag}\n`;
      await fs.writeFile(fullPath, newContent, "utf-8");
    } else {
      // Update frontmatter tags array
      const fm = this.parseFrontmatter(raw) || {};
      const current = Array.isArray(fm.tags)
        ? (fm.tags as string[]).map((t) => String(t).replace(/^#/, ""))
        : typeof fm.tags === "string"
          ? (fm.tags as string).split(",").map((t) => t.trim().replace(/^#/, ""))
          : [];

      if (current.includes(cleanTag)) return this.getNoteMeta(fullPath);
      fm.tags = [...current, cleanTag];

      const fmLines: string[] = [];
      for (const [key, value] of Object.entries(fm)) {
        if (Array.isArray(value)) {
          fmLines.push(`${key}: [${value.map((v) => String(v)).join(", ")}]`);
        } else {
          fmLines.push(`${key}: ${String(value)}`);
        }
      }
      const newFm = `---\n${fmLines.join("\n")}\n---`;
      const fmMatch = raw.match(FRONTMATTER_REGEX);
      const newContent = fmMatch ? raw.replace(FRONTMATTER_REGEX, newFm) : `${newFm}\n\n${raw}`;
      await fs.writeFile(fullPath, newContent, "utf-8");
    }

    return this.getNoteMeta(fullPath);
  }

  /** Remove a tag from a note (both frontmatter and inline) */
  async removeTag(notePath: string, tag: string): Promise<{ meta: NoteMeta; removed: number }> {
    const cleanTag = tag.replace(/^#/, "");
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);
    let raw = await fs.readFile(fullPath, "utf-8");
    let removed = 0;

    // Remove from frontmatter
    const fm = this.parseFrontmatter(raw);
    if (fm) {
      let updated = false;
      if (Array.isArray(fm.tags)) {
        const filtered = (fm.tags as string[]).filter((t) => String(t).replace(/^#/, "") !== cleanTag);
        if (filtered.length !== fm.tags.length) {
          removed += (fm.tags as string[]).length - filtered.length;
          fm.tags = filtered;
          updated = true;
        }
      }
      if (updated) {
        const fmLines: string[] = [];
        for (const [key, value] of Object.entries(fm)) {
          if (Array.isArray(value)) {
            fmLines.push(`${key}: [${value.map((v) => String(v)).join(", ")}]`);
          } else {
            fmLines.push(`${key}: ${String(value)}`);
          }
        }
        const newFm = `---\n${fmLines.join("\n")}\n---`;
        raw = raw.replace(FRONTMATTER_REGEX, newFm);
      }
    }

    // Remove inline #tag (only in body, not in frontmatter)
    const fmMatch = raw.match(FRONTMATTER_REGEX);
    const fmBlock = fmMatch ? fmMatch[0] : "";
    const body = fmMatch ? raw.slice(fmBlock.length) : raw;
    const inlineRegex = new RegExp(`\\s*#${cleanTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s,;.!?\\])}]|$)`, "g");
    const matches = body.match(inlineRegex);
    if (matches) {
      removed += matches.length;
      const newBody = body.replace(inlineRegex, "");
      raw = fmBlock + newBody;
    }

    await fs.writeFile(fullPath, raw, "utf-8");
    return { meta: await this.getNoteMeta(fullPath), removed };
  }

  /** Add a wikilink to a note */
  async addLink(
    notePath: string,
    target: string,
    alias?: string,
    heading?: string
  ): Promise<NoteMeta> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);
    const cleanTarget = target.replace(/\.md$/, "");
    const linkText = alias ? `[[${cleanTarget}|${alias}]]` : `[[${cleanTarget}]]`;

    if (heading) {
      return this.insertAtHeading(notePath, heading, linkText, "end");
    }

    const raw = await fs.readFile(fullPath, "utf-8");
    const newContent = raw.endsWith("\n") ? `${raw}${linkText}\n` : `${raw}\n${linkText}\n`;
    await fs.writeFile(fullPath, newContent, "utf-8");
    return this.getNoteMeta(fullPath);
  }

  /** Remove all occurrences of a specific wikilink from a note */
  async removeLink(notePath: string, target: string): Promise<{ meta: NoteMeta; removed: number }> {
    const withExt = this.ensureExtension(notePath);
    const fullPath = this.resolve(withExt);
    const raw = await fs.readFile(fullPath, "utf-8");

    const cleanTarget = target.replace(/\.md$/, "");
    const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match [[target]], [[target|alias]], ![[target]]
    const linkRegex = new RegExp(`!?\\[\\[${escaped}(?:\\|[^\\]]+)?\\]\\]`, "g");

    const matches = raw.match(linkRegex);
    if (!matches) {
      throw new Error(`No link to "${target}" found in "${withExt}".`);
    }

    const newContent = raw.replace(linkRegex, "");
    await fs.writeFile(fullPath, newContent, "utf-8");
    return { meta: await this.getNoteMeta(fullPath), removed: matches.length };
  }

  /** Create bidirectional wikilinks between two notes */
  async linkNotes(
    noteA: string,
    noteB: string,
    heading?: string
  ): Promise<{ noteA: NoteMeta; noteB: NoteMeta }> {
    const aWithExt = this.ensureExtension(noteA);
    const bWithExt = this.ensureExtension(noteB);
    const aFull = this.resolve(aWithExt);
    const bFull = this.resolve(bWithExt);

    // Verify both exist
    await fs.access(aFull);
    await fs.access(bFull);

    const aName = path.basename(aWithExt, path.extname(aWithExt));
    const bName = path.basename(bWithExt, path.extname(bWithExt));

    const metaA = await this.addLink(noteA, bName, undefined, heading);
    const metaB = await this.addLink(noteB, aName, undefined, heading);

    return { noteA: metaA, noteB: metaB };
  }

  /** Delete a folder (empty or recursive) */
  async deleteFolder(folderPath: string, recursive = false): Promise<{ deleted: string; fileCount: number }> {
    const fullPath = this.resolve(folderPath);
    const stat = await fs.stat(fullPath);
    if (!stat.isDirectory()) {
      throw new Error(`"${folderPath}" is not a folder.`);
    }

    // Count files that will be deleted
    let fileCount = 0;
    if (recursive) {
      const files = await glob(`${fullPath}/**/*`, { nodir: true });
      fileCount = files.length;
      await fs.rm(fullPath, { recursive: true, force: false });
    } else {
      const entries = await fs.readdir(fullPath);
      if (entries.length > 0) {
        throw new Error(`Folder "${folderPath}" is not empty. Use recursive=true to delete anyway (${entries.length} entries).`);
      }
      await fs.rmdir(fullPath);
    }

    return { deleted: folderPath, fileCount };
  }

  /** Delete an attachment (non-markdown file) */
  async deleteAttachment(attachmentPath: string): Promise<{ deleted: string }> {
    const fullPath = this.resolve(attachmentPath);
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
      throw new Error(`"${attachmentPath}" is not a file.`);
    }

    const ext = path.extname(fullPath).toLowerCase();
    if (SUPPORTED_EXTENSIONS.includes(ext as typeof SUPPORTED_EXTENSIONS[number])) {
      throw new Error(`"${attachmentPath}" is a markdown note, use obsidian_delete_note instead.`);
    }

    await fs.unlink(fullPath);
    return { deleted: attachmentPath };
  }

  /** Delete multiple notes at once (with safety confirmation) */
  async bulkDelete(paths: string[], confirm: boolean): Promise<{ deleted: string[]; failed: Array<{ path: string; error: string }> }> {
    if (!confirm) {
      throw new Error(`Safety guard: confirm=true is required to perform bulk deletion of ${paths.length} notes.`);
    }

    const deleted: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];

    for (const notePath of paths) {
      try {
        const withExt = this.ensureExtension(notePath);
        const fullPath = this.resolve(withExt);
        await fs.access(fullPath);
        await fs.unlink(fullPath);
        deleted.push(withExt);
      } catch (err) {
        failed.push({ path: notePath, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { deleted, failed };
  }

  /** Find (and optionally delete) empty notes */
  async deleteEmptyNotes(
    folder?: string,
    dryRun = true
  ): Promise<{ empty: NoteMeta[]; deleted: string[]; total: number }> {
    const searchBase = folder ? this.resolve(folder) : this.vaultPath;
    const files = await glob(`${searchBase}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    const empty: NoteMeta[] = [];
    const deleted: string[] = [];

    for (const file of files) {
      const raw = await fs.readFile(file, "utf-8");
      // Empty = no content besides frontmatter/whitespace
      const body = raw.replace(FRONTMATTER_REGEX, "").trim();
      if (body.length === 0) {
        const meta = await this.getNoteMeta(file);
        empty.push(meta);
        if (!dryRun) {
          try {
            await fs.unlink(file);
            deleted.push(meta.path);
          } catch {
            // Skip
          }
        }
      }
    }

    return { empty, deleted, total: empty.length };
  }

  /** Find broken wikilinks (links to non-existing notes) */
  async listBrokenLinks(): Promise<{ broken: Array<{ source: string; link: string }>; total: number }> {
    const files = await glob(`${this.vaultPath}/**/*.md`, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    // Build a set of all note names and paths (without extension)
    const existingNotes = new Set<string>();
    for (const file of files) {
      const rel = path.relative(this.vaultPath, file);
      const name = path.basename(file, path.extname(file));
      existingNotes.add(name.toLowerCase());
      existingNotes.add(rel.replace(/\.md$/, "").toLowerCase());
    }

    const broken: Array<{ source: string; link: string }> = [];

    for (const file of files) {
      const content = await fs.readFile(file, "utf-8");
      const links = this.extractLinks(content);
      const source = path.relative(this.vaultPath, file);

      for (const link of links) {
        const linkLower = link.toLowerCase();
        if (!existingNotes.has(linkLower) && !existingNotes.has(linkLower.replace(/\//g, path.sep))) {
          broken.push({ source, link });
        }
      }
    }

    return { broken, total: broken.length };
  }
}
