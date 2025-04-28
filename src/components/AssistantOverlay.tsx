import React, { useState } from 'react';
import { Node } from '../models/Node';
import { generateNodesFromPrompt } from '../services/LLMService';

interface AssistantOverlayProps {
  nodes: Node[];
  updateGraph: (nodeEdition: { merge?: Partial<Node>[], delete?: string[] }) => void;
  closeOverlay: () => void;
}

const AssistantOverlay: React.FC<AssistantOverlayProps> = ({ nodes, updateGraph, closeOverlay }) => {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!query.trim()) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      const response = await generateNodesFromPrompt(query, nodes);
      updateGraph(response);
      closeOverlay();
    } catch (err) {
      setError('Failed to process your request. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex justify-center items-center z-50">
      <div className="bg-slate-900 p-6 rounded shadow-md w-3/4 max-w-2xl">
        <h2 className="text-xl mb-4 text-white">Game Assistant</h2>
        <p className="text-gray-300 mb-4">
          Ask the assistant to modify your game. Examples:
          <ul className="list-disc list-inside mt-2 text-gray-400">
            <li>Make the game more challenging</li>
            <li>Change the story to be more like a fantasy adventure</li>
            <li>Add more puzzle elements</li>
          </ul>
        </p>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter your request here..."
          className="w-full p-2 mb-4 border border-gray-700 rounded bg-gray-900 text-white min-h-[100px]"
        />
        {error && <p className="text-red-500 mb-4">{error}</p>}
        <div className="flex justify-end space-x-4">
          <button
            onClick={closeOverlay}
            className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || !query.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Processing...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssistantOverlay; 