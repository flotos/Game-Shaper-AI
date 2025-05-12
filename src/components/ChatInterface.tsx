import React, { useState, useEffect } from 'react';
import { generateUserInputResponse, getRelevantNodes, generateChatText, generateActions, generateNodeEdition, generateImagePrompt } from '../services/LLMService';
import { Node } from '../models/Node';
import { useChat, Message } from '../context/ChatContext';
import ChatHistory from './ChatHistory';
import ChatInput from './ChatInput';
import DetailsOverlay from './DetailsOverlay';
import { moxusService } from '../services/MoxusService';

interface ChatInterfaceProps {
  nodes: Node[];
  updateGraph: (nodeEdition: { 
    merge?: Partial<Node>[]; 
    delete?: string[];
    newNodes?: string[];
  }, 
  imagePrompts?: { nodeId: string; prompt: string }[],
  chatHistory?: Message[],
  isFromUserInteraction?: boolean
  ) => Promise<void>;
  addMessage: (message: Message) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ nodes, updateGraph, addMessage }) => {
  const { chatHistory, setChatHistory, updateStreamingMessage, endStreaming } = useChat();
  const [input, setInput] = useState('');
  const [waitingForAnswer, setWaitingForAnswer] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [showDebug, setShowDebug] = useState(true);
  const [inspectMode, setInspectMode] = useState(false);
  const [disableImageGeneration, setDisableImageGeneration] = useState(false);
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
  const [isLoading, setIsLoading] = useState(false);

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
    if (!input.trim() || isLoading) return;

    setIsLoading(true);
    setErrorMessage('');
    setLoadingMessage('Processing your request...');
    const timestamp = new Date().toLocaleTimeString();

    try {
      const storyStartTime = Date.now();
      console.log('Starting new interaction at:', timestamp);

      // Add user message
      const userMessage: Message = {
        role: "user",
        content: input,
        timestamp: timestamp.toString()
      };
      addMessage(userMessage);
      setInput(''); // Clear input immediately after sending

      // Add a streaming message placeholder
      const streamingMessage: Message = {
        role: "assistant",
        content: "",
        timestamp: timestamp.toString(),
        isStreaming: true
      };
      addMessage(streamingMessage);

      let detailedNodeIds;
      const tempUserMessage: Message = {
        role: "user",
        content: input,
        timestamp: timestamp.toString()
      };

      // Use the current chat history including the new message
      const contextHistory = [...chatHistory, tempUserMessage];

      const maxIncludedNodes = parseInt(import.meta.env.VITE_MAX_INCLUDED_NODES || '15', 10);

      if (nodes.length < maxIncludedNodes) {
        detailedNodeIds = nodes
          .filter(node => node.type !== "image_generation")
          .map(node => node.id);
      } else {
        console.log('Starting relevant nodes determination');
        const relevantNodesStartTime = Date.now();
        detailedNodeIds = await getRelevantNodes(input, contextHistory.slice(-4), nodes);
        console.log('Relevant nodes determination completed in:', Date.now() - relevantNodesStartTime, 'ms');
      }

      // First, generate and display the chat text
      console.log('Starting chat text generation');
      const chatTextStartTime = Date.now();
      const chatTextResponse = await generateChatText(input, contextHistory.slice(-20), nodes, detailedNodeIds);
      
      // Handle the streamed response
      if (chatTextResponse instanceof Response) {
        const reader = chatTextResponse.body?.getReader();
        if (!reader) throw new Error('No reader available');

        let accumulatedContent = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = new TextDecoder().decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;
              
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices[0].delta.content || '';
                if (content) {
                  accumulatedContent += content;
                  updateStreamingMessage(content);
                }
              } catch (e) {
                console.error('Error parsing stream chunk:', e);
              }
            }
          }
        }
        endStreaming();
        const storyEndTime = Date.now();
        const storyDuration = storyEndTime - storyStartTime;
        console.log('Story generation completed in:', storyDuration, 'ms');
        
        // Record the complete chat text with Moxus
        const chatTextCallId = `chatText-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        moxusService.recordLLMCall(chatTextCallId, 
          `Game Engine Chat Generation: User input: "${input}"`, 
          accumulatedContent);

        // Update loading message for the next steps
        setLoadingMessage('Generating actions and updating game state...');

        // Start the other operations in parallel
        const [actions, nodeEdition] = await Promise.all([
          generateActions(accumulatedContent, nodes, input),
          generateNodeEdition(accumulatedContent, [], nodes, input, true)
        ]);
        
        console.log('Parallel operations completed in:', Date.now() - storyStartTime, 'ms');

        // If image generation is disabled, remove updateImage flags
        if (disableImageGeneration) {
          if (nodeEdition.newNodes) {
            nodeEdition.newNodes = nodeEdition.newNodes.map((node: Partial<Node>) => ({
              ...node,
              updateImage: false
            }));
          }
          if (nodeEdition.update) {
            nodeEdition.update = nodeEdition.update.map((update: { id: string; longDescription?: string; rules?: string; updateImage?: boolean; name?: string; type?: string }) => ({
              ...update,
              updateImage: false
            }));
          }
        }

        setLastNodeEdition(nodeEdition);
        setLastFailedRequest(null);

        // Add the remaining messages
        const messagesToAdd: Message[] = [
          {
            role: "selectedNodes",
            content: JSON.stringify(detailedNodeIds, null, 2),
            timestamp: timestamp.toString(),
          }, {
            role: "reasoning",
            content: "",
            timestamp: timestamp.toString()
          }, {
            role: "actions",
            content: JSON.stringify(actions),
            timestamp: timestamp.toString()
          }, {
            role: "nodeEdition",
            content: JSON.stringify(nodeEdition, null, 2),
            timestamp: timestamp.toString()
          }
        ];

        // Filter out messages that should be hidden
        const filteredMessages = messagesToAdd.filter(message => {
          if (!message || !message.content) return false;
          
          if (message.role === "selectedNodes" && nodes.length < maxIncludedNodes) {
            return false; // Hide selectedNodes when all nodes are selected
          }
          if (message.role === "reasoning" && !message.content.trim()) {
            return false; // Hide reasoning when empty
          }
          return true;
        });

        filteredMessages.forEach(addMessage);
        setActionTriggered(false);

        // Keep waitingForAnswer true until all operations are complete
        setLoadingMessage(disableImageGeneration ? '' : 'Generating images in the background...');
        setIsLoading(false);

        // Apply the node edition to update the graph in the background
        console.log('Applying node edition to graph...');
        await updateGraph(nodeEdition, [], contextHistory, true);
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
      setWaitingForAnswer(false);
      setLoadingMessage('');
      setIsLoading(false);
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

  const handleRegenerate = async () => {
    if (waitingForAnswer || chatHistory.length === 0) return;

    // Find the last user message and its index
    let lastUserMessageIndex = -1;
    let lastUserMessage: Message | null = null;
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      if (chatHistory[i].role === "user") {
        lastUserMessageIndex = i;
        lastUserMessage = chatHistory[i];
        break;
      }
    }

    if (lastUserMessageIndex === -1 || !lastUserMessage) return;

    // Remove all messages after and including the last user message
    const newChatHistory = chatHistory.slice(0, lastUserMessageIndex);
    setChatHistory(newChatHistory);

    // Set the input to the last user message but don't trigger send
    setInput(lastUserMessage.content);
  };

  const handleGenerateSuggestions = async () => {
    if (isLoading) return;

    setIsLoading(true);
    setErrorMessage('');
    setLoadingMessage('Generating suggestions...');
    const timestamp = new Date().toLocaleTimeString();

    try {
      const contextHistory = [...chatHistory];
      const maxIncludedNodes = parseInt(import.meta.env.VITE_MAX_INCLUDED_NODES || '15', 10);

      let detailedNodeIds;
      if (nodes.length < maxIncludedNodes) {
        detailedNodeIds = nodes
          .filter(node => node.type !== "image_generation")
          .map(node => node.id);
      } else {
        detailedNodeIds = await getRelevantNodes(input, contextHistory.slice(-4), nodes);
      }

      const [actions, nodeEdition] = await Promise.all([
        generateActions("", nodes, ""),
        generateNodeEdition("", [], nodes, "", true)
      ]);

      const messagesToAdd: Message[] = [
        {
          role: "actions",
          content: JSON.stringify(actions),
          timestamp: timestamp.toString()
        }, {
          role: "nodeEdition",
          content: JSON.stringify(nodeEdition, null, 2),
          timestamp: timestamp.toString()
        }
      ];

      messagesToAdd.forEach(addMessage);
      setLastNodeEdition(nodeEdition);

      updateGraph(nodeEdition, [], contextHistory, true).then(() => {
        setWaitingForAnswer(false);
        setLoadingMessage('');
        setIsLoading(false);
      }).catch((error: Error) => {
        console.error('Error updating graph:', error);
        setErrorMessage('Error updating game state. Please try again.');
        setWaitingForAnswer(false);
        setLoadingMessage('');
        setIsLoading(false);
      });
    } catch (error) {
      console.error('Error generating suggestions:', error);
      setErrorMessage('An error occurred. Please try again.');
      setWaitingForAnswer(false);
      setLoadingMessage('');
      setIsLoading(false);
    }
  };

  const handleSendAsNote = () => {
    if (!input.trim() || isLoading) return;

    const timestamp = new Date().toLocaleTimeString();
    const noteMessage: Message = {
      role: "userNote",
      content: input,
      timestamp: timestamp.toString()
    };
    addMessage(noteMessage);
    setInput('');
  };

  return (
    <div className="w-1/2 h-full p-4 flex flex-col relative">
      <ChatHistory 
        waitingForAnswer={waitingForAnswer} 
        loadingMessage={loadingMessage} 
        errorMessage={errorMessage}
        onRetry={handleRetry}
        onActionClick={handleActionClick}
        showDebug={showDebug}
      />
      {inspectMode ? (
        <div className="flex items-center mb-2">
          <button
            className="flex-grow px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-600"
            onClick={handleGenerateSuggestions}
            disabled={isLoading}
          >
            Generate nodeGeneration and action suggestions
          </button>
        </div>
      ) : (
        <ChatInput 
          input={input} 
          setInput={setInput} 
          handleSend={handleSend}
          handleSendAsNote={handleSendAsNote}
          waitingForAnswer={waitingForAnswer}
          onRegenerate={handleRegenerate}
          showRegenerate={chatHistory.length > 0}
        />
      )}
      <div className="flex space-x-4">
        <button className="py-2 text-sm text-left text-blue-500 underline" onClick={toggleCollapse}>
          {isCollapsed ? 'Show Details' : 'Hide Details'}
        </button>
        <button 
          className="py-2 text-sm text-left text-blue-500 underline" 
          onClick={() => setShowDebug(!showDebug)}
        >
          {showDebug ? 'Hide Debug' : 'Show Debug'}
        </button>
        <button 
          className="py-2 text-sm text-left text-blue-500 underline" 
          onClick={() => setInspectMode(!inspectMode)}
        >
          {inspectMode ? 'Disable Inspect Mode' : 'Enable Inspect Mode'}
        </button>
        <button 
          className="py-2 text-sm text-left text-blue-500 underline" 
          onClick={() => setDisableImageGeneration(!disableImageGeneration)}
        >
          {disableImageGeneration ? 'Enable Image Generation' : 'Disable Image Generation'}
        </button>
      </div>
      <DetailsOverlay isCollapsed={isCollapsed} toggleCollapse={toggleCollapse} lastNodeEdition={lastNodeEdition || []} nodes={nodes} />
    </div>
  );
};

export default ChatInterface;