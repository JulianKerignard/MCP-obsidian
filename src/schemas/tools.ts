import { z } from "zod";

export const ListNotesSchema = z.object({
  folder: z.string().optional().describe("Folder path relative to vault root to filter notes (e.g. 'Projects/AI')"),
  limit: z.number().int().min(1).max(200).default(50).describe("Maximum number of notes to return"),
  offset: z.number().int().min(0).default(0).describe("Number of notes to skip for pagination"),
}).strict();

export const ReadNoteSchema = z.object({
  path: z.string().min(1).describe("Path to the note relative to vault root (e.g. 'Daily/2025-04-12' or 'Projects/AI/ideas.md')"),
}).strict();

export const CreateNoteSchema = z.object({
  path: z.string().min(1).describe("Path for the new note relative to vault root (e.g. 'Projects/AI/new-idea'). Folders are created automatically."),
  content: z.string().describe("Markdown content of the note. Can include frontmatter (---), tags (#tag), and wikilinks ([[link]])"),
}).strict();

export const UpdateNoteSchema = z.object({
  path: z.string().min(1).describe("Path to the existing note relative to vault root"),
  content: z.string().describe("New full content to replace the note with"),
}).strict();

export const AppendNoteSchema = z.object({
  path: z.string().min(1).describe("Path to the existing note relative to vault root"),
  content: z.string().describe("Content to append at the end of the note"),
}).strict();

export const DeleteNoteSchema = z.object({
  path: z.string().min(1).describe("Path to the note to delete relative to vault root"),
}).strict();

export const SearchNotesSchema = z.object({
  query: z.string().min(1).describe("Text to search for in note titles and content"),
  folder: z.string().optional().describe("Restrict search to a specific folder"),
  tag: z.string().optional().describe("Filter results to notes containing this tag (without #)"),
  limit: z.number().int().min(1).max(50).default(20).describe("Maximum number of results"),
  case_sensitive: z.boolean().default(false).describe("Whether the search is case-sensitive"),
}).strict();

export const BacklinksSchema = z.object({
  note_name: z.string().min(1).describe("Name of the note to find backlinks for (e.g. 'My Note' or 'projects/my-note')"),
}).strict();

export const MoveNoteSchema = z.object({
  path: z.string().min(1).describe("Current path of the note relative to vault root"),
  new_path: z.string().min(1).describe("New path for the note relative to vault root (e.g. 'Archive/old-idea')"),
}).strict();

export const CreateFolderSchema = z.object({
  path: z.string().min(1).describe("Folder path to create relative to vault root (e.g. 'Projects/AI/Research')"),
}).strict();

export const UpdateFrontmatterSchema = z.object({
  path: z.string().min(1).describe("Path to the existing note relative to vault root"),
  fields: z.record(z.unknown()).describe("Key-value pairs to set or update in the frontmatter (e.g. { status: 'done', tags: ['ai', 'project'] })"),
  remove: z.array(z.string()).optional().describe("List of frontmatter keys to remove"),
}).strict();

export const DailyNoteSchema = z.object({
  date: z.string().optional().describe("Date in YYYY-MM-DD format (defaults to today)"),
  folder: z.string().default("Daily").describe("Folder for daily notes (default: 'Daily')"),
  template: z.string().optional().describe("Initial content if the daily note doesn't exist yet"),
}).strict();

export const InsertAtHeadingSchema = z.object({
  path: z.string().min(1).describe("Path to the note relative to vault root"),
  heading: z.string().min(1).describe("Exact heading text to find (without # prefix, e.g. 'Tasks' not '## Tasks')"),
  content: z.string().describe("Content to insert under the heading"),
  position: z.enum(["beginning", "end"]).default("end").describe("Insert at 'beginning' (right after heading) or 'end' (before next heading)"),
}).strict();

export const ReplaceInNoteSchema = z.object({
  path: z.string().min(1).describe("Path to the note relative to vault root"),
  search: z.string().min(1).describe("Text to find in the note"),
  replace: z.string().describe("Replacement text"),
  all: z.boolean().default(false).describe("Replace all occurrences (default: first only)"),
}).strict();

export const RenameTagSchema = z.object({
  old_tag: z.string().min(1).describe("Current tag name (without #, e.g. 'project/old')"),
  new_tag: z.string().min(1).describe("New tag name (without #, e.g. 'project/new')"),
}).strict();

export const ListRecentSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20).describe("Max notes to return"),
  folder: z.string().optional().describe("Restrict to a folder"),
  days: z.number().int().min(1).optional().describe("Only notes modified in the last N days"),
}).strict();

export const SearchByFrontmatterSchema = z.object({
  filters: z.record(z.unknown()).describe("Frontmatter field filters (e.g. { status: 'done', priority: 1 }). String values use exact match, arrays use 'includes'."),
  limit: z.number().int().min(1).max(100).default(50).describe("Max results"),
}).strict();

export const SearchRegexSchema = z.object({
  pattern: z.string().min(1).describe("JavaScript regex pattern (e.g. 'TODO:\\s*(.+)')"),
  flags: z.string().default("i").describe("Regex flags (default: 'i' for case-insensitive)"),
  folder: z.string().optional().describe("Restrict search to a folder"),
  limit: z.number().int().min(1).max(50).default(20).describe("Max results"),
}).strict();

