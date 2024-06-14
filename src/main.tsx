import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import { ChatProvider } from './context/ChatContext';
import './index.css';

ReactDOM.render(
  <ChatProvider>
    <App />
  </ChatProvider>,
  document.getElementById('root')
);
