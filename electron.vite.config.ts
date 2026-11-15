import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
    build: {
      // Word export snapshots KaTeX nodes with html-to-image. Under the
      // packaged app's file:// origin, fetching font files is unreliable, so
      // inline KaTeX's fonts into the built CSS and let the serializer embed
      // them as data URLs. Only fonts may be inlined: a blanket limit also
      // inlined the PDF.js worker as a data: URL, which the production CSP
      // (script-src 'self') refuses to load, leaving every PDF unopenable.
      assetsInlineLimit: (filePath) => /\.(woff2?|ttf|otf)$/i.test(filePath),
    },
  },
});
