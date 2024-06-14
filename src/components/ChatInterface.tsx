import React, { useState, useEffect } from 'react';
import { generateUserInputResponse, getRelevantNodes } from '../services/LLMService';
import { Node } from '../models/Node';
import useChatHistory, { Message } from '../hooks/useChatHistory';
import ChatHistory from './ChatHistory';
import ChatInput from './ChatInput';
import DetailsOverlay from './DetailsOverlay';

interface ChatInterfaceProps {
  nodes: Node[];
  updateGraph: Function;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ nodes, updateGraph }) => {
  const { chatHistory, setChatHistory } = useChatHistory();
  const [input, setInput] = useState('');
  const [waitingForAnswer, setWaitingForAnswer] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [lastNodeEdition, setLastNodeEdition] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [actionTriggered, setActionTriggered] = useState(false);

  useEffect(() => {
    if (actionTriggered) {
      handleSend();
      setActionTriggered(false);
    }
  }, [input]);

  useEffect(() => {
    if (chatHistory.length === 0) {
      // Handle any necessary UI updates when chat history is cleared
      setInput('');
      setLastNodeEdition(null);
      setLoadingMessage('');
      setErrorMessage('');
    }
  }, [chatHistory]);

  const handleSend = async () => {
    try {
      setErrorMessage('');
      setWaitingForAnswer(true);
      setLoadingMessage('Generating story...');
      const timestamp = new Date().toLocaleTimeString();
  
      const updatedChatHistory: Message[] = [...chatHistory, 
        {
          role: "user",
          content: input,
          timestamp
        }
      ]

      const detailedNodeIds = await getRelevantNodes(input, updatedChatHistory.slice(-4), nodes);
      const response = await generateUserInputResponse(input, updatedChatHistory.slice(-20), nodes, detailedNodeIds);

      setLastNodeEdition(response.nodeEdition);
      setChatHistory([...updatedChatHistory,
      {
        role: "selectedNodes",
        content: JSON.stringify(detailedNodeIds, null, 2),
        timestamp,
      }, {
        role: "reasoning",
        content: response.reasoning,
        timestamp
      }, {
        role: "assistant",
        content: `${response.chatText}`,
        timestamp
      }, {
        role: "actions",
        content: JSON.stringify(response.actions),
        timestamp
      }, {
        role: "nodeEdition",
        content: JSON.stringify(response.nodeEdition, null, 2),
        timestamp
      }]);
      setInput('');
  
      setLoadingMessage('Generating images...');
      await updateGraph(response.nodeEdition);
    } catch (error) {
      console.error('Error during chat handling:', error);
      setErrorMessage('An error occurred. Please try again.');
    } finally {
      setWaitingForAnswer(false);
      setLoadingMessage('');
    }
  };
  
  const handleActionClick = (action: string) => {
    setInput(action);
    setActionTriggered(true);
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <div className="w-1/2 h-full p-4 flex flex-col relative">
      <ChatHistory 
        chatHistory={chatHistory} 
        waitingForAnswer={waitingForAnswer} 
        loadingMessage={loadingMessage} 
        errorMessage={errorMessage} 
        onActionClick={handleActionClick} 
      />
      <ChatInput input={input} setInput={setInput} handleSend={handleSend} waitingForAnswer={waitingForAnswer} />
      <button className="py-2 text-sm text-left text-blue-500 underline" onClick={toggleCollapse}>
        {isCollapsed ? 'Show Details' : 'Hide Details'}
      </button>
      <DetailsOverlay isCollapsed={isCollapsed} toggleCollapse={toggleCollapse} lastNodeEdition={lastNodeEdition || []} nodes={nodes} />
    </div>
  );
};

export default ChatInterface;
