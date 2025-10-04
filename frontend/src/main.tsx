import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './contexts/ThemeContext';
import './index.css';
import './styles/markdown-preview.css';
import { registerMonacoGlobalErrorHandlers } from './utils/monaco-error-handlers';

// 注册全局 Monaco 错误处理（弹窗而非页面覆盖）
registerMonacoGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
