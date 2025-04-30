import React, { useState, useEffect } from 'react';
import { generateUserInputResponse, getRelevantNodes, generateChatText, generateActions, generateNodeEdition, determineImageUpdates, generateImagePrompt } from '../services/LLMService';
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
  const { chatHistory, addMessage, setChatHistory, updateStreamingMessage, endStreaming } = useChat();
  const [input, setInput] = useState('');
  const [waitingForAnswer, setWaitingForAnswer] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [showDebug, setShowDebug] = useState(true);
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
  const [imageGenerationLock, setImageGenerationLock] = useState<boolean>(false);

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
      console.log('Starting new interaction at:', timestamp);

      // Only add user message if this is not a regeneration
      if (!actionTriggered) {
        const userMessage: Message = {
          role: "user",
          content: input,
          timestamp
        };
        addMessage(userMessage);
      }

      let detailedNodeIds;
      const tempUserMessage: Message = {
        role: "user",
        content: input,
        timestamp
      };

      // Use the current chat history for regeneration, or include the new message for normal sends
      const contextHistory = actionTriggered ? chatHistory : [...chatHistory, tempUserMessage];

      if (nodes.length < 15) {
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
      console.log('Chat text generation completed in:', Date.now() - chatTextStartTime, 'ms');
      
      // Add a streaming message placeholder
      const streamingMessage: Message = {
        role: "assistant",
        content: "",
        timestamp,
        isStreaming: true
      };
      addMessage(streamingMessage);

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

        // Update loading message for the next steps
        setLoadingMessage('Generating actions and updating game state...');

        // Start determineImageUpdates first and handle its result immediately
        console.log('Starting parallel operations: actions, node edition, and image updates');
        const parallelStartTime = Date.now();
        
        // Start determineImageUpdates and handle its result immediately
        const imageUpdatesPromise = determineImageUpdates(accumulatedContent, nodes, contextHistory).then(async (imageUpdates) => {
          if (imageUpdates && imageUpdates.length > 0) {
            console.log('Starting early image generation for context-updated nodes:', imageUpdates);
            setImageGenerationLock(true); // Lock image generation
            try {
              const contextImagePrompts = await Promise.all(
                imageUpdates.map(async (nodeId: string) => {
                  console.log('Generating prompt for context-updated node:', nodeId);
                  const node = nodes.find(n => n.id === nodeId);
                  if (!node) {
                    console.warn('Node not found:', nodeId);
                    return null;
                  }
                  const prompt = await generateImagePrompt(node, nodes, contextHistory.slice(-4));
                  console.log('Generated prompt for node', nodeId, ':', prompt);
                  return { nodeId, prompt };
                })
              );

              // Filter out any null results from context prompts
              const validContextPrompts = contextImagePrompts.filter((prompt): prompt is { nodeId: string, prompt: string } => prompt !== null);
              
              // Start generating images for context-updated nodes immediately
              if (validContextPrompts.length > 0) {
                console.log('Starting early graph update with context image prompts');
                await updateGraph(
                  { merge: [], delete: [], newNodes: [] },
                  validContextPrompts.map(p => ({ nodeId: p.nodeId, prompt: p.prompt }))
                );
              }
            } finally {
              setImageGenerationLock(false); // Unlock image generation
            }
          }
          return imageUpdates;
        });
        
        // Start the other operations in parallel
        const [actions, nodeEdition] = await Promise.all([
          generateActions(accumulatedContent, nodes, input),
          generateNodeEdition(accumulatedContent, [], nodes, input)
        ]);
        
        // Get image updates result (but image generation has already started)
        const imageUpdates = await imageUpdatesPromise;
        
        console.log('Parallel operations completed in:', Date.now() - parallelStartTime, 'ms');

        setLastNodeEdition(nodeEdition);
        setLastFailedRequest(null);

        // Then generate images for new nodes
        setLoadingMessage('Generating images for new nodes...');
        try {
          // Wait for any ongoing image generation to complete
          while (imageGenerationLock) {
            console.log('Waiting for context-updated nodes image generation to complete...');
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          const imageStartTime = Date.now();
          console.log('Starting image generation for new nodes...');
          
          // Generate prompts for new nodes from nodeEdition
          const newNodeImagePrompts = nodeEdition.newNodes ? await Promise.all(
            nodeEdition.newNodes.map(async (nodeId: string) => {
              console.log('Generating prompt for new node:', nodeId);
              const node = nodeEdition.merge?.find((n: Node) => n.id === nodeId);
              if (!node) {
                console.warn('New node not found in merge:', nodeId);
                return null;
              }
              const prompt = await generateImagePrompt(node, nodes, contextHistory.slice(-4));
              console.log('Generated prompt for new node', nodeId, ':', prompt);
              return { nodeId, prompt };
            })
          ) : [];

          // Filter out any null results from new node prompts
          const validNewNodePrompts = newNodeImagePrompts.filter((prompt): prompt is { nodeId: string, prompt: string } => prompt !== null);
          
          console.log('Valid new node prompts:', validNewNodePrompts);
          
          // Update the graph with new node image prompts
          if (validNewNodePrompts.length > 0) {
            console.log('Starting graph update with new node image prompts');
            await updateGraph(
              { merge: [], delete: [], newNodes: [] },
              validNewNodePrompts.map(p => ({ nodeId: p.nodeId, prompt: p.prompt }))
            );
            
            const imageEndTime = Date.now();
            const imageDuration = imageEndTime - imageStartTime;
            console.log('New node image generation completed in:', imageDuration, 'ms');
            
            setGenerationTimes({
              story: storyDuration,
              imagePrompts: [],
              imageGeneration: [imageDuration]
            });
          }
        } catch (error) {
          console.error('Error during new node image generation:', error);
          setErrorMessage('Error generating images for new nodes. Please try again.');
        }

        // Add the remaining messages
        const messagesToAdd: Message[] = [
          {
            role: "selectedNodes",
            content: JSON.stringify(detailedNodeIds, null, 2),
            timestamp,
          }, {
            role: "reasoning",
            content: "",
            timestamp
          }, {
            role: "actions",
            content: JSON.stringify(actions),
            timestamp
          }, {
            role: "nodeEdition",
            content: JSON.stringify(nodeEdition, null, 2),
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
        setActionTriggered(false);

        // Apply the node edition to update the graph
        console.log('Applying node edition to graph...');
        await updateGraph(nodeEdition, []);
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

    // Remove all messages after the last user message
    const newChatHistory = chatHistory.slice(0, lastUserMessageIndex + 1);
    setChatHistory(newChatHistory);

    // Set the input to the last user message and trigger a new response
    setInput(lastUserMessage.content);
    setActionTriggered(true); // This will trigger handleSend in the useEffect
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
      <ChatInput 
        input={input} 
        setInput={setInput} 
        handleSend={handleSend} 
        waitingForAnswer={waitingForAnswer}
        onRegenerate={handleRegenerate}
        showRegenerate={chatHistory.length > 0}
      />
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
      </div>
      <DetailsOverlay isCollapsed={isCollapsed} toggleCollapse={toggleCollapse} lastNodeEdition={lastNodeEdition || []} nodes={nodes} />
    </div>
  );
};

export default ChatInterface;