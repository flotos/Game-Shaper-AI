import React, { useRef, useState, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import NodeGraphInterface from './components/NodeGraphInterface';
import useNodeGraph from './models/useNodeGraph';
import { useChat, Message } from './context/ChatContext';
import NodeEditorOverlay from './components/NodeEditorOverlay';
import AssistantOverlay from './components/AssistantOverlay';
import TwineImportOverlay from './components/TwineImportOverlay';
import { moxusService } from './services/MoxusService';
import './services/LLMService';

const MoxusMemoryModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [memoryYaml, setMemoryYaml] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [pendingTasks, setPendingTasks] = useState(0);
  
  const refreshMemory = () => {
    setIsLoading(true);
    setPendingTasks(moxusService.getPendingTaskCount());
    // Use setTimeout to allow the loading state to be rendered
    setTimeout(() => {
      try {
        setMemoryYaml(moxusService.getLLMCallsMemoryYAML());
      } catch (error) {
        console.error("Error getting Moxus memory:", error);
        setMemoryYaml("Error loading Moxus memory YAML");
      } finally {
        setIsLoading(false);
      }
    }, 100);
  };
  
  const exportMemoryYaml = () => {
    const blob = new Blob([memoryYaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `moxus-memory-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.yaml`;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    refreshMemory();
    
    // Set up interval to check pending tasks regularly
    const intervalId = setInterval(() => {
      setPendingTasks(moxusService.getPendingTaskCount());
    }, 1000);
    
    // Clean up
    return () => clearInterval(intervalId);
  }, []);
  
  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex justify-center items-center z-50">
      <div className="bg-slate-900 p-6 rounded shadow-md w-3/4 h-3/4 flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl">
            Moxus Memory (YAML)
            {pendingTasks > 0 && (
              <span className="ml-2 bg-cyan-600 text-white text-sm rounded-full px-2 py-0.5">
                {pendingTasks} pending tasks
              </span>
            )}
          </h2>
          <div className="flex space-x-2">
            <button 
              onClick={exportMemoryYaml}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              disabled={isLoading}
            >
              Export YAML
            </button>
            <button 
              onClick={refreshMemory}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              disabled={isLoading}
            >
              {isLoading ? "Loading..." : "Refresh"}
            </button>
            <button 
              onClick={onClose}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Close
            </button>
          </div>
        </div>
        {isLoading ? (
          <div className="flex-grow flex items-center justify-center">
            <div className="animate-pulse text-xl">Loading Moxus memory...</div>
          </div>
        ) : (
          <pre className="bg-gray-800 p-4 rounded overflow-auto flex-grow text-green-300 font-mono text-sm">
            {memoryYaml}
          </pre>
        )}
      </div>
    </div>
  );
};

const AppContent: React.FC = () => {
  const { nodes, addNode, updateNode, deleteNode, updateGraph, setNodes } = useNodeGraph();
  const { chatHistory, setChatHistory, clearChatHistory, addMessage } = useChat();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showNodeEditor, setShowNodeEditor] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [showTwineImport, setShowTwineImport] = useState(false);
  const [showMoxusMemory, setShowMoxusMemory] = useState(false);
  const [pendingMoxusTasks, setPendingMoxusTasks] = useState(0);

  useEffect(() => {
    moxusService.initialize(() => nodes, addMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps 
  }, [addMessage]);

  // Update the pending tasks counter
  useEffect(() => {
    const checkPendingTasks = () => {
      setPendingMoxusTasks(moxusService.getPendingTaskCount());
    };
    
    // Check initially
    checkPendingTasks();
    
    // Set up interval to check regularly
    const intervalId = setInterval(checkPendingTasks, 1000);
    
    // Clean up
    return () => clearInterval(intervalId);
  }, []);

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
          <button 
            onClick={() => setShowMoxusMemory(true)} 
            className="px-1 relative bg-slate-800 text-white rounded hover:bg-cyan-700"
          >
            Moxus YAML
            {pendingMoxusTasks > 0 && (
              <span className="absolute -top-2 -right-2 bg-cyan-600 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[18px]">
                {pendingMoxusTasks}
              </span>
            )}
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

      {showMoxusMemory && (
        <MoxusMemoryModal
          onClose={() => setShowMoxusMemory(false)}
        />
      )}
    </div>
  );
};

export default AppContent;
