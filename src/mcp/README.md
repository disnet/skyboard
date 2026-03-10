# Skyboard WebMCP Provider

This module provides WebMCP tools for Skyboard, enabling AI agents to interact with boards and cards through the browser's Model Context Protocol API.

## Overview

The MCP provider exposes three main tools:

1. **list-cards** - Query cards from boards with optional filtering
2. **add-card** - Create new cards on boards
3. **update-card** - Modify existing cards (title, description, or move between columns)

## Setup

The MCP provider is automatically initialized when a user signs in through the auth module:

```typescript
import { initMCPProvider } from "$mcp/index.js";

// Called automatically by auth.svelte.ts on login
initMCPProvider(did);
```

## Tool Details

### list-cards

List cards from a skyboard with optional filtering.

**Parameters:**
- `boardUri` (optional): Filter by specific board URI (e.g., `at://did:plc:xxx/dev.skyboard.board/yyy`)
- `columnId` (optional): Filter by specific column ID within the board
- `includeDescription` (optional, default: false): Include task descriptions in results

**Returns:**
- `count`: Number of cards found
- `cards`: Array of card objects with uri, title, description, columnId, boardUri, ownerDid, and createdAt

**Example:**
```javascript
{
  "count": 3,
  "cards": [
    {
      "uri": "at://did:plc:abc/dev.skyboard.task/xyz",
      "title": "Fix navigation bug",
      "columnId": "todo",
      "boardUri": "at://did:plc:abc/dev.skyboard.board/123",
      "ownerDid": "did:plc:abc",
      "createdAt": "2025-02-10T10:00:00Z"
    }
  ]
}
```

### add-card

Add a new card to a skyboard.

**Parameters:**
- `title` (required): The title of the card/task
- `description` (optional): Optional description for the card
- `boardUri` (required): The board URI to add the card to
- `columnId` (required): The column ID within the board to add the card to

**Returns:**
- `success`: Boolean indicating success
- `card`: The created card object
- `message`: User-friendly message

**Example:**
```javascript
{
  "success": true,
  "card": {
    "uri": "at://did:plc:abc/dev.skyboard.task/new123",
    "title": "New feature request",
    "description": "Add user preferences",
    "columnId": "backlog",
    "boardUri": "at://did:plc:abc/dev.skyboard.board/123",
    "ownerDid": "did:plc:abc",
    "createdAt": "2025-02-10T10:30:00Z"
  },
  "message": "Card \"New feature request\" added to board"
}
```

### update-card

Update an existing card on a skyboard.

**Parameters:**
- `taskUri` (required): The URI of the task to update
- `title` (optional): New title for the card
- `description` (optional): New description for the card
- `columnId` (optional): Move card to a different column ID

**Note:** At least one of `title`, `description`, or `columnId` must be provided.

**Returns:**
- `success`: Boolean indicating success
- `card`: Updated card object (only includes changed fields)
- `message`: User-friendly message

**Example:**
```javascript
{
  "success": true,
  "card": {
    "uri": "at://did:plc:abc/dev.skyboard.task/xyz",
    "title": "Fix navigation bug (updated)",
    "columnId": "in-progress"
  },
  "message": "Card updated"
}
```

## Integration with Skyboard

The MCP provider integrates with Skyboard's existing systems:

1. **Authentication**: Uses the current user's DID from the auth module
2. **Storage**: Uses Dexie (IndexedDB) through the existing `db` module
3. **Collaboration**: For updates, creates `Op` records which are materialized with LWW (Last Writer Wins) merging
4. **Sync**: New cards and ops are set to `syncStatus: "pending"` and synced by the background sync process

## Event System

Card modifications dispatch custom events that UI components can listen to:

```typescript
window.addEventListener("skyboard-card-change", (event) => {
  const { type, taskUri, boardUri, columnId } = event.detail;
  // React to card changes
});
```

Event types:
- `"added"`: A new card was created
- `"updated"`: An existing card was modified

## Error Handling

The tools include appropriate error handling:

- Authentication required: Returns error if user is not signed in
- Not found: Returns error if task/board cannot be found
- Invalid input: Returns error for missing required parameters or invalid URIs

## Browser Compatibility

The MCP provider uses the WebMCP API (`navigator.modelContext`) with feature detection:

```typescript
if ("modelContext" in navigator) {
  // WebMCP is available
  navigator.modelContext.registerTool(tool);
}
```

If WebMCP is not available, the provider gracefully skips registration and logs a message.
