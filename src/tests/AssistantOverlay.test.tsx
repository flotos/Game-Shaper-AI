import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AssistantOverlay from '../components/AssistantOverlay';
import { Node } from '../models/Node';
import { regenerateSingleNode } from '../services/twineImportLLMService';
import { generateNodesFromPrompt } from '../services/llm';
import { moxusService } from '../services/MoxusService';

// Extend Jest matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeInTheDocument(): R;
      toBeEnabled(): R;
      toBeDisabled(): R;
    }
  }
}

// Mock the DiffViewer component
vi.mock('../components/DiffViewer', () => ({
  default: ({ original, updated }: { original: string, updated: string }) => (
    <div data-testid="mock-diff-viewer">
      <div>Original: {original}</div>
      <div>Updated: {updated}</div>
    </div>
  ),
}));

// Mock other dependencies
vi.mock('../services/twineImportLLMService', () => ({
  regenerateSingleNode: vi.fn()
}));

vi.mock('../services/llm', () => ({
  generateNodesFromPrompt: vi.fn()
}));

vi.mock('../services/MoxusService', () => ({
  moxusService: {
    getMoxusMemory: vi.fn(),
    getMoxusPersonalityContext: vi.fn(),
    addTask: vi.fn()
  }
}));

describe('AssistantOverlay - Regenerate Node Feature', () => {
  // Sample nodes for testing
  const mockNodes: Node[] = [
    { 
      id: 'node1', 
      name: 'Test Node 1', 
      longDescription: 'This is test node 1', 
      image: 'image1.jpg', 
      type: 'character'
    },
    { 
      id: 'node2', 
      name: 'Test Node 2', 
      longDescription: 'This is test node 2', 
      image: 'image2.jpg', 
      type: 'location'
    }
  ];
  
  // Mock functions
  const mockUpdateGraph = vi.fn();
  const mockCloseOverlay = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mock returns
    (generateNodesFromPrompt as any).mockResolvedValue({
      merge: [
        { 
          id: 'node1', 
          name: 'Updated Node 1', 
          longDescription: 'Updated description for node 1', 
          type: 'character',
          updateImage: false
        }
      ]
    });

    (regenerateSingleNode as any).mockResolvedValue({
      id: 'node1',
      name: 'Regenerated Node 1',
      longDescription: 'This is a regenerated description',
      type: 'character',
      updateImage: true
    });
  });

  it('regenerates a node when the regenerate button is clicked', async () => {
    render(
      <AssistantOverlay 
        nodes={mockNodes} 
        updateGraph={mockUpdateGraph}
        closeOverlay={mockCloseOverlay}
      />
    );
    
    // Enter query and submit
    const textInput = screen.getByPlaceholderText('Enter your request here...');
    fireEvent.change(textInput, { target: { value: 'Make the story more exciting' } });
    
    const submitButton = screen.getByRole('button', { name: 'Submit' });
    fireEvent.click(submitButton);
    
    // Wait for preview to be shown
    await waitFor(() => {
      expect(screen.getByText('Preview Changes')).toBeInTheDocument();
    });
    
    // Click regenerate button for Node 1
    const regenerateButtons = await screen.findAllByText('Regenerate Node');
    fireEvent.click(regenerateButtons[0]);
    
    // Verify regenerateSingleNode was called with correct params
    await waitFor(() => {
      expect(regenerateSingleNode).toHaveBeenCalledWith(
        'node1',
        expect.objectContaining({ id: 'node1' }),
        { chunks: [[]] },
        mockNodes,
        'merge_story',
        'Make the story more exciting',
        expect.objectContaining({ id: 'node1' })
      );
    });
    
    // Verify the regenerated content appears in the UI
    await waitFor(() => {
      expect(screen.getByText('Regenerated Node 1')).toBeInTheDocument();
    });
  });

  it('handles errors during node regeneration', async () => {
    // Make regenerateSingleNode fail
    const mockError = new Error('Failed to regenerate node');
    (regenerateSingleNode as any).mockRejectedValueOnce(mockError);

    render(
      <AssistantOverlay 
        nodes={mockNodes} 
        updateGraph={mockUpdateGraph}
        closeOverlay={mockCloseOverlay}
      />
    );
    
    // Enter query and submit
    const textInput = screen.getByPlaceholderText('Enter your request here...');
    fireEvent.change(textInput, { target: { value: 'Make the story more exciting' } });
    
    const submitButton = screen.getByRole('button', { name: 'Submit' });
    fireEvent.click(submitButton);
    
    // Wait for preview to be shown
    await waitFor(() => {
      expect(screen.getByText('Preview Changes')).toBeInTheDocument();
    });
    
    // Click regenerate button
    const regenerateButtons = await screen.findAllByText('Regenerate Node');
    fireEvent.click(regenerateButtons[0]);
    
    // Verify error is shown
    await waitFor(() => {
      expect(screen.getByText('Failed to regenerate node: Failed to regenerate node')).toBeInTheDocument();
    });
  });
}); 