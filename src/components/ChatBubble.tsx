import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Message } from '../context/ChatContext';
import { safeJsonParse } from '../utils/jsonUtils';

const expandableMessagesTypes = ["reasoning", "nodeEdition", "selectedNodes", "moxus"];

const formatJsonContent = (content: string) => {
  try {
    const parsed = safeJsonParse(content);
    return JSON.stringify(parsed, null, 2);
  } catch (e) {
    return content;
  }
};

interface ChatBubbleProps {
  message: Message;
  onActionClick: (action: string) => void;
  showDebug?: boolean;
  onToggleDebug?: () => void;
  isWaiting?: boolean;
  onMessageEdit?: (index: number, newContent: string) => void;
  messageIndex: number;
}

const ChatBubble: React.FC<ChatBubbleProps> = ({ 
  message, 
  onActionClick,
  showDebug = true,
  onToggleDebug,
  isWaiting = false,
  onMessageEdit,
  messageIndex
}) => {
  const [isCollapsed, setIsCollapsed] = useState(expandableMessagesTypes.includes(message.role));
  const [displayedContent, setDisplayedContent] = useState(message.content);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDisplayedContent(message.content);
  }, [message.content]);

  useEffect(() => {
    if (isEditing && editTextareaRef.current) {
      editTextareaRef.current.focus();
      editTextareaRef.current.style.height = 'auto';
      editTextareaRef.current.style.height = `${editTextareaRef.current.scrollHeight}px`;
    }
  }, [isEditing]);

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleDoubleClick = () => {
    if (message.role === "assistant" && !message.isStreaming) {
      setIsEditing(true);
      setEditContent(message.content);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  const handleSaveEdit = () => {
    if (onMessageEdit && editContent !== message.content) {
      onMessageEdit(messageIndex, editContent);
      setDisplayedContent(editContent);
    }
    setIsEditing(false);
  };

  // Don't render debug messages if showDebug is false
  if (!showDebug && (expandableMessagesTypes.includes(message.role) || message.role === "moxus")) {
    return null;
  }

  return (
    <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"} mb-3`}>
      <div 
        className={`w-[90%] p-3 rounded-xl shadow-sm relative transition-all duration-200 ${
          message.role === "user" ? "bg-slate-600 text-white shadow-slate-500/30 animate-vibrate" :
          message.role === "userMandatoryInstructions" ? "bg-purple-600 text-white shadow-purple-500/30" :
          message.role === "moxus" ? "bg-cyan-700 text-white shadow-cyan-500/30" :
          message.role === "assistant" ? `bg-slate-700 text-white shadow-slate-500/30 ${isWaiting || message.isStreaming ? '' : 'cursor-pointer hover:bg-slate-600'}` :
          expandableMessagesTypes.includes(message.role) ? "bg-gray-50/50 border border-gray-100 text-gray-700" :
          "bg-transparent text-gray-600"
        }`}
        onDoubleClick={handleDoubleClick}
      >
        {expandableMessagesTypes.includes(message.role) && message.role !== "moxus" && (
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                message.role === "nodeEdition" ? "bg-gray-100 text-gray-600" : "bg-gray-100 text-gray-600"
              }`}>
                {message.role}
              </span>
              {showDebug && <span className="text-xs text-gray-500">{message.timestamp}</span>}
            </div>
            <div className="flex items-center space-x-2">
              {onToggleDebug && (
                <button
                  onClick={onToggleDebug}
                  className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                >
                  {showDebug ? "Hide Debug" : "Show Debug"}
                </button>
              )}
              <span 
                className="text-gray-500 hover:text-gray-600 cursor-pointer"
                onClick={toggleCollapse}
              >
                {isCollapsed ? "▼" : "▲"}
              </span>
            </div>
          </div>
        )}
        
        {message.role === "moxus" && (
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-cyan-600 text-white">
                Moxus Analysis
              </span>
              {showDebug && <span className="text-xs text-gray-200">{message.timestamp}</span>}
            </div>
            <div className="flex items-center space-x-2">
              {onToggleDebug && (
                <button
                  onClick={onToggleDebug}
                  className="text-xs text-gray-200 hover:text-white px-2 py-1 rounded hover:bg-cyan-600 transition-colors"
                >
                  {showDebug ? "Hide Debug" : "Show Debug"}
                </button>
              )}
              <span 
                className="text-gray-200 hover:text-white cursor-pointer"
                onClick={toggleCollapse}
              >
                {isCollapsed ? "▼" : "▲"}
              </span>
            </div>
          </div>
        )}
        
        {!expandableMessagesTypes.includes(message.role) && showDebug && (
          <span className="absolute bottom-1 right-2 text-xs text-gray-400">{message.timestamp}</span>
        )}
        
        {(!isCollapsed || message.role === "moxus") && (
          <div className="mt-2">
            {message.role === "actions" ? (
              <div className="space-y-2">
                {JSON.parse(message.content).map((action: string, index: number) => (
                  <button
                    key={index}
                    className="w-full bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs py-2 px-4 rounded-lg transition-colors duration-200"
                    onClick={() => onActionClick(action)}
                  >
                    {action}
                  </button>
                ))}
              </div>
            ) : message.role === "moxus" ? (
              <div className="prose prose-invert max-w-none text-white">
                <ReactMarkdown>{message.content.replace('**Moxus Report:**', '')}</ReactMarkdown>
              </div>
            ) : (
              <div className={`text-lg leading-relaxed ${
                expandableMessagesTypes.includes(message.role) ? "text-gray-700" : 
                message.role === "assistant" ? "text-justify" : ""
              }`}>
                {expandableMessagesTypes.includes(message.role) ? (
                  <pre className="whitespace-pre-wrap font-mono text-sm bg-gray-50/50 p-2 rounded-lg">
                    {formatJsonContent(message.content)}
                  </pre>
                ) : message.role === "assistant" ? (
                  isEditing ? (
                    <div className="relative">
                      <textarea
                        ref={editTextareaRef}
                        className="w-full p-2 bg-gray-800 text-white rounded resize-none"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onKeyDown={handleEditKeyDown}
                        onBlur={handleSaveEdit}
                      />
                      <div className="absolute bottom-2 right-2 text-xs text-gray-400">
                        Press Ctrl+Enter to save, Esc to cancel
                      </div>
                    </div>
                  ) : (
                    <div className="prose prose-invert max-w-none text-xl">
                      <ReactMarkdown>{displayedContent}</ReactMarkdown>
                      {message.isStreaming && <span className="animate-pulse">▋</span>}
                    </div>
                  )
                ) : (
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatBubble;
