import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultService } from "../services/vault.js";
import {
  ListNotesSchema,
  ReadNoteSchema,
  CreateNoteSchema,
  UpdateNoteSchema,
  AppendNoteSchema,
  DeleteNoteSchema,
  SearchNotesSchema,
  BacklinksSchema,
} from "../schemas/tools.js";
import { CHARACTER_LIMIT } from "../constants.js";

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return text.slice(0, CHARACTER_LIMIT) + `\n\n... [Truncated: content exceeds ${CHARACTER_LIMIT} characters]`;
}

export function registerVaultTools(server: McpServer, vault: VaultService): void {
  // ── List Notes ──────────────────────────────────────────────
  server.registerTool(
    "obsidian_list_notes",
    {
      title: "List Obsidian Notes",
      description: `List markdown notes in the Obsidian vault.

Returns note metadata (path, name, folder, size, dates) with pagination.
Use 'folder' to scope to a subdirectory. Does NOT return note content — use obsidian_read_note for that.

Args:
  - folder (string, optional): Filter to a specific folder path
  - limit (number): Max results, 1-200 (default: 50)
  - offset (number): Pagination offset (default: 0)

Returns: { notes: NoteMeta[], total: number, hasMore: boolean }`,
      inputSchema: ListNotesSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.listNotes(params.folder, params.limit, params.offset);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error listing notes: ${msg}` }] };
      }
    }
  );

  // ── Read Note ───────────────────────────────────────────────
  server.registerTool(
    "obsidian_read_note",
    {
      title: "Read Obsidian Note",
      description: `Read the full content and metadata of an Obsidian note.

Returns the note's markdown content, parsed frontmatter, extracted tags, and wikilinks.
The .md extension is added automatically if omitted.

Args:
  - path (string): Note path relative to vault root (e.g. 'Daily/2025-04-12')

Returns: { path, name, content, frontmatter, tags, links, size, created, modified }`,
      inputSchema: ReadNoteSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const note = await vault.readNote(params.path);
        note.content = truncate(note.content);
        return { content: [{ type: "text", text: JSON.stringify(note, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error reading note: ${msg}. Check that the path exists with obsidian_list_notes.` }] };
      }
    }
  );

  // ── Create Note ─────────────────────────────────────────────
  server.registerTool(
    "obsidian_create_note",
    {
      title: "Create Obsidian Note",
      description: `Create a new markdown note in the Obsidian vault.

Automatically creates parent folders if they don't exist. Fails if the note already exists.
You can include frontmatter (--- block), inline #tags, and [[wikilinks]].

Args:
  - path (string): Path for the new note (e.g. 'Projects/AI/new-idea')
  - content (string): Markdown content

Returns: Note metadata after creation`,
      inputSchema: CreateNoteSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const meta = await vault.createNote(params.path, params.content);
        return { content: [{ type: "text", text: `Note created successfully.\n${JSON.stringify(meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error creating note: ${msg}` }] };
      }
    }
  );

  // ── Update Note ─────────────────────────────────────────────
  server.registerTool(
    "obsidian_update_note",
    {
      title: "Update Obsidian Note",
      description: `Replace the entire content of an existing Obsidian note.

The note must already exist. Use obsidian_read_note first to get current content if you want to make partial edits. For appending, use obsidian_append_note instead.

Args:
  - path (string): Path to the existing note
  - content (string): New full content to write

Returns: Updated note metadata`,
      inputSchema: UpdateNoteSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const meta = await vault.updateNote(params.path, params.content);
        return { content: [{ type: "text", text: `Note updated successfully.\n${JSON.stringify(meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error updating note: ${msg}. Verify the note exists with obsidian_list_notes.` }] };
      }
    }
  );

  // ── Append to Note ──────────────────────────────────────────
  server.registerTool(
    "obsidian_append_note",
    {
      title: "Append to Obsidian Note",
      description: `Append content to the end of an existing Obsidian note.

Useful for daily logs, journals, or incrementally building a note.

Args:
  - path (string): Path to the existing note
  - content (string): Content to append (added after a newline)

Returns: Updated note metadata`,
      inputSchema: AppendNoteSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const meta = await vault.appendToNote(params.path, params.content);
        return { content: [{ type: "text", text: `Content appended successfully.\n${JSON.stringify(meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error appending to note: ${msg}` }] };
      }
    }
  );

  // ── Delete Note ─────────────────────────────────────────────
  server.registerTool(
    "obsidian_delete_note",
    {
      title: "Delete Obsidian Note",
      description: `Permanently delete a note from the Obsidian vault.

⚠️ This is irreversible — the note is removed from the filesystem, not moved to trash.

Args:
  - path (string): Path to the note to delete

Returns: { deleted: string }`,
      inputSchema: DeleteNoteSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.deleteNote(params.path);
        return { content: [{ type: "text", text: `Note deleted: ${result.deleted}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error deleting note: ${msg}` }] };
      }
    }
  );

  // ── Search Notes ────────────────────────────────────────────
  server.registerTool(
    "obsidian_search_notes",
    {
      title: "Search Obsidian Notes",
      description: `Full-text search across all notes in the vault.

Searches both note titles and content. Results are ranked by relevance (title matches score higher).
Each result includes up to 5 matching line excerpts for context.

Args:
  - query (string): Text to search for
  - folder (string, optional): Restrict to a folder
  - tag (string, optional): Filter by tag (without #)
  - limit (number): Max results, 1-50 (default: 20)
  - case_sensitive (boolean): Case-sensitive search (default: false)

Returns: { results: SearchResult[], total: number }`,
      inputSchema: SearchNotesSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.searchNotes(params.query, {
          folder: params.folder,
          tagFilter: params.tag,
          limit: params.limit,
          caseSensitive: params.case_sensitive,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error searching notes: ${msg}` }] };
      }
    }
  );

  // ── Backlinks ───────────────────────────────────────────────
  server.registerTool(
    "obsidian_get_backlinks",
    {
      title: "Get Note Backlinks",
      description: `Find all notes that link to a given note via [[wikilinks]].

Essential for exploring the knowledge graph and understanding note connections.

Args:
  - note_name (string): Name of the target note (e.g. 'My Note')

Returns: { backlinks: [{ note: NoteMeta, contexts: string[] }] }`,
      inputSchema: BacklinksSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.getBacklinks(params.note_name);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error finding backlinks: ${msg}` }] };
      }
    }
  );

  // ── List Tags ───────────────────────────────────────────────
  server.registerTool(
    "obsidian_list_tags",
    {
      title: "List All Tags",
      description: `List all tags used across the vault with their frequency.

Scans frontmatter tags and inline #tags in all notes.

Returns: { tags: { [tagName]: count }, total: number }`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const result = await vault.getAllTags();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error listing tags: ${msg}` }] };
      }
    }
  );

  // ── List Folders ────────────────────────────────────────────
  server.registerTool(
    "obsidian_list_folders",
    {
      title: "List Vault Folders",
      description: `List all folders in the Obsidian vault that contain notes.

Useful for discovering the vault structure before listing or creating notes.

Returns: string[] of folder paths`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const folders = await vault.listFolders();
        return { content: [{ type: "text", text: JSON.stringify({ folders, total: folders.length }, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error listing folders: ${msg}` }] };
      }
    }
  );

  // ── Vault Stats ─────────────────────────────────────────────
  server.registerTool(
    "obsidian_vault_stats",
    {
      title: "Get Vault Statistics",
      description: `Get statistics about the entire Obsidian vault.

Returns total notes, folders, size, and tag distribution.

Returns: { totalNotes, totalFolders, totalSize, tags }`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const stats = await vault.getVaultStats();
        return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error getting vault stats: ${msg}` }] };
      }
    }
  );
}
