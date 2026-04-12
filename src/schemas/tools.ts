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
