import React, { useState, useEffect, useCallback } from 'react';
import { generateUserInputResponse, getRelevantNodes, generateChatText, generateActions, generateNodeEdition, refocusStory } from '../services/llm';
import { Node } from '../models/Node';
import { useChat, Message } from '../context/ChatContext';
import ChatHistory from './ChatHistory';
import ChatInput from './ChatInput';
import DetailsOverlay from './DetailsOverlay';
import { moxusService } from '../services/MoxusService';
import { LLMNodeEditionResponse } from '../models/nodeOperations';

interface ChatInterfaceProps {
  nodes: Node[];
  updateGraph: (
    nodeEdition: LLMNodeEditionResponse, 
    imagePrompts?: { nodeId: string; prompt: string }[],
    chatHistory?: Message[],
    isFromUserInteraction?: boolean
  ) => Promise<void>;
  addMessage: (message: Message) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ nodes, updateGraph, addMessage }) => {
  const { chatHistory, setChatHistory, updateStreamingMessage, endStreaming, clearChatHistory } = useChat();
  const [input, setInput] = useState('');
  const [waitingForAnswer, setWaitingForAnswer] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [showDebug, setShowDebug] = useState(true);
  const [inspectMode, setInspectMode] = useState(false);
  const [disableImageGeneration, setDisableImageGeneration] = useState(false);
  const [responseLength, setResponseLength] = useState<'short' | '1 paragraph' | '3 paragraphs' | 'lengthy' | 'full page'>('3 paragraphs');
  const [lastNodeEdition, setLastNodeEdition] = useState<LLMNodeEditionResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [actionTriggered, setActionTriggered] = useState(false);
  const [lastFailedRequest, setLastFailedRequest] = useState<{
    input: string;
    chatHistory: Message[];
    nodes: Node[];
    detailedNodeIds: string[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  let chatTextCallId_to_finalize: string | null = null;

  const handleSend = useCallback(async (retry = false) => {
    chatTextCallId_to_finalize = null;
    if (!input.trim() || isLoading) return;

    const currentInput = input;
    setIsLoading(true);
    setErrorMessage('');
    setLoadingMessage('Processing your request...');
    const timestamp = new Date().toLocaleTimeString();
    const storyStartTime = Date.now();

    try {
      console.log('Starting new interaction at:', timestamp);

      const userMessage: Message = {
        role: "user",
        content: currentInput,
        timestamp: timestamp.toString()
      };
      addMessage(userMessage);
      setInput(''); 

      const streamingMessage: Message = {
        role: "assistant",
        content: "",
        timestamp: timestamp.toString(),
        isStreaming: true
      };
      addMessage(streamingMessage);

      let detailedNodeIds;
      const contextHistory = [...chatHistory];

      const maxIncludedNodes = parseInt(import.meta.env.VITE_MAX_INCLUDED_NODES || '15', 10);

      if (nodes.length < maxIncludedNodes) {
        detailedNodeIds = nodes
          .filter(node => node.type !== "image_generation")
          .map(node => node.id);
      } else {
        console.log('Starting relevant nodes determination');
        const relevantNodesStartTime = Date.now();
        detailedNodeIds = await getRelevantNodes(currentInput, contextHistory.slice(-4), nodes);
        console.log('Relevant nodes determination completed in:', Date.now() - relevantNodesStartTime, 'ms');
      }

      console.log('Starting chat text generation');
      const chatTextResult = await generateChatText(currentInput, contextHistory.slice(-20), nodes, detailedNodeIds, responseLength);
      const chatTextResponse = chatTextResult.streamResponse;
      chatTextCallId_to_finalize = chatTextResult.callId;
      
      let accumulatedContent = '';
      if (chatTextResponse instanceof Response) {
        const reader = chatTextResponse.body?.getReader();
        if (!reader) throw new Error('No reader available for chat text stream');
        try {
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
                } catch (e) { console.error('Error parsing stream chunk:', e); }
              }
            }
            if (lines.some(line => line.startsWith('data: [DONE]'))) break;
          }
        } finally {
            endStreaming();
            if (chatTextCallId_to_finalize) {
                if (accumulatedContent) {
                    moxusService.finalizeLLMCallRecord(chatTextCallId_to_finalize, accumulatedContent);
                } else if (!moxusService.getLLMLogEntries().find(log => log.id === chatTextCallId_to_finalize && log.status === 'failed')){
                    moxusService.failLLMCallRecord(chatTextCallId_to_finalize, "Stream ended with no content accumulated and not previously marked as failed.");
                }
            }
        }
        const storyEndTime = Date.now();
        const storyDuration = storyEndTime - storyStartTime;
        console.log('Story generation completed in:', storyDuration, 'ms');

        setLoadingMessage('Generating actions and updating game state...');

        const [actions, nodeEditionResponse] = await Promise.all([
          generateActions(accumulatedContent, nodes, currentInput),
          generateNodeEdition(accumulatedContent, [], nodes, currentInput, true)
        ]);
        
        console.log('Parallel operations completed in:', Date.now() - storyStartTime, 'ms');

        const finalNodeEdition: LLMNodeEditionResponse = JSON.parse(JSON.stringify(nodeEditionResponse));

        if (disableImageGeneration) {
          if (finalNodeEdition.n_nodes) {
            finalNodeEdition.n_nodes.forEach(node => node.updateImage = false);
          }
          if (finalNodeEdition.u_nodes) {
            for (const nodeId in finalNodeEdition.u_nodes) {
              if (finalNodeEdition.u_nodes[nodeId]) {
                finalNodeEdition.u_nodes[nodeId].img_upd = false;
              }
            }
          }
        }

        setLastNodeEdition(finalNodeEdition);
        setLastFailedRequest(null);

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
            content: JSON.stringify(finalNodeEdition, null, 2),
            timestamp: timestamp.toString()
          }
        ];

        const filteredMessages = messagesToAdd.filter(message => {
          if (!message || !message.content) return false;
          if (message.role === "selectedNodes" && nodes.length < maxIncludedNodes) return false;
          if (message.role === "reasoning" && !message.content.trim()) return false;
          return true;
        });

        filteredMessages.forEach(addMessage);
        setActionTriggered(false);
        setLoadingMessage(disableImageGeneration ? '' : 'Generating images in the background...');
        setIsLoading(false);

        console.log('Applying node edition to graph...');
        await updateGraph(finalNodeEdition, [], contextHistory, true);
      } else {
        console.warn('generateChatText did not return a Response object for streaming as expected.');
        if (chatTextCallId_to_finalize) {
          moxusService.failLLMCallRecord(chatTextCallId_to_finalize, 'generateChatText did not return a streamable Response.');
        }
        throw new Error('Chat text generation failed to produce a stream.');
      }
    } catch (error) {
      console.error('Error during chat handling:', error);
      setErrorMessage('An error occurred. Please try again.');
      if (chatTextCallId_to_finalize && !moxusService.getLLMLogEntries().find(log => log.id === chatTextCallId_to_finalize && (log.status === 'completed' || log.status === 'failed'))) {
        moxusService.failLLMCallRecord(chatTextCallId_to_finalize, error instanceof Error ? error.message : String(error));
      }
      setLastFailedRequest({
        input: currentInput,
        chatHistory: [...chatHistory],
        nodes,
        detailedNodeIds: nodes
          .filter(node => node.type !== "image_generation")
          .map(node => node.id)
      });
      setLoadingMessage('');
      setIsLoading(false);
    }
  }, [input, isLoading, chatHistory, nodes, disableImageGeneration, addMessage, updateStreamingMessage, endStreaming, updateGraph]);

  useEffect(() => {
    if (actionTriggered && input.trim() && !isLoading) {
      chatTextCallId_to_finalize = null;
      handleSend();
      setActionTriggered(false);
    } else if (actionTriggered) {
      setActionTriggered(false);
    }
  }, [actionTriggered, input, isLoading, handleSend]);

  useEffect(() => {
    if (chatHistory.length === 0) {
      setInput('');
      setLastNodeEdition(null);
      setLoadingMessage('');
      setErrorMessage('');
    }
  }, [chatHistory]);

  const handleRefocusClick = async () => {
    if (isLoading) return;

    setIsLoading(true);
    setActionTriggered(false);
    setErrorMessage('');
    setLoadingMessage('Refocusing story... (this will clear chat history)');
    const timestamp = new Date().toLocaleTimeString();

    try {
      console.log('Starting story refocus at:', timestamp);
      const refocusResult = await refocusStory(chatHistory, nodes);

      clearChatHistory();

      const refocusMessage: Message = {
        role: "assistant",
        content: refocusResult.llmResult,
        timestamp: new Date().toLocaleTimeString(),
        isStreaming: false
      };
      addMessage(refocusMessage);

      moxusService.recordInternalSystemEvent(
        `refocus-${Date.now()}`,
        "System Event: Story refocus triggered by user.",
        `Chat history cleared. New starting point: ${refocusResult.llmResult.substring(0, 100)}...`,
        "story_refocus_event"
      );

      setLoadingMessage('');
      setIsLoading(false);
      console.log('Story refocus completed.');

    } catch (error) {
      console.error('Error during story refocus:', error);
      setErrorMessage('An error occurred during refocus. Please try again.');
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
    setActionTriggered(true); 
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleRegenerate = async () => {
    if (isLoading || chatHistory.length === 0) return;

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

    const discardedAssistantMessages = chatHistory.slice(lastUserMessageIndex + 1);
    if (discardedAssistantMessages.length > 0) {
      moxusService.recordInternalSystemEvent(
        `chatRegenerate-${Date.now()}`,
        "System Event: User requested response regeneration.",
        `User input: '${lastUserMessage.content}'. Discarded assistant response(s): ${JSON.stringify(discardedAssistantMessages)}`,
        "chat_regenerate_event"
      );
    } else {
      moxusService.recordInternalSystemEvent(
        `chatRegenerate-${Date.now()}`,
        "System Event: User requested input regeneration (before assistant reply).",
        `User input being re-evaluated: '${lastUserMessage.content}'.`,
        "chat_input_regenerate_event"
      );
    }

    const newChatHistory = chatHistory.slice(0, lastUserMessageIndex + 1);
    setChatHistory(newChatHistory);
    setInput(lastUserMessage.content);
    setActionTriggered(true); 
  };

  const handleGenerateSuggestions = async () => {
    if (isLoading) return;

    setIsLoading(true);
    setErrorMessage('');
    setLoadingMessage('Generating suggestions...');
    const timestamp = new Date().toLocaleTimeString();
    const currentInputForSuggestions = input;

    try {
      const contextHistory = [...chatHistory];

      const [actions, nodeEditionResponse] = await Promise.all([
        generateActions("", nodes, currentInputForSuggestions || "suggest actions"),
        generateNodeEdition("", [], nodes, currentInputForSuggestions || "suggest node changes", true)
      ]);
      
      const finalNodeEdition: LLMNodeEditionResponse = JSON.parse(JSON.stringify(nodeEditionResponse));

      if (disableImageGeneration) {
        if (finalNodeEdition.n_nodes) {
          finalNodeEdition.n_nodes.forEach(node => node.updateImage = false);
        }
        if (finalNodeEdition.u_nodes) {
          for (const nodeId in finalNodeEdition.u_nodes) {
            if (finalNodeEdition.u_nodes[nodeId]) {
              finalNodeEdition.u_nodes[nodeId].img_upd = false;
            }
          }
        }
      }

      const messagesToAdd: Message[] = [
        {
          role: "actions",
          content: JSON.stringify(actions),
          timestamp: timestamp.toString()
        }, {
          role: "nodeEdition",
          content: JSON.stringify(finalNodeEdition, null, 2),
          timestamp: timestamp.toString()
        }
      ];

      messagesToAdd.forEach(addMessage);
      setLastNodeEdition(finalNodeEdition);

      updateGraph(finalNodeEdition, [], contextHistory, true).finally(() => {
        setLoadingMessage('');
        setIsLoading(false);
      });
    } catch (error) {
      console.error('Error generating suggestions:', error);
      setErrorMessage('An error occurred. Please try again.');
      setLoadingMessage('');
      setIsLoading(false);
    }
  };

  const handleSendAsNote = () => {
    if (!input.trim() || isLoading) return;

    const timestamp = new Date().toLocaleTimeString();
    const noteMessage: Message = {
      role: "userMandatoryInstructions",
      content: input,
      timestamp: timestamp.toString()
    };
    addMessage(noteMessage);
    setInput('');
  };

  return (
    <div className="w-1/2 h-full p-4 flex flex-col relative">
      <ChatHistory 
        waitingForAnswer={isLoading}
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
          handleSend={() => setActionTriggered(true)}
          handleSendAsNote={handleSendAsNote}
          waitingForAnswer={isLoading}
          onRegenerate={handleRegenerate}
          showRegenerate={chatHistory.length > 0 && !isLoading}
          handleRefocus={handleRefocusClick}
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
        <div className="py-2 text-sm">
          <label className="text-blue-500 mr-2">Response length:</label>
          <select 
            value={responseLength} 
            onChange={(e) => setResponseLength(e.target.value as 'short' | '1 paragraph' | '3 paragraphs' | 'lengthy' | 'full page')}
            className="bg-gray-700 text-white text-sm px-2 py-1 rounded border border-gray-600"
          >
            <option value="short">Short</option>
            <option value="1 paragraph">1 paragraph</option>
            <option value="3 paragraphs">3 paragraphs</option>
            <option value="lengthy">Lengthy</option>
            <option value="full page">Full page</option>
          </select>
        </div>
      </div>
      <DetailsOverlay isCollapsed={isCollapsed} toggleCollapse={toggleCollapse} lastNodeEdition={[]} nodes={nodes} />
    </div>
  );
};

export default ChatInterface;