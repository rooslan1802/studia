import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';
import appLogo from '../../logo/logo.png';

const favicon = document.querySelector("link[rel='icon']") || document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/png';
favicon.href = appLogo;
if (!favicon.parentNode) {
  document.head.appendChild(favicon);
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
