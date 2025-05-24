# User Interface Specification

## Overview
Game Shaper AI features a dual-pane interface combining real-time chat interaction with visual node management. The UI is built with React, TypeScript, and Tailwind CSS, providing an intuitive experience for both narrative interaction and game state management.

## Main Interface Layout

### Header Bar
- **Application Title**: "Game Shaper AI" branding
- **Action Buttons**: Quick access to main features
  - Assistant: AI-powered node generation
  - Reset Game: Clear all data and restart
  - Reset Chat: Clear chat history only
  - Export Save: Download complete game state
  - Import Save: Load saved game state
  - Import Twine: Convert Twine stories to nodes
  - Edit Nodes: Manual node management
  - Moxus JSON: View AI feedback memory
  - Regen All Images: Refresh all node images

### Split-Pane Layout
```
┌─────────────────┬─────────────────┐
│                 │                 │
│   Chat Pane     │   Node Pane     │
│   (Left 50%)    │   (Right 50%)   │
│                 │                 │
│                 │                 │
└─────────────────┴─────────────────┘
```

## Chat Interface Components

### ChatInterface (`ChatInterface.tsx`)
- **Purpose**: Main narrative interaction area
- **Features**:
  - Streaming text display with typewriter effect
  - User input with suggested actions
  - Message history with role-based styling
  - Real-time response generation

### ChatHistory (`ChatHistory.tsx`)
- **Purpose**: Display conversation history
- **Features**:
  - Scrollable message list
  - Role-based message styling (user/assistant/moxus)
  - Automatic scrolling to latest messages
  - Message timestamp display

### ChatBubble (`ChatBubble.tsx`)
- **Purpose**: Individual message display
- **Features**:
  - Role-specific styling and icons
  - Markdown rendering support
  - Copy message functionality
  - Moxus feedback highlighting

### ChatInput (`ChatInput.tsx`)
- **Purpose**: User input and action selection
- **Features**:
  - Text input with send button
  - Suggested action buttons
  - Input validation and submission
  - Loading states during processing

## Node Management Components

### NodeGraphInterface (`NodeGraphInterface.tsx`)
- **Purpose**: Visual node management and display
- **Features**:
  - Grid-based node layout
  - Search and filter functionality
  - Drag-and-drop positioning
  - Node type filtering
  - Relevance-based sorting

### NodeGridItem (`NodeGridItem.tsx`)
- **Purpose**: Individual node display card
- **Features**:
  - Node image display with lazy loading
  - Name and type information
  - Edit and delete actions
  - Visual indicators for node states
  - Click to view detailed information

### NodeEditorOverlay (`NodeEditorOverlay.tsx`)
- **Purpose**: Manual node creation and editing
- **Features**:
  - Modal overlay for focused editing
  - Form inputs for all node properties
  - Image upload and URL input
  - Node type selection
  - Validation and error handling

## Specialized Overlays

### AssistantOverlay (`AssistantOverlay.tsx`)
- **Purpose**: AI-powered node generation
- **Features**:
  - Custom prompt input
  - Node generation preview
  - Batch operations for multiple nodes
  - Integration with Moxus memory
  - Progress tracking for generation

### TwineImportOverlay (`TwineImportOverlay.tsx`)
- **Purpose**: Convert Twine stories to game nodes
- **Features**:
  - File upload for Twine files
  - Story parsing and preview
  - Node mapping configuration
  - Merge vs. replace options
  - Progress tracking for conversion

### DetailsOverlay (`DetailsOverlay.tsx`)
- **Purpose**: Detailed node information display
- **Features**:
  - Full node description viewing
  - Image gallery functionality
  - Related node navigation
  - Edit shortcuts

## Debug and Development Components

### LLMLoggerPanel (`LLMLoggerPanel.tsx`)
- **Purpose**: Debug panel for LLM call monitoring
- **Features**:
  - Real-time call log display
  - Detailed request/response viewing
  - Performance metrics
  - Error tracking and analysis
  - Export functionality for debugging

### LLMLoggerBubble (`LLMLoggerBubble.tsx`)
- **Purpose**: Floating toggle for logger panel
- **Features**:
  - Unobtrusive access to debug tools
  - Status indicators for active operations
  - Quick access positioning

## Visual Design System

### Color Scheme
- **Primary Background**: Dark gray (`bg-gray-800`)
- **Secondary Background**: Darker gray (`bg-gray-900`)
- **Accent Colors**: Tailwind color palette
- **Text**: High contrast white on dark
- **Interactive Elements**: Hover states and transitions

### Typography
- **Headers**: Bold, hierarchical sizing
- **Body Text**: Readable font sizing
- **Code/Technical**: Monospace font family
- **UI Labels**: Clear, concise labeling

### Layout Principles
- **Responsive Design**: Adapts to different screen sizes
- **Grid System**: Consistent spacing and alignment
- **Visual Hierarchy**: Clear information organization
- **Accessibility**: ARIA labels and keyboard navigation

## State Management

### React Context
- **ChatContext**: Global chat state management
- **State Persistence**: localStorage integration
- **Error Boundaries**: Graceful error handling
- **Loading States**: User feedback during operations

### Component Communication
- **Props**: Data flow between components
- **Callbacks**: Event handling and state updates
- **Custom Hooks**: Reusable state logic
- **Context Providers**: Global state sharing

## User Experience Patterns

### Progressive Disclosure
- **Overlay System**: Detailed views without navigation
- **Expandable Sections**: Show/hide additional information
- **Contextual Actions**: Relevant actions based on current state
- **Smart Defaults**: Sensible initial configurations

### Feedback and Responsiveness
- **Loading Indicators**: Clear progress communication
- **Error Messages**: Helpful error descriptions
- **Success Confirmation**: Positive feedback for actions
- **Real-time Updates**: Immediate response to user actions

### Accessibility Features
- **Keyboard Navigation**: Full keyboard accessibility
- **Screen Reader Support**: ARIA labels and descriptions
- **High Contrast**: Readable color combinations
- **Focus Management**: Clear focus indicators

## Performance Optimizations

### Rendering Efficiency
- **Memoization**: React.memo for expensive components
- **Virtual Scrolling**: Efficient large list rendering
- **Lazy Loading**: Images loaded on demand
- **Component Splitting**: Code splitting for faster loads

### State Optimization
- **Selective Re-renders**: Targeted component updates
- **Debounced Inputs**: Reduced API calls
- **Cached Computations**: Expensive calculation caching
- **Optimistic Updates**: Immediate UI feedback

## Mobile Responsiveness

### Adaptive Layout
- **Responsive Breakpoints**: Mobile, tablet, desktop layouts
- **Touch Interactions**: Mobile-friendly touch targets
- **Gesture Support**: Swipe and pinch interactions
- **Viewport Optimization**: Proper mobile viewport handling

### Mobile-Specific Features
- **Collapsed Navigation**: Space-efficient mobile menus
- **Touch-Friendly Buttons**: Appropriately sized interactive elements
- **Optimized Images**: Responsive image loading
- **Performance Considerations**: Reduced resource usage on mobile

## Integration Points

### External Services
- **Image Loading**: Efficient image display and caching
- **File Handling**: Upload and download functionality
- **API Integration**: Seamless LLM service communication
- **Error Recovery**: Graceful handling of service failures

### Data Flow
- **Node Updates**: Real-time node state synchronization
- **Chat Streaming**: Live text generation display
- **Background Operations**: Non-blocking background tasks
- **State Persistence**: Automatic save and recovery 