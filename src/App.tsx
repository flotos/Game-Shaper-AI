import React, { useRef, useState, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import NodeGraphInterface from './components/NodeGraphInterface';
import useNodeGraph from './models/useNodeGraph';
import { useChat, Message } from './context/ChatContext';
import NodeEditorOverlay from './components/NodeEditorOverlay';
import AssistantOverlay from './components/AssistantOverlay';
import TwineImportOverlay from './components/TwineImportOverlay';
import { moxusService } from './services/MoxusService';

const AppContent: React.FC = () => {
  const { nodes, addNode, updateNode, deleteNode, updateGraph, setNodes } = useNodeGraph();
  const { chatHistory, setChatHistory, clearChatHistory, addMessage } = useChat();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showNodeEditor, setShowNodeEditor] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [showTwineImport, setShowTwineImport] = useState(false);

  useEffect(() => {
    moxusService.initialize(() => nodes, addMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps 
  }, [addMessage]);

  const clearLocalStorage = () => {
    localStorage.removeItem('nodeGraph');
    localStorage.removeItem('chatHistory');
    window.location.reload();
  };

  const exportToJson = () => {
    const dataStr = JSON.stringify({ nodes, chatHistory }, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nodeGraph.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const importFromJson = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { nodes: importedNodes, chatHistory: importedChatHistory } = JSON.parse(e.target?.result as string);
        setNodes(importedNodes);
        setChatHistory(importedChatHistory);
      } catch (error) {
        console.error('Failed to import JSON', error);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-800 text-white">
      <header className="flex justify-between items-center bg-gray-900 shadow-md">
        <h1 className="text-xl font-bold">Game Shaper AI</h1>
        <div className="flex space-x-4">
          <button 
            onClick={() => setShowAssistant(true)} 
            className="px-1 bg-slate-800 text-white rounded hover:bg-purple-700"
          >
            Assistant
          </button>
          <button 
            onClick={clearLocalStorage} 
            className="px-1 bg-slate-800 text-white rounded hover:bg-red-700"
          >
            Reset game
          </button>
          <button 
            onClick={clearChatHistory} 
            className="px-1 bg-slate-800 text-white rounded hover:bg-orange-700"
          >
            Reset chat
          </button>
          <button 
            onClick={exportToJson} 
            className="px-1 bg-slate-800 text-white rounded hover:bg-blue-700"
          >
            Export save
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()} 
            className="px-1 bg-slate-800 text-white rounded hover:bg-green-700"
          >
            Import save
          </button>
          <button 
            onClick={() => setShowTwineImport(true)} 
            className="px-1 bg-slate-800 text-white rounded hover:bg-indigo-700"
          >
            Import Twine
          </button>
          <button 
            onClick={() => setShowNodeEditor(true)} 
            className="px-1 bg-slate-800 text-white rounded hover:bg-yellow-700"
          >
            Edit Nodes
          </button>
          <input 
            type="file" 
            accept="application/json" 
            ref={fileInputRef} 
            onChange={importFromJson} 
            className="hidden" 
          />
        </div>
      </header>
      <div className="flex flex-grow overflow-y-auto">
        <ChatInterface nodes={nodes} updateGraph={updateGraph} addMessage={addMessage} />
        <NodeGraphInterface nodes={nodes} updateGraph={updateGraph} />
      </div>
      
      {showNodeEditor && (
        <NodeEditorOverlay
          nodes={nodes}
          addNode={addNode}
          updateNode={updateNode}
          deleteNode={deleteNode}
          closeOverlay={() => setShowNodeEditor(false)}
          updateGraph={updateGraph}
        />
      )}

      {showAssistant && (
        <AssistantOverlay
          nodes={nodes}
          updateGraph={updateGraph}
          closeOverlay={() => setShowAssistant(false)}
        />
      )}

      {showTwineImport && (
        <TwineImportOverlay
          nodes={nodes}
          updateGraph={updateGraph}
          closeOverlay={() => setShowTwineImport(false)}
        />
      )}
    </div>
  );
};

export default AppContent;
