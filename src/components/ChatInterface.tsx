import React, { useState, useEffect } from 'react';
import { generateUserInputResponse, getRelevantNodes } from '../services/LLMService';
import { Node } from '../models/Node';
import { useChat, Message } from '../context/ChatContext';
import ChatHistory from './ChatHistory';
import ChatInput from './ChatInput';
import DetailsOverlay from './DetailsOverlay';

interface ChatInterfaceProps {
  nodes: Node[];
  updateGraph: Function;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ nodes, updateGraph }) => {
  const { chatHistory, addMessage } = useChat();
  const [input, setInput] = useState('');
  const [waitingForAnswer, setWaitingForAnswer] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [lastNodeEdition, setLastNodeEdition] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [actionTriggered, setActionTriggered] = useState(false);
  const [lastFailedRequest, setLastFailedRequest] = useState<{
    input: string;
    chatHistory: Message[];
    nodes: Node[];
    detailedNodeIds: string[];
  } | null>(null);
  const [generationTimes, setGenerationTimes] = useState<{
    story: number;
    imagePrompts: number[];
    imageGeneration: number[];
  }>({ story: 0, imagePrompts: [], imageGeneration: [] });

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

  const handleSend = async (retry = false) => {
    if (!input.trim() || waitingForAnswer) return;

    setWaitingForAnswer(true);
    setErrorMessage('');
    setLoadingMessage('Generating story...');

    try {
      const timestamp = new Date().toLocaleTimeString();
      const storyStartTime = Date.now();

      const userMessage: Message = {
        role: "user",
        content: input,
        timestamp
      };
      
      addMessage(userMessage);

      let detailedNodeIds;
      if (nodes.length < 15) {
        detailedNodeIds = nodes
          .filter(node => node.type !== "image_generation")
          .map(node => node.id);
      } else {
        detailedNodeIds = await getRelevantNodes(input, [...chatHistory, userMessage].slice(-4), nodes);
      }

      const response = await generateUserInputResponse(input, [...chatHistory, userMessage].slice(-20), nodes, detailedNodeIds);
      const storyEndTime = Date.now();
      const storyDuration = storyEndTime - storyStartTime;

      setLastNodeEdition(response.nodeEdition);
      setLastFailedRequest(null);

      const messagesToAdd: Message[] = [
        {
          role: "selectedNodes",
          content: JSON.stringify(detailedNodeIds, null, 2),
          timestamp,
        }, {
          role: "reasoning",
          content: response.reasoning || "",
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
        }
      ];

      // Filter out messages that should be hidden
      const filteredMessages = messagesToAdd.filter(message => {
        if (!message || !message.content) return false;
        
        if (message.role === "selectedNodes" && nodes.length < 15) {
          return false; // Hide selectedNodes when all nodes are selected
        }
        if (message.role === "reasoning" && !message.content.trim()) {
          return false; // Hide reasoning when empty
        }
        return true;
      });

      filteredMessages.forEach(addMessage);
      setInput('');

      if (response.nodeEdition) {
        setLoadingMessage('Generating images...');
        try {
          const imageStartTime = Date.now();
          const imagePromptTimes = await updateGraph(response.nodeEdition);
          const imageEndTime = Date.now();
          const imageDuration = imageEndTime - imageStartTime;
          
          setGenerationTimes({
            story: storyDuration,
            imagePrompts: imagePromptTimes,
            imageGeneration: [imageDuration]
          });

          // Add timing information to chat
          const timingMessage: Message = {
            role: "system",
            content: `Generation times:
- Story: ${(storyDuration / 1000).toFixed(1)}s
- Image prompts: ${imagePromptTimes.map((t: number) => (t / 1000).toFixed(1)).join('s, ')}s
- Image generation: ${(imageDuration / 1000).toFixed(1)}s`,
            timestamp: new Date().toLocaleTimeString()
          };
          addMessage(timingMessage);
        } catch (error) {
          console.error('Error during image generation:', error);
          setErrorMessage('Error generating images. Please try again.');
        }
      }
    } catch (error) {
      console.error('Error during chat handling:', error);
      setErrorMessage('An error occurred. Please try again.');
      setLastFailedRequest({
        input,
        chatHistory: [...chatHistory],
        nodes,
        detailedNodeIds: nodes
          .filter(node => node.type !== "image_generation")
          .map(node => node.id)
      });
    } finally {
      setWaitingForAnswer(false);
      setLoadingMessage('');
    }
  };

  const handleRetry = () => {
    if (lastFailedRequest) {
      setInput(lastFailedRequest.input);
      handleSend(true);
    }
  };

  const handleActionClick = (action: string) => {
    setInput(action);
    handleSend();
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <div className="w-1/2 h-full p-4 flex flex-col relative">
      <ChatHistory 
        waitingForAnswer={waitingForAnswer} 
        loadingMessage={loadingMessage} 
        errorMessage={errorMessage}
        onRetry={handleRetry}
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