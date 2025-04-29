import React, { useState } from 'react';
import { Message } from '../context/ChatContext';

const expandableMessagesTypes = ["reasoning", "nodeEdition", "selectedNodes"];

const formatJsonContent = (content: string) => {
  try {
    const parsed = JSON.parse(content);
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
}

const ChatBubble: React.FC<ChatBubbleProps> = ({ 
  message, 
  onActionClick,
  showDebug = true,
  onToggleDebug
}) => {
  const [isCollapsed, setIsCollapsed] = useState(expandableMessagesTypes.includes(message.role));

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  // Don't render debug messages if showDebug is false
  if (!showDebug && expandableMessagesTypes.includes(message.role)) {
    return null;
  }

  return (
    <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"} mb-3`}>
      <div className={`w-[90%] p-3 rounded-xl shadow-sm relative transition-all duration-200 ${
        message.role === "user" ? "bg-slate-600 text-white shadow-slate-500/30" :
        message.role === "assistant" ? "bg-slate-700 text-white shadow-slate-500/30" :
        expandableMessagesTypes.includes(message.role) ? "bg-gray-50/50 border border-gray-100 text-gray-700" :
        "bg-transparent text-gray-600"
      }`}>
        {expandableMessagesTypes.includes(message.role) && (
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
        {!expandableMessagesTypes.includes(message.role) && showDebug && (
          <span className="absolute bottom-1 right-2 text-xs text-gray-400">{message.timestamp}</span>
        )}
        {!isCollapsed && (
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
            ) : (
              <div className={`text-sm leading-relaxed ${
                expandableMessagesTypes.includes(message.role) ? "text-gray-700" : 
                message.role === "assistant" ? "text-justify" : ""
              }`}>
                {expandableMessagesTypes.includes(message.role) ? (
                  <pre className="whitespace-pre-wrap font-mono text-sm bg-gray-50/50 p-2 rounded-lg">
                    {formatJsonContent(message.content)}
                  </pre>
                ) : (
                  message.content
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
