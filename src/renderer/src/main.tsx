// Third-party stylesheets load first so app styles can always override them.
// pdf_viewer.css also sets `color-scheme: light dark` on :root; loading it
// before styles.css keeps the app's light theme in control.
import 'pdfjs-dist/web/pdf_viewer.css';
import 'katex/dist/katex.min.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ExportDocument } from './components/ExportDocument';

const exportToken = new URLSearchParams(window.location.search).get('exportJob');
if (exportToken !== null) {
  // The export page is a full-height document, not the fixed application shell.
  document.body.classList.add('export-body');
}

createRoot(document.getElementById('root')!).render(
  exportToken !== null ? (
    <ExportDocument token={exportToken} />
  ) : (
    <StrictMode>
      <App />
    </StrictMode>
  ),
);
