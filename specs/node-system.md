# Node System Specification

## Overview
Nodes are the fundamental data structure in Game Shaper AI, representing all game elements including characters, locations, items, events, and abstract concepts. They serve as persistent memory for the AI narrator and the backbone of the game world.

## Node Structure

### Core Properties
```typescript
interface Node {
  id: string;                    // Unique identifier
  name: string;                  // Display name/title
  longDescription: string;       // Detailed description (supports markdown)
  type: string;                  // Category/classification (free-form string)
  image: string;                 // Image URL or blob
  updateImage?: boolean;         // Flag for image regeneration
  imageSeed?: number;           // Seed for deterministic image generation
}
```

### Node Types
The `type` field is a free-form string allowing any categorization. Common types used in the system include:
- **`character`**: People, NPCs, entities with personality
- **`location`**: Places, environments, settings
- **`event`**: Happenings, situations, story beats
- **`item`**: Physical objects, tools, artifacts
- **`object`**: General physical entities
- **`mechanic`**: Game rules, systems, mechanics
- **`concept`**: Abstract ideas, themes, concepts
- **`library`**: Knowledge repositories, information stores
- **`system`**: Internal system nodes (protected from deletion)
- **`assistant`**: AI assistant nodes (protected from deletion)
- **`image_generation`**: Image generation configuration nodes
- **`Game Rule`** / **`Game Rules`**: Game system rules

Note: There are no enforced type constraints - the type field accepts any string value.

## Node Operations

### CRUD Operations
- **Create**: New nodes via LLM generation or manual creation
- **Update**: Field modifications through diff operations or replacement
- **Delete**: Removal with automatic cleanup (some types protected)
- **Query**: Relevance-based filtering and sorting

### Update Mechanisms
#### Replacement (`rpl`)
```json
{
  "name": { "rpl": "New Name" },
  "type": { "rpl": "New Type" }
}
```

#### Diff Operations (`df`)
```json
{
  "longDescription": {
    "df": [
      {
        "prev_txt": "old text",
        "next_txt": "new text",
        "occ": 1
      }
    ]
  }
}
```

#### Image Update Flag
```json
{
  "img_upd": true
}
```

## Node Management

### Persistence
- Stored in localStorage with LZString compression
- Automatic saving on state changes
- Error handling for storage quota exceeded
- `updateImage` flag is stripped before saving to localStorage

### Protection Rules
- System nodes (`system`, `assistant`, `image_generation`) cannot be deleted
- Protection is case-insensitive
- Image cleanup for blob URLs on deletion
- Validation for node operations

### Relevance System
- AI-driven relevance scoring based on current story context
- Automatic sorting by relevance to optimize token usage
- Maximum included nodes limit (configurable via VITE_MAX_INCLUDED_NODES)
- Feature can be disabled via VITE_FEATURE_SORT_NODES

## Integration Points

### With LLM Services
- Nodes provide context for narrative generation
- Node descriptions inform image generation
- Node updates based on story progression
- Nodes sanitized (image field removed) for Moxus feedback

### With UI Components
- Node grid display with search/filter
- Individual node editing interface
- Visual node relationship mapping
- Protection indicators for system nodes

### With Image System
- Automatic image generation for nodes with `updateImage: true`
- Image queue management for batch processing
- Support for multiple image generation backends
- Blob URL cleanup on node deletion

## Usage Patterns

### Story Progression
1. User action triggers LLM analysis
2. Relevant nodes identified and included in context
3. LLM generates narrative and proposes node updates
4. Node graph updated with new/modified/deleted nodes
5. Images regenerated for changed nodes
6. Background Moxus evaluation and feedback

### Game State Management
- Nodes represent complete game state
- Export/import functionality for game saves
- Twine story import creates initial node set
- Template creation for reusable game structures

## Best Practices

### Node Design
- Keep descriptions focused and specific
- Use appropriate node types for organization
- Leverage relationships between related nodes
- Maintain consistency in naming conventions

### Performance Optimization
- Limit number of nodes included in LLM context
- Use relevance filtering to prioritize important nodes
- Batch image generation to avoid API rate limits
- Compress stored data to manage storage quotas
- Strip temporary flags (updateImage) from persistent storage 