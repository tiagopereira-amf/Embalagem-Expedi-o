import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { Guard } from './components/Guard.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Guard>
      <App />
    </Guard>
  </StrictMode>,
);
