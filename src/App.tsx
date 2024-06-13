import React, { useRef, useState } from 'react';
import ChatInterface from './components/ChatInterface';
import NodeGraphInterface from './components/NodeGraphInterface';
import useNodeGraph from './models/useNodeGraph';
import useChatHistory from './hooks/useChatHistory';
import NodeEditorOverlay from './components/NodeEditorOverlay';

const App: React.FC = () => {
  const { nodes, addNode, updateNode, deleteNode, updateGraph } = useNodeGraph();
  const { chatHistory, setChatHistory } = useChatHistory();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showNodeEditor, setShowNodeEditor] = useState(false);

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
        localStorage.setItem('nodeGraph', JSON.stringify(importedNodes));
        localStorage.setItem('chatHistory', JSON.stringify(importedChatHistory));
        window.location.reload();
      } catch (error) {
        console.error('Failed to import JSON', error);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-800 text-white">
      <header className="flex justify-between items-center bg-gray-900 shadow-md">
        <h1 className="text-xl font-bold">Node Graph App</h1>
        <div className="flex space-x-4">
          <button 
            onClick={clearLocalStorage} 
            className="px-1 bg-slate-800 text-white rounded hover:bg-red-700"
          >
            Reset game
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
        <ChatInterface nodes={nodes} updateGraph={updateGraph} />
        <NodeGraphInterface nodes={nodes} />
      </div>
      {showNodeEditor && (
        <NodeEditorOverlay
          nodes={nodes}
          addNode={addNode}
          updateNode={updateNode}
          deleteNode={deleteNode}
          closeOverlay={() => setShowNodeEditor(false)}
        />
      )}
    </div>
  );
};

export default App;
