# Obsidian MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that lets LLMs interact with your [Obsidian](https://obsidian.md/) vault via the local filesystem.

## Features

| Tool | Description |
|------|-------------|
| `obsidian_list_notes` | List notes with pagination, optionally filtered by folder |
| `obsidian_read_note` | Read full content, frontmatter, tags, and wikilinks |
| `obsidian_create_note` | Create a new note (auto-creates folders) |
| `obsidian_update_note` | Replace entire note content |
| `obsidian_append_note` | Append content to an existing note |
| `obsidian_delete_note` | Permanently delete a note |
| `obsidian_search_notes` | Full-text search with tag filtering |
| `obsidian_get_backlinks` | Find all notes linking to a given note |
| `obsidian_list_tags` | List all tags with usage counts |
| `obsidian_list_folders` | List vault folder structure |
| `obsidian_vault_stats` | Vault-wide statistics |

## Installation

```bash
# Clone or copy this directory
cd obsidian-mcp-server

# Install dependencies
npm install

# Build
npm run build
```

## Configuration

### MCP Client Configuration

Add the server to your MCP client's configuration file:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": [
        "/absolute/path/to/obsidian-mcp-server/dist/index.js",
        "--vault",
        "/absolute/path/to/your/obsidian/vault"
      ]
    }
  }
}
```

### Environment Variable (alternative)

```bash
export OBSIDIAN_VAULT_PATH="/path/to/your/vault"
node dist/index.js
```

## Usage Examples

Once configured, you can ask your LLM things like:

- **"List all my notes"** → calls `obsidian_list_notes`
- **"Read my daily note for today"** → calls `obsidian_read_note`
- **"Create a new note about machine learning in Projects/AI"** → calls `obsidian_create_note`
- **"Search for notes mentioning 'transformer architecture'"** → calls `obsidian_search_notes`
- **"What notes link to my 'Research Ideas' note?"** → calls `obsidian_get_backlinks`
- **"Show me all tags in my vault"** → calls `obsidian_list_tags`
- **"Add a new entry to my daily log"** → calls `obsidian_append_note`

## Architecture

```
obsidian-mcp-server/
├── src/
│   ├── index.ts              # Entry point, CLI args, server setup
│   ├── constants.ts          # Regex patterns, limits
│   ├── types.ts              # TypeScript interfaces
│   ├── schemas/
│   │   └── tools.ts          # Zod input validation schemas
│   ├── services/
│   │   └── vault.ts          # Core filesystem operations
│   └── tools/
│       └── vault-tools.ts    # MCP tool registration
└── dist/                     # Compiled JS (after build)
```

## Security

- **Path traversal protection**: All paths are resolved and checked to stay within the vault
- **Ignored directories**: `.obsidian/`, `.trash/`, `node_modules/` are excluded from all operations
- **No network access**: Operates entirely on the local filesystem via stdio transport

## Requirements

- Node.js ≥ 18
- An Obsidian vault (any directory with `.md` files works)

## License

MIT
