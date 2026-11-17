# Third-Party Notices

MurphyEReader uses the third-party software listed below. Each component
remains under its own license; nothing in [LICENSE](LICENSE) changes those
terms. This file is provided for attribution and does not grant any license
to MurphyEReader itself.

## Runtime dependencies

| Component | License | Project |
| --- | --- | --- |
| Electron | MIT | https://github.com/electron/electron |
| React / React DOM | MIT | https://github.com/facebook/react |
| Zustand | MIT | https://github.com/pmndrs/zustand |
| better-sqlite3 | MIT | https://github.com/WiseLibs/better-sqlite3 |
| pdfjs-dist | Apache-2.0 | https://github.com/mozilla/pdf.js |
| pdf-lib | MIT | https://github.com/Hopding/pdf-lib |
| docx | MIT | https://github.com/dolanmiu/docx |
| html-to-image | MIT | https://github.com/bubkoo/html-to-image |
| KaTeX | MIT | https://github.com/KaTeX/KaTeX |

`pdfjs-dist` is distributed under the Apache License 2.0. If you redistribute
the application or its assets, retain the applicable copyright and NOTICE
information from that project.

## Runtime-installed tools (not bundled in this repository)

| Component | License | Project |
| --- | --- | --- |
| BabelDOC 0.7.1 | AGPL-3.0 | https://github.com/funstory-ai/BabelDOC |
| uv 0.13.8 | MIT OR Apache-2.0 | https://github.com/astral-sh/uv |

MurphyEReader's one-click installer downloads BabelDOC and uv from their
official distribution channels at the user's request. They are not included
in this repository or in the application installer.

BabelDOC's own dependency tree (including PyMuPDF, which is AGPL-3.0) is
governed by the BabelDOC distribution and its licenses. If you modify,
bundle, or redistribute BabelDOC or its dependencies, review the applicable
AGPL-3.0 obligations before distribution.

## Build-time tools

The following tools are used to build and test the project but are not
distributed with the application. Their licenses apply to those tools
themselves: electron-vite, Vite, Vitest, TypeScript, electron-builder,
@electron/rebuild, cross-env, jsdom, and the Testing Library packages.

## Trademarks

All product names, logos, and trademarks mentioned in this file belong to
their respective owners. References to third-party projects do not imply
endorsement.
