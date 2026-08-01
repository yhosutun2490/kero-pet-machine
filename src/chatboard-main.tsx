import React from 'react';
import { createRoot } from 'react-dom/client';
import ChatboardApp from './ChatboardApp';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChatboardApp />
  </React.StrictMode>,
);