export const OutgoingLinksSchema = z.object({
  path: z.string().min(1).describe("Path to the note relative to vault root"),
}).strict();

export const GetSectionSchema = z.object({
  path: z.string().min(1).describe("Path to the note relative to vault root"),
  heading: z.string().min(1).describe("Heading text without # prefix"),
}).strict();

export const DeleteSectionSchema = z.object({
  path: z.string().min(1).describe("Path to the note"),
  heading: z.string().min(1).describe("Heading text of the section to delete (without #)"),
}).strict();

export const CopyNoteSchema = z.object({
  path: z.string().min(1).describe("Source note path"),
  new_path: z.string().min(1).describe("Destination path for the copy"),
}).strict();

export const PrependNoteSchema = z.object({
  path: z.string().min(1).describe("Path to the existing note"),
  content: z.string().describe("Content to prepend (added before a newline)"),
}).strict();

export const BulkTagSchema = z.object({
  paths: z.array(z.string()).min(1).describe("List of note paths to modify"),
  tag: z.string().min(1).describe("Tag to add or remove (without #)"),
  action: z.enum(["add", "remove"]).describe("Whether to add or remove the tag"),
}).strict();

export const ListTasksSchema = z.object({
  folder: z.string().optional().describe("Restrict to a folder"),
  status: z.enum(["open", "done", "all"]).default("open").describe("Filter by task status"),
  limit: z.number().int().min(1).max(500).default(100).describe("Max tasks to return"),
}).strict();

export const ToggleTaskSchema = z.object({
  path: z.string().min(1).describe("Path to the note containing the task"),
  task_text: z.string().min(1).describe("Exact text of the task (without the '- [ ]' prefix)"),
  done: z.boolean().optional().describe("Force state: true=done, false=open. Omit to toggle."),
}).strict();

export const ListHeadingsSchema = z.object({
  path: z.string().min(1).describe("Path to the note"),
}).strict();

export const ListAttachmentsSchema = z.object({
  folder: z.string().optional().describe("Restrict to a folder"),
  extensions: z.array(z.string()).optional().describe("Filter by extensions (e.g. ['.png', '.jpg']). Default: all non-markdown files."),
}).strict();

export const UpdateLinksSchema = z.object({
  old_name: z.string().min(1).describe("Old note name (e.g. 'Old Title' or 'folder/old-title')"),
  new_name: z.string().min(1).describe("New note name or path"),
}).strict();

export const MergeNotesSchema = z.object({
  sources: z.array(z.string()).min(2).describe("List of source note paths to merge"),
  destination: z.string().min(1).describe("Destination path for the merged note"),
  separator: z.string().default("\n\n---\n\n").describe("Separator between merged notes (default: horizontal rule)"),
  delete_sources: z.boolean().default(false).describe("Delete source notes after successful merge"),
}).strict();

export const MostLinkedSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20).describe("Max results"),
}).strict();

export const NoteStatsSchema = z.object({
  path: z.string().min(1).describe("Path to the note"),
}).strict();

export const AddTagSchema = z.object({
  path: z.string().min(1).describe("Path to the note"),
  tag: z.string().min(1).describe("Tag to add (without #)"),
  location: z.enum(["frontmatter", "inline"]).default("frontmatter").describe("Where to add the tag: 'frontmatter' (in tags: [...]) or 'inline' (appended as #tag)"),
}).strict();

export const RemoveTagSchema = z.object({
  path: z.string().min(1).describe("Path to the note"),
  tag: z.string().min(1).describe("Tag to remove (without #)"),
}).strict();

export const AddLinkSchema = z.object({
  path: z.string().min(1).describe("Path to the note where to add the link"),
  target: z.string().min(1).describe("Target note name or path (e.g. 'My Note' or 'Projects/idea')"),
  alias: z.string().optional().describe("Optional display text for the link"),
  heading: z.string().optional().describe("If set, insert under this heading; otherwise append at end"),
}).strict();

export const RemoveLinkSchema = z.object({
  path: z.string().min(1).describe("Path to the note"),
  target: z.string().min(1).describe("Link target to remove (e.g. 'My Note')"),
}).strict();

export const LinkNotesSchema = z.object({
  note_a: z.string().min(1).describe("First note path"),
  note_b: z.string().min(1).describe("Second note path"),
  heading: z.string().optional().describe("Optional heading to place links under in both notes"),
}).strict();

export const DeleteFolderSchema = z.object({
  path: z.string().min(1).describe("Folder path relative to vault root"),
  recursive: z.boolean().default(false).describe("If true, delete folder and all its contents. If false, only delete if empty."),
}).strict();

export const DeleteAttachmentSchema = z.object({
  path: z.string().min(1).describe("Path to the attachment file (e.g. 'Assets/image.png')"),
}).strict();

export const BulkDeleteSchema = z.object({
  paths: z.array(z.string()).min(1).describe("List of note paths to delete"),
  confirm: z.boolean().describe("Must be true to actually delete. Safety guard against accidental mass deletion."),
}).strict();

export const DeleteEmptyNotesSchema = z.object({
  folder: z.string().optional().describe("Restrict to a folder"),
  dry_run: z.boolean().default(true).describe("If true, only list empty notes without deleting (default: true for safety)"),
}).strict();
