import React, { useState } from 'react';
import { Message } from '../context/ChatContext';

const expandableMessagesTypes = ["reasoning", "nodeEdition", "selectedNodes"];

const ChatBubble: React.FC<{ message: Message, onActionClick: (action: string) => void }> = ({ message, onActionClick }) => {
  const [isCollapsed, setIsCollapsed] = useState(expandableMessagesTypes.includes(message.role));

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"} mb-2`}>
      <div className={`w-[90%] p-4 rounded-lg shadow-md relative ${
        message.role === "user" ? "bg-blue-500 text-white" :
        message.role === "assistant" ? "bg-gray-300 text-black" :
        "bg-gray-200 text-gray-700 text-xs"
      }`}>
        {expandableMessagesTypes.includes(message.role) && (
          <div className="flex justify-between items-center cursor-pointer" onClick={toggleCollapse}>
            <span className="text-xs ml-2 italic">{message.role}</span>
            <span className="text-xs ml-2">{message.timestamp}</span>
            <span className="ml-2">{isCollapsed ? "+" : "-"}</span>
          </div>
        )}
        {!expandableMessagesTypes.includes(message.role) && (
          <span className="absolute bottom-1 right-2 text-xs">{message.timestamp}</span>
        )}
        {!isCollapsed && (
          <div className="mt-2">
            {message.role === "actions" ? (
              JSON.parse(message.content).map((action: string, index: number) => (
                <button
                  key={index}
                  className="bg-blue-500 text-white p-2 rounded mt-1 w-full"
                  onClick={() => onActionClick(action)}
                >
                  {action}
                </button>
              ))
            ) : (
              <div>{message.content}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatBubble;
