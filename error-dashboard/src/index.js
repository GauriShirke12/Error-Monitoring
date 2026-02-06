import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { ToastProvider } from './components/toast/ToastContainer';
import { ProjectProvider } from './contexts/ProjectContext';
import { AuthProvider } from './contexts/AuthContext';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <AuthProvider>
          <ProjectProvider>
            <App />
          </ProjectProvider>
        </AuthProvider>
      </BrowserRouter>
    </ToastProvider>
  </React.StrictMode>
);
