import React, { useRef, useState, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import NodeGraphInterface from './components/NodeGraphInterface';
import useNodeGraph from './models/useNodeGraph';
import { useChat, Message, ChatProvider } from './context/ChatContext';
import NodeEditorOverlay from './components/NodeEditorOverlay';
import AssistantOverlay from './components/AssistantOverlay';
import TwineImportOverlay from './components/TwineImportOverlay';
import { moxusService } from './services/MoxusService';
import './services/llm';
import { LLMLoggerBubble } from './components/LLMLoggerBubble';
import { LLMLoggerPanel } from './components/LLMLoggerPanel';
import { NodeSpecificUpdates, LLMNodeEditionResponse } from './models/nodeOperations';
import ReactMarkdown from 'react-markdown';
import { getLocalStorageUsage, getLocalStorageQuotaInfo, cleanupUnusedImageEntries, formatBytes } from './utils/localStorageUtils';

const MoxusMemoryModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [memoryJson, setMemoryJson] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [pendingTasks, setPendingTasks] = useState(0);
  const [activeTab, setActiveTab] = useState<string>("generalMemory");
  const [parsedMemory, setParsedMemory] = useState<any>(null);
  
  const refreshMemory = () => {
    setIsLoading(true);
    setPendingTasks(moxusService.getPendingTaskCount());
    setTimeout(() => {
      try {
        const jsonString = moxusService.getLLMCallsMemoryJSON();
        setMemoryJson(jsonString);
        
        // Parse the JSON to extract sections
        try {
          const parsed = JSON.parse(jsonString);
          setParsedMemory(parsed);
        } catch (parseError) {
          console.error("Error parsing Moxus memory JSON:", parseError);
          setParsedMemory(null);
        }
      } catch (error) {
        console.error("Error getting Moxus memory:", error);
        setMemoryJson("Error loading Moxus memory JSON");
        setParsedMemory(null);
      } finally {
        setIsLoading(false);
      }
    }, 100);
  };
  
  const exportMemoryJson = () => {
    const blob = new Blob([memoryJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `moxus-memory-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const resetMemory = () => {
    setIsLoading(true);
    moxusService.resetMemory();
    refreshMemory();
  };

  useEffect(() => {
    refreshMemory();
    const intervalId = setInterval(() => {
      setPendingTasks(moxusService.getPendingTaskCount());
    }, 1000);
    return () => clearInterval(intervalId);
  }, []);

  const tabs = [
    { id: "generalMemory", label: "General Memory", content: parsedMemory?.GeneralMemory },
    { id: "nodeEdition", label: "Node Edition", content: parsedMemory?.featureSpecificMemory?.nodeEdition },
    { id: "chatText", label: "Chat Text", content: parsedMemory?.featureSpecificMemory?.chatText },
    { id: "assistantFeedback", label: "Assistant Feedback", content: parsedMemory?.featureSpecificMemory?.assistantFeedback },
    { id: "nodeEdit", label: "Node Edit", content: parsedMemory?.featureSpecificMemory?.nodeEdit },
    { id: "recentFeedback", label: "Recent Feedback", content: parsedMemory?.recentLLMFeedback },
    { id: "rawJson", label: "Raw JSON", content: memoryJson }
  ];

  const renderTabContent = (content: any, tabId: string) => {
    if (!content) {
      return (
        <div className="flex items-center justify-center h-32 text-gray-400">
          <p>No content available for this section</p>
        </div>
      );
    }

    if (tabId === "recentFeedback") {
      return (
        <div className="h-full overflow-y-auto">
          <div className="space-y-4">
            {Array.isArray(content) ? content.map((feedback, index) => (
              <div key={index} className="bg-gray-800 p-4 rounded-lg border border-gray-600">
                <div className="mb-2">
                  <span className="text-cyan-400 font-mono text-sm">ID: {feedback.id}</span>
                </div>
                <div className="prose prose-invert max-w-none">
                  <ReactMarkdown>{feedback.feedback}</ReactMarkdown>
                </div>
              </div>
            )) : (
              <div className="prose prose-invert max-w-none">
                <ReactMarkdown>{typeof content === 'string' ? content : JSON.stringify(content, null, 2)}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (tabId === "rawJson") {
      return (
        <div className="h-full overflow-auto">
          <pre className="bg-gray-800 p-4 rounded text-green-300 font-mono text-sm whitespace-pre-wrap">
            {content}
          </pre>
        </div>
      );
    }

    // For other tabs, render as markdown
    const contentToRender = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    return (
      <div className="h-full overflow-y-auto">
        <div className="prose prose-invert max-w-none">
          <ReactMarkdown>{contentToRender}</ReactMarkdown>
        </div>
      </div>
    );
  };
  
  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex justify-center items-center z-50">
      <div className="bg-slate-900 p-6 rounded shadow-md w-5/6 h-5/6 flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl">
            Moxus Memory
            {pendingTasks > 0 && (
              <span className="ml-2 bg-cyan-600 text-white text-sm rounded-full px-2 py-0.5">
                {pendingTasks} pending tasks
              </span>
            )}
          </h2>
          <div className="flex space-x-2">
            <button 
              onClick={resetMemory}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              disabled={isLoading}
            >
              Reset to Default
            </button>
            <button 
              onClick={exportMemoryJson}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              disabled={isLoading}
            >
              Export JSON
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
          <div className="flex flex-col flex-grow min-h-0">
            {/* Tab Navigation */}
            <div className="flex flex-wrap border-b border-gray-600 mb-4 flex-shrink-0">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 mr-2 mb-2 rounded-t transition-colors ${
                    activeTab === tab.id
                      ? 'bg-cyan-600 text-white border-b-2 border-cyan-400'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-grow min-h-0 bg-gray-800 p-4 rounded">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`h-full ${activeTab === tab.id ? 'block' : 'hidden'}`}
                >
                  {renderTabContent(tab.content, tab.id)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const StorageManagerModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [storageInfo, setStorageInfo] = useState<any>(null);
  const [quotaInfo, setQuotaInfo] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const refreshStorageInfo = async () => {
    setIsLoading(true);
    try {
      const usage = getLocalStorageUsage();
      const quota = await getLocalStorageQuotaInfo();
      setStorageInfo(usage);
      setQuotaInfo(quota);
    } catch (error) {
      console.error('Error refreshing storage info:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCleanupImages = () => {
    const result = cleanupUnusedImageEntries();
    alert(`Cleaned up ${result.itemsRemoved} orphaned image entries, freed ${result.formattedBytesFreed} of space.`);
    refreshStorageInfo();
  };

  const handleCleanupMoxusMemory = () => {
    if (confirm('This will reset all Moxus memory and analysis data. Are you sure?')) {
      moxusService.resetMemory();
      alert('Moxus memory has been reset.');
      refreshStorageInfo();
    }
  };

  const handleCleanupChatHistory = () => {
    if (confirm('This will clear all chat history. Are you sure?')) {
      localStorage.removeItem('chatHistory');
      alert('Chat history has been cleared.');
      refreshStorageInfo();
    }
  };

  useEffect(() => {
    refreshStorageInfo();
  }, []);

  const getLargestItems = () => {
    if (!storageInfo) return [];
    return Object.entries(storageInfo.sizeByKey)
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .slice(0, 10);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Storage Manager</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">×</button>
        </div>

        {isLoading ? (
          <div className="text-center py-8">Loading storage information...</div>
        ) : (
          <div className="space-y-6">
            {/* Storage Overview */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-lg font-semibold mb-2">Storage Overview</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-gray-600">Total Used</div>
                  <div className="font-mono">{storageInfo?.formattedTotalSize || '0 B'}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Items Count</div>
                  <div className="font-mono">{storageInfo?.itemCount || 0}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Browser Quota</div>
                  <div className="font-mono">{quotaInfo?.formattedQuota || 'Unknown'}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Available</div>
                  <div className="font-mono">{quotaInfo?.formattedAvailable || 'Unknown'}</div>
                </div>
              </div>
            </div>

            {/* Cleanup Actions */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-lg font-semibold mb-2">Cleanup Actions</h3>
              <div className="space-y-2">
                <button 
                  onClick={handleCleanupImages}
                  className="w-full md:w-auto px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Clean Orphaned Images
                </button>
                <button 
                  onClick={handleCleanupMoxusMemory}
                  className="w-full md:w-auto px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 ml-0 md:ml-2"
                >
                  Reset Moxus Memory
                </button>
                <button 
                  onClick={handleCleanupChatHistory}
                  className="w-full md:w-auto px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 ml-0 md:ml-2"
                >
                  Clear Chat History
                </button>
                <button 
                  onClick={refreshStorageInfo}
                  className="w-full md:w-auto px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 ml-0 md:ml-2"
                >
                  Refresh Info
                </button>
              </div>
            </div>

            {/* Largest Items */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-lg font-semibold mb-2">Largest Storage Items</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1">Key</th>
                      <th className="text-right py-1">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getLargestItems().map(([key, size]) => (
                      <tr key={key} className="border-b">
                        <td className="py-1 font-mono text-xs truncate max-w-xs">{key}</td>
                        <td className="py-1 text-right font-mono">{formatBytes(size as number)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Storage Tips */}
            <div className="bg-yellow-50 p-4 rounded-lg">
              <h3 className="text-lg font-semibold mb-2">Storage Management Tips</h3>
              <ul className="text-sm space-y-1">
                <li>• Generated images (data URLs) can be very large - consider regenerating them if needed</li>
                <li>• Moxus memory grows over time with AI analysis - reset periodically if storage is limited</li>
                <li>• Export your game state before major cleanups to preserve your progress</li>
                <li>• Browser localStorage typically has a 5-10MB limit</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const AppContent: React.FC = () => {
  const { getNodes, addNode, updateNode, deleteNode, updateGraph, setNodes } = useNodeGraph();
  const { addMessage, getChatHistory, setChatHistory, clearChatHistory } = useChat();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showNodeEditor, setShowNodeEditor] = useState(false);
  const [showMoxusMemory, setShowMoxusMemory] = useState(false);
  const [showStorageManager, setShowStorageManager] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [initialSelectedNodeId, setInitialSelectedNodeId] = useState<string | undefined>(undefined);
  const [showTwineImport, setShowTwineImport] = useState(false);
  const [pendingMoxusTasks, setPendingMoxusTasks] = useState(0);
  const [showLLMLogger, setShowLLMLogger] = useState(false);
  const moxusInitLoggedRef = useRef(false);

  useEffect(() => {
    if (typeof getNodes === 'function' && 
        typeof addMessage === 'function' && 
        typeof getChatHistory === 'function') {
      moxusService.initialize(getNodes, addMessage, getChatHistory);
      if (!moxusInitLoggedRef.current) {
        console.log('[App.tsx] MoxusService initialized successfully.');
        moxusInitLoggedRef.current = true;
      }
    } else {
      console.warn(
        '[App.tsx] Could not initialize MoxusService: One or more required callback functions are undefined or not functions. getNodes type:',
        typeof getNodes,
        'addMessage type:',
        typeof addMessage,
        'getChatHistory type:',
        typeof getChatHistory
      );
    }
  }, [getNodes, addMessage, getChatHistory]);

  useEffect(() => {
    const checkPendingTasks = () => {
      setPendingMoxusTasks(moxusService.getPendingTaskCount());
    };
    checkPendingTasks();
    const intervalId = setInterval(checkPendingTasks, 1000);
    return () => clearInterval(intervalId);
  }, []);

  const handleRegenerateAllImages = () => {
    if (getNodes && getNodes().length > 0) {
      const nodesToUpdate = getNodes();
      const u_nodes: { [nodeId: string]: NodeSpecificUpdates } = {};
      nodesToUpdate.forEach(node => {
        if (node.type !== 'Game Rule' && node.type !== 'Game Rules' && node.type !== 'system') {
          u_nodes[node.id] = { img_upd: true };
        }
      });

      if (Object.keys(u_nodes).length > 0) {
        const syntheticCallId = `regenAllImages-${Date.now()}`;
        updateGraph({ callId: syntheticCallId, u_nodes: u_nodes }, [], [], true);
        console.log('Relevant images queued for regeneration.');
      } else {
        console.log('No nodes eligible for image regeneration.');
      }
    } else {
      console.log('No nodes available to regenerate images.');
    }
  };

  const openNodeEditor = (nodeId?: string) => {
    setInitialSelectedNodeId(nodeId);
    setShowNodeEditor(true);
  };

  const closeNodeEditor = () => {
    setShowNodeEditor(false);
    setInitialSelectedNodeId(undefined);
  };

  const clearLocalStorage = () => {
    localStorage.removeItem('nodeGraph');
    localStorage.removeItem('chatHistory');
    moxusService.resetMemory();
    window.location.reload();
  };

  const exportToJson = () => {
    const dataStr = JSON.stringify({
      nodes: getNodes(),
      chatHistory: getChatHistory(),
      moxusMemory: moxusService.getMoxusMemory()
    }, null, 2);
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
        const { nodes: importedNodes, chatHistory: importedChatHistory, moxusMemory } = JSON.parse(e.target?.result as string);
        setNodes(importedNodes);
        setChatHistory(importedChatHistory);
        if (moxusMemory) {
          moxusService.setMoxusMemory(moxusMemory);
        }
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
            onClick={() => openNodeEditor()} 
            className="px-1 bg-slate-800 text-white rounded hover:bg-yellow-700"
          >
            Edit Nodes
          </button>
          <button 
            onClick={() => setShowMoxusMemory(true)} 
            className="px-1 relative bg-slate-800 text-white rounded hover:bg-cyan-700"
          >
            Moxus JSON{pendingMoxusTasks > 0 && ` (${pendingMoxusTasks})`}
          </button>
          <button
            onClick={() => setShowStorageManager(true)}
            className="px-1 bg-slate-800 text-white rounded hover:bg-purple-700"
            title="Storage Manager"
          >
            Storage
          </button>
          <button
            onClick={handleRegenerateAllImages}
            className="px-1 bg-slate-800 text-white rounded hover:bg-teal-700"
            title="Regenerate All Images"
          >
            Regen All Images
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
        <ChatInterface nodes={getNodes()} updateGraph={updateGraph} addMessage={addMessage} />
        <NodeGraphInterface nodes={getNodes()} updateGraph={updateGraph} onNodesSorted={setNodes} onEditNode={openNodeEditor} />
      </div>
      
      {showNodeEditor && (
        <NodeEditorOverlay
          nodes={getNodes()}
          addNode={addNode}
          updateNode={updateNode}
          deleteNode={deleteNode}
          closeOverlay={closeNodeEditor}
          updateGraph={updateGraph}
          initialSelectedNodeId={initialSelectedNodeId}
        />
      )}

      {showAssistant && (
        <AssistantOverlay
          nodes={getNodes()}
          updateGraph={updateGraph}
          closeOverlay={() => setShowAssistant(false)}
        />
      )}

      {showTwineImport && (
        <TwineImportOverlay
          nodes={getNodes()}
          updateGraph={updateGraph}
          closeOverlay={() => setShowTwineImport(false)}
        />
      )}

      {showMoxusMemory && (
        <MoxusMemoryModal
          onClose={() => setShowMoxusMemory(false)}
        />
      )}

      {showStorageManager && (
        <StorageManagerModal
          onClose={() => setShowStorageManager(false)}
        />
      )}

      {/* LLM Logger UI */}
      <LLMLoggerBubble 
        isOpen={showLLMLogger} 
        togglePanel={() => setShowLLMLogger(prev => !prev)} 
      />
      {showLLMLogger && 
        <LLMLoggerPanel 
          isOpen={showLLMLogger} 
          togglePanel={() => setShowLLMLogger(false)} 
        />
      }
    </div>
  );
};

const App: React.FC = () => {
  return (
    <ChatProvider>
      <AppContent />
    </ChatProvider>
  );
};

export default App;