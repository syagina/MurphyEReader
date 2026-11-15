// Third-party stylesheets load first so app styles can always override them.
// pdf_viewer.css also sets `color-scheme: light dark` on :root; loading it
// before styles.css keeps the app's light theme in control.
import 'pdfjs-dist/web/pdf_viewer.css';
import 'katex/dist/katex.min.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
