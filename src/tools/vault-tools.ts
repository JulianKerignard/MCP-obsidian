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
  MoveNoteSchema,
  CreateFolderSchema,
  UpdateFrontmatterSchema,
  DailyNoteSchema,
  InsertAtHeadingSchema,
  ReplaceInNoteSchema,
  RenameTagSchema,
  ListRecentSchema,
  SearchByFrontmatterSchema,
  SearchRegexSchema,
  OutgoingLinksSchema,
  GetSectionSchema,
  DeleteSectionSchema,
  CopyNoteSchema,
  PrependNoteSchema,
  BulkTagSchema,
  ListTasksSchema,
  ToggleTaskSchema,
  ListHeadingsSchema,
  ListAttachmentsSchema,
  UpdateLinksSchema,
  MergeNotesSchema,
  MostLinkedSchema,
  NoteStatsSchema,
  AddTagSchema,
  RemoveTagSchema,
  AddLinkSchema,
  RemoveLinkSchema,
  LinkNotesSchema,
  DeleteFolderSchema,
  DeleteAttachmentSchema,
  BulkDeleteSchema,
  DeleteEmptyNotesSchema,
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

  // ── Move Note ───────────────────────────────────────────────
  server.registerTool(
    "obsidian_move_note",
    {
      title: "Move/Rename Obsidian Note",
      description: `Move or rename a note in the Obsidian vault.

Creates destination folders automatically. Fails if the destination already exists.

Args:
  - path (string): Current note path
  - new_path (string): New note path (e.g. 'Archive/old-idea')

Returns: Updated note metadata at new location`,
      inputSchema: MoveNoteSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const meta = await vault.moveNote(params.path, params.new_path);
        return { content: [{ type: "text", text: `Note moved successfully.\n${JSON.stringify(meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error moving note: ${msg}` }] };
      }
    }
  );

  // ── Create Folder ──────────────────────────────────────────
  server.registerTool(
    "obsidian_create_folder",
    {
      title: "Create Folder",
      description: `Create a folder (and parent folders) in the Obsidian vault.

Args:
  - path (string): Folder path to create (e.g. 'Projects/AI/Research')

Returns: { created: string }`,
      inputSchema: CreateFolderSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.createFolder(params.path);
        return { content: [{ type: "text", text: `Folder created: ${result.created}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error creating folder: ${msg}` }] };
      }
    }
  );

  // ── Update Frontmatter ─────────────────────────────────────
  server.registerTool(
    "obsidian_update_frontmatter",
    {
      title: "Update Note Frontmatter",
      description: `Update specific frontmatter fields of an Obsidian note without touching the body content.

Adds or updates the given fields, and optionally removes specified keys. If the note has no frontmatter, one is created.

Args:
  - path (string): Path to the note
  - fields (object): Key-value pairs to set (e.g. { status: 'done', priority: 1 })
  - remove (string[], optional): Keys to remove from frontmatter

Returns: Updated note metadata`,
      inputSchema: UpdateFrontmatterSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const meta = await vault.updateFrontmatter(params.path, params.fields, params.remove);
        return { content: [{ type: "text", text: `Frontmatter updated successfully.\n${JSON.stringify(meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error updating frontmatter: ${msg}` }] };
      }
    }
  );

  // ── Daily Note ──────────────────────────────────────────────
  server.registerTool(
    "obsidian_daily_note",
    {
      title: "Get/Create Daily Note",
      description: `Get today's daily note, creating it if it doesn't exist.

Uses the Daily/ folder by default. You can provide a template for new daily notes.

Args:
  - date (string, optional): Date in YYYY-MM-DD format (defaults to today)
  - folder (string): Folder for daily notes (default: 'Daily')
  - template (string, optional): Initial content for new daily notes

Returns: Full note content and metadata`,
      inputSchema: DailyNoteSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const note = await vault.dailyNote(params.date, params.folder, params.template);
        note.content = truncate(note.content);
        return { content: [{ type: "text", text: JSON.stringify(note, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error with daily note: ${msg}` }] };
      }
    }
  );

  // ── Insert at Heading ──────────────────────────────────────
  server.registerTool(
    "obsidian_insert_at_heading",
    {
      title: "Insert Content at Heading",
      description: `Insert content under a specific heading in a note.

Finds the heading and inserts content either right after it ('beginning') or before the next same-level heading ('end').

Args:
  - path (string): Path to the note
  - heading (string): Heading text without # prefix (e.g. 'Tasks')
  - content (string): Content to insert
  - position ('beginning' | 'end'): Where to insert (default: 'end')

Returns: Updated note metadata`,
      inputSchema: InsertAtHeadingSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const meta = await vault.insertAtHeading(params.path, params.heading, params.content, params.position);
        return { content: [{ type: "text", text: `Content inserted under "${params.heading}".\n${JSON.stringify(meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error inserting at heading: ${msg}` }] };
      }
    }
  );

  // ── Replace in Note ────────────────────────────────────────
  server.registerTool(
    "obsidian_replace_in_note",
    {
      title: "Find & Replace in Note",
      description: `Find and replace text in a note. More surgical than obsidian_update_note.

Args:
  - path (string): Path to the note
  - search (string): Text to find
  - replace (string): Replacement text
  - all (boolean): Replace all occurrences (default: first only)

Returns: { meta, replacements: number }`,
      inputSchema: ReplaceInNoteSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.replaceInNote(params.path, params.search, params.replace, params.all);
        return { content: [{ type: "text", text: `Replaced ${result.replacements} occurrence(s).\n${JSON.stringify(result.meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error replacing in note: ${msg}` }] };
      }
    }
  );

  // ── Rename Tag ─────────────────────────────────────────────
  server.registerTool(
    "obsidian_rename_tag",
    {
      title: "Rename Tag Across Vault",
      description: `Rename a tag in all notes across the vault (both inline #tags and frontmatter tags).

Args:
  - old_tag (string): Current tag name (without #)
  - new_tag (string): New tag name (without #)

Returns: { filesModified: number }`,
      inputSchema: RenameTagSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.renameTag(params.old_tag, params.new_tag);
        return { content: [{ type: "text", text: `Tag renamed: #${params.old_tag} → #${params.new_tag} in ${result.filesModified} file(s).` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error renaming tag: ${msg}` }] };
      }
    }
  );

  // ── List Recent Notes ──────────────────────────────────────
  server.registerTool(
    "obsidian_list_recent_notes",
    {
      title: "List Recently Modified Notes",
      description: `List notes sorted by modification date (most recent first).

Args:
  - limit (number): Max results, 1-100 (default: 20)
  - folder (string, optional): Restrict to a folder
  - days (number, optional): Only notes modified in the last N days

Returns: { notes: NoteMeta[], total: number }`,
      inputSchema: ListRecentSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.listRecentNotes(params.limit, params.folder, params.days);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error listing recent notes: ${msg}` }] };
      }
    }
  );

  // ── Search by Frontmatter ──────────────────────────────────
  server.registerTool(
    "obsidian_search_by_frontmatter",
    {
      title: "Search Notes by Frontmatter",
      description: `Filter notes by frontmatter field values (e.g. find all notes with status=done).

String values use exact match. If a frontmatter field is an array, 'includes' semantics apply.

Args:
  - filters (object): Field-value pairs to match (e.g. { status: 'done', priority: 1 })
  - limit (number): Max results, 1-100 (default: 50)

Returns: { results: [{ note, frontmatter }], total: number }`,
      inputSchema: SearchByFrontmatterSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.searchByFrontmatter(params.filters, params.limit);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error searching frontmatter: ${msg}` }] };
      }
    }
  );

  // ── Search Regex ───────────────────────────────────────────
  server.registerTool(
    "obsidian_search_regex",
    {
      title: "Search with Regex",
      description: `Search notes with a JavaScript regex pattern. Captures groups are returned.

Args:
  - pattern (string): Regex pattern
  - flags (string): Regex flags (default: 'i')
  - folder (string, optional): Restrict to a folder
  - limit (number): Max results

Returns: { results: [{ note, matches: [{ line, text, groups }] }], total: number }`,
      inputSchema: SearchRegexSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.searchRegex(params.pattern, params.flags, params.folder, params.limit);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error in regex search: ${msg}` }] };
      }
    }
  );

  // ── Outgoing Links ─────────────────────────────────────────
  server.registerTool(
    "obsidian_get_outgoing_links",
    {
      title: "Get Outgoing Links",
      description: `List all [[wikilinks]] going out from a note, with resolution status (exists/broken).

Complementary to obsidian_get_backlinks (which shows incoming links).

Args:
  - path (string): Path to the note

Returns: { links: string[], resolved: [{ link, exists, path? }] }`,
      inputSchema: OutgoingLinksSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.getOutgoingLinks(params.path);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error getting outgoing links: ${msg}` }] };
      }
    }
  );

  // ── Get Section ────────────────────────────────────────────
  server.registerTool(
    "obsidian_get_section",
    {
      title: "Get Section Content",
      description: `Get the content under a specific heading in a note (until the next same-level heading).

Args:
  - path (string): Path to the note
  - heading (string): Heading text without # prefix

Returns: { heading, content, level }`,
      inputSchema: GetSectionSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.getSection(params.path, params.heading);
        result.content = truncate(result.content);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error getting section: ${msg}` }] };
      }
    }
  );

  // ── Delete Section ─────────────────────────────────────────
  server.registerTool(
    "obsidian_delete_section",
    {
      title: "Delete Section",
      description: `Delete a section (heading + content until next same-level heading) from a note.

Args:
  - path (string): Path to the note
  - heading (string): Heading text of the section to remove

Returns: Updated note metadata`,
      inputSchema: DeleteSectionSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const meta = await vault.deleteSection(params.path, params.heading);
        return { content: [{ type: "text", text: `Section "${params.heading}" deleted.\n${JSON.stringify(meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error deleting section: ${msg}` }] };
      }
    }
  );

  // ── Copy Note ──────────────────────────────────────────────
  server.registerTool(
    "obsidian_copy_note",
    {
      title: "Copy Note",
      description: `Duplicate a note to a new location. Fails if the destination already exists.

Args:
  - path (string): Source note path
  - new_path (string): Destination path for the copy

Returns: Metadata of the new note`,
      inputSchema: CopyNoteSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const meta = await vault.copyNote(params.path, params.new_path);
        return { content: [{ type: "text", text: `Note copied.\n${JSON.stringify(meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error copying note: ${msg}` }] };
      }
    }
  );

  // ── Prepend to Note ────────────────────────────────────────
  server.registerTool(
    "obsidian_prepend_note",
    {
      title: "Prepend to Note",
      description: `Prepend content to the beginning of a note (after frontmatter if present).

Args:
  - path (string): Path to the note
  - content (string): Content to prepend

Returns: Updated note metadata`,
      inputSchema: PrependNoteSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const meta = await vault.prependToNote(params.path, params.content);
        return { content: [{ type: "text", text: `Content prepended.\n${JSON.stringify(meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error prepending to note: ${msg}` }] };
      }
    }
  );

  // ── Bulk Tag ───────────────────────────────────────────────
  server.registerTool(
    "obsidian_bulk_tag",
    {
      title: "Bulk Tag Operation",
      description: `Add or remove a tag on multiple notes at once (modifies frontmatter tags).

Args:
  - paths (string[]): List of note paths
  - tag (string): Tag name (without #)
  - action ('add' | 'remove'): Whether to add or remove

Returns: { modified: number, skipped: string[] }`,
      inputSchema: BulkTagSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.bulkTag(params.paths, params.tag, params.action);
        return { content: [{ type: "text", text: `Bulk tag ${params.action}: ${result.modified} note(s) modified, ${result.skipped.length} skipped.\n${JSON.stringify(result, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error in bulk tag: ${msg}` }] };
      }
    }
  );

  // ── List Tasks ─────────────────────────────────────────────
  server.registerTool(
    "obsidian_list_tasks",
    {
      title: "List Tasks",
      description: `Extract all '- [ ]' and '- [x]' tasks from markdown notes.

Args:
  - folder (string, optional): Restrict to a folder
  - status ('open' | 'done' | 'all'): Filter by status (default: 'open')
  - limit (number): Max tasks (default: 100)

Returns: { tasks: [{ path, line, text, done }], total: number }`,
      inputSchema: ListTasksSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.listTasks(params.folder, params.status, params.limit);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error listing tasks: ${msg}` }] };
      }
    }
  );

  // ── Toggle Task ────────────────────────────────────────────
  server.registerTool(
    "obsidian_toggle_task",
    {
      title: "Toggle Task",
      description: `Check or uncheck a task in a note by its exact text.

Args:
  - path (string): Note path
  - task_text (string): Exact task text (without '- [ ]' prefix)
  - done (boolean, optional): Force state (true=done, false=open). Omit to toggle.

Returns: { meta, newState: boolean }`,
      inputSchema: ToggleTaskSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.toggleTask(params.path, params.task_text, params.done);
        return { content: [{ type: "text", text: `Task set to ${result.newState ? "done" : "open"}.\n${JSON.stringify(result.meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error toggling task: ${msg}` }] };
      }
    }
  );

  // ── List Headings ──────────────────────────────────────────
  server.registerTool(
    "obsidian_list_headings",
    {
      title: "List Note Headings (TOC)",
      description: `Get a table of contents (all headings) from a note.

Args:
  - path (string): Path to the note

Returns: { headings: [{ level, text, line }] }`,
      inputSchema: ListHeadingsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.listHeadings(params.path);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error listing headings: ${msg}` }] };
      }
    }
  );

  // ── List Attachments ───────────────────────────────────────
  server.registerTool(
    "obsidian_list_attachments",
    {
      title: "List Attachments",
      description: `List non-markdown files in the vault (images, PDFs, etc.).

Args:
  - folder (string, optional): Restrict to a folder
  - extensions (string[], optional): Filter by extensions (e.g. ['.png', '.jpg'])

Returns: { attachments: [{ path, extension, size }], total: number }`,
      inputSchema: ListAttachmentsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.listAttachments(params.folder, params.extensions);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error listing attachments: ${msg}` }] };
      }
    }
  );

  // ── Find Unused Attachments ────────────────────────────────
  server.registerTool(
    "obsidian_find_unused_attachments",
    {
      title: "Find Unused Attachments",
      description: `Find attachments (images, PDFs, etc.) that are never referenced in any note.

Scans all markdown files for wikilink/markdown/embed references. Useful for vault cleanup.

Returns: { unused: [{ path, size }], total: number }`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const result = await vault.findUnusedAttachments();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error finding unused attachments: ${msg}` }] };
      }
    }
  );

  // ── Update Links ───────────────────────────────────────────
  server.registerTool(
    "obsidian_update_links",
    {
      title: "Update Wikilinks After Rename",
      description: `Update all [[wikilinks]] pointing to a renamed note across the vault.

Use this after obsidian_move_note to keep links intact.

Args:
  - old_name (string): Old note name (e.g. 'Old Title')
  - new_name (string): New note name or path

Returns: { filesModified, totalReplacements }`,
      inputSchema: UpdateLinksSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.updateLinks(params.old_name, params.new_name);
        return { content: [{ type: "text", text: `Updated ${result.totalReplacements} link(s) in ${result.filesModified} file(s).` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error updating links: ${msg}` }] };
      }
    }
  );

  // ── Merge Notes ────────────────────────────────────────────
  server.registerTool(
    "obsidian_merge_notes",
    {
      title: "Merge Notes",
      description: `Merge multiple notes into a single destination note.

Frontmatter of the first source is preserved; subsequent notes are appended under '## From: <name>' sub-headings.

Args:
  - sources (string[]): Source note paths (min 2)
  - destination (string): Destination note path (must not exist)
  - separator (string): Separator between notes (default: horizontal rule)
  - delete_sources (boolean): Delete sources after merge (default: false)

Returns: { meta, mergedCount, deleted }`,
      inputSchema: MergeNotesSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.mergeNotes(params.sources, params.destination, params.separator, params.delete_sources);
        return { content: [{ type: "text", text: `Merged ${result.mergedCount} note(s) into ${params.destination}.\n${JSON.stringify(result, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error merging notes: ${msg}` }] };
      }
    }
  );

  // ── Most Linked ────────────────────────────────────────────
  server.registerTool(
    "obsidian_most_linked",
    {
      title: "Most Linked Notes",
      description: `Get top notes ranked by number of incoming [[wikilinks]]. Useful for identifying hub notes.

Args:
  - limit (number): Max results (default: 20)

Returns: { notes: [{ note, backlinkCount }], total: number }`,
      inputSchema: MostLinkedSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.mostLinked(params.limit);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error getting most linked: ${msg}` }] };
      }
    }
  );

  // ── Note Stats ─────────────────────────────────────────────
  server.registerTool(
    "obsidian_note_stats",
    {
      title: "Get Note Statistics",
      description: `Get detailed stats for a single note: word/character/line count, headings, links, tags, tasks, reading time.

Args:
  - path (string): Note path

Returns: { words, characters, lines, headings, links, tags, tasks: {total, done, open}, readingTimeMinutes }`,
      inputSchema: NoteStatsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.getNoteStats(params.path);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error getting note stats: ${msg}` }] };
      }
    }
  );

  // ── Add Tag ────────────────────────────────────────────────
  server.registerTool(
    "obsidian_add_tag",
    {
      title: "Add Tag to Note",
      description: `Add a tag to a single note (in frontmatter tags array or inline as #tag).

Args:
  - path (string): Note path
  - tag (string): Tag name (without #)
  - location ('frontmatter' | 'inline'): Where to add (default: 'frontmatter')

Returns: Updated note metadata`,
      inputSchema: AddTagSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const meta = await vault.addTag(params.path, params.tag, params.location);
        return { content: [{ type: "text", text: `Tag #${params.tag} added (${params.location}).\n${JSON.stringify(meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error adding tag: ${msg}` }] };
      }
    }
  );

  // ── Remove Tag ─────────────────────────────────────────────
  server.registerTool(
    "obsidian_remove_tag",
    {
      title: "Remove Tag from Note",
      description: `Remove a tag from a note (both frontmatter tags array and inline #tags).

Args:
  - path (string): Note path
  - tag (string): Tag to remove (without #)

Returns: { meta, removed: number }`,
      inputSchema: RemoveTagSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.removeTag(params.path, params.tag);
        return { content: [{ type: "text", text: `Removed ${result.removed} occurrence(s) of #${params.tag}.\n${JSON.stringify(result.meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error removing tag: ${msg}` }] };
      }
    }
  );

  // ── Add Link ───────────────────────────────────────────────
  server.registerTool(
    "obsidian_add_link",
    {
      title: "Add Wikilink to Note",
      description: `Add a [[wikilink]] to a note. Optionally under a specific heading or with an alias.

Args:
  - path (string): Note path where to add the link
  - target (string): Target note name or path
  - alias (string, optional): Display text for the link
  - heading (string, optional): Insert under this heading instead of at end

Returns: Updated note metadata`,
      inputSchema: AddLinkSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const meta = await vault.addLink(params.path, params.target, params.alias, params.heading);
        return { content: [{ type: "text", text: `Link [[${params.target}]] added.\n${JSON.stringify(meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error adding link: ${msg}` }] };
      }
    }
  );

  // ── Remove Link ────────────────────────────────────────────
  server.registerTool(
    "obsidian_remove_link",
    {
      title: "Remove Wikilink from Note",
      description: `Remove all occurrences of a [[wikilink]] to a specific target from a note (including aliased and embed forms).

Args:
  - path (string): Note path
  - target (string): Link target to remove

Returns: { meta, removed: number }`,
      inputSchema: RemoveLinkSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.removeLink(params.path, params.target);
        return { content: [{ type: "text", text: `Removed ${result.removed} link(s) to [[${params.target}]].\n${JSON.stringify(result.meta, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error removing link: ${msg}` }] };
      }
    }
  );

  // ── Link Notes (bidirectional) ─────────────────────────────
  server.registerTool(
    "obsidian_link_notes",
    {
      title: "Link Two Notes Bidirectionally",
      description: `Create bidirectional [[wikilinks]] between two notes (A → B and B → A).

Args:
  - note_a (string): First note path
  - note_b (string): Second note path
  - heading (string, optional): Insert both links under this heading in each note

Returns: { noteA, noteB }`,
      inputSchema: LinkNotesSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.linkNotes(params.note_a, params.note_b, params.heading);
        return { content: [{ type: "text", text: `Notes linked bidirectionally.\n${JSON.stringify(result, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error linking notes: ${msg}` }] };
      }
    }
  );

  // ── Delete Folder ──────────────────────────────────────────
  server.registerTool(
    "obsidian_delete_folder",
    {
      title: "Delete Folder",
      description: `Delete a folder from the vault.

By default, only deletes empty folders. Set recursive=true to delete with all contents.
⚠️ Recursive deletion is irreversible — all files and subfolders are removed from the filesystem.

Args:
  - path (string): Folder path
  - recursive (boolean): Delete even if not empty (default: false)

Returns: { deleted, fileCount }`,
      inputSchema: DeleteFolderSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.deleteFolder(params.path, params.recursive);
        return { content: [{ type: "text", text: `Folder deleted: ${result.deleted} (${result.fileCount} file(s) removed)` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error deleting folder: ${msg}` }] };
      }
    }
  );

  // ── Delete Attachment ──────────────────────────────────────
  server.registerTool(
    "obsidian_delete_attachment",
    {
      title: "Delete Attachment",
      description: `Delete a non-markdown file (image, PDF, etc.) from the vault.

⚠️ Irreversible. To delete a markdown note, use obsidian_delete_note.

Args:
  - path (string): Path to the attachment

Returns: { deleted: string }`,
      inputSchema: DeleteAttachmentSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.deleteAttachment(params.path);
        return { content: [{ type: "text", text: `Attachment deleted: ${result.deleted}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error deleting attachment: ${msg}` }] };
      }
    }
  );

  // ── Bulk Delete ────────────────────────────────────────────
  server.registerTool(
    "obsidian_bulk_delete",
    {
      title: "Bulk Delete Notes",
      description: `Delete multiple notes at once.

⚠️ Irreversible. Requires confirm=true as a safety guard to prevent accidental mass deletion.

Args:
  - paths (string[]): Notes to delete
  - confirm (boolean): Must be true to proceed

Returns: { deleted: string[], failed: [{ path, error }] }`,
      inputSchema: BulkDeleteSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.bulkDelete(params.paths, params.confirm);
        return { content: [{ type: "text", text: `Deleted ${result.deleted.length}/${params.paths.length} note(s). ${result.failed.length} failed.\n${JSON.stringify(result, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error in bulk delete: ${msg}` }] };
      }
    }
  );

  // ── Delete Empty Notes ─────────────────────────────────────
  server.registerTool(
    "obsidian_delete_empty_notes",
    {
      title: "Delete Empty Notes",
      description: `Find (and optionally delete) notes whose body is empty (ignoring frontmatter).

Defaults to dry_run=true for safety — it just lists empty notes. Set dry_run=false to actually delete them.

Args:
  - folder (string, optional): Restrict to a folder
  - dry_run (boolean): If true, only list without deleting (default: true)

Returns: { empty: NoteMeta[], deleted: string[], total: number }`,
      inputSchema: DeleteEmptyNotesSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const result = await vault.deleteEmptyNotes(params.folder, params.dry_run);
        const action = params.dry_run ? "found" : "deleted";
        return { content: [{ type: "text", text: `${result.total} empty note(s) ${action}.\n${JSON.stringify(result, null, 2)}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error with empty notes: ${msg}` }] };
      }
    }
  );

  // ── List Orphan Notes ──────────────────────────────────────
  server.registerTool(
    "obsidian_list_orphans",
    {
      title: "List Orphan Notes",
      description: `Find notes with no incoming [[wikilinks]] from any other note.

Useful for vault cleanup — orphan notes may need linking or archiving.

Returns: { orphans: NoteMeta[], total: number }`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const result = await vault.listOrphans();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error listing orphans: ${msg}` }] };
      }
    }
  );

  // ── List Broken Links ──────────────────────────────────────
  server.registerTool(
    "obsidian_list_broken_links",
    {
      title: "List Broken Wikilinks",
      description: `Find [[wikilinks]] that point to notes that don't exist.

Returns: { broken: [{ source: string, link: string }], total: number }`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const result = await vault.listBrokenLinks();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error listing broken links: ${msg}` }] };
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
