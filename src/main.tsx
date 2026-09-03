import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import App from './App';
import GuidesApp from './guides-app';
import './styles.css';
import './r3a.css';
import './platform.css';
import './home-continuity';
import './home-map';
import './home-map-overlays.css';

function RootSurface() {
  const location = useLocation();
  return location.pathname.startsWith('/guias') ? <GuidesApp /> : <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <RootSurface />
    </BrowserRouter>
  </React.StrictMode>,
);