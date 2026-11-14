import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

export const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
export const SAMPLE_TEXT_PDF = join(FIXTURES_DIR, 'sample-text.pdf');
export const SAMPLE_SCANNED_PDF = join(FIXTURES_DIR, 'sample-scanned.pdf');

// 1x1 transparent PNG used to build a page without any text layer.
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Deterministic English filler keeps the extracted text well above the
// hasTextLayer threshold while the marker line stays intact on every page.
const FILLER_LINES = [
  'This deterministic filler paragraph keeps the extracted text layer comfortably',
  'above the detection threshold. It mentions finite element methods, numerical',
  'analysis and reproducible research tooling for the PaperLens desktop reader.',
];

function writeFixture(target: string, bytes: Uint8Array): void {
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, bytes);
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(temp, target);
      return;
    } catch (error) {
      if (attempt >= 50) {
        rmSync(temp, { force: true });
        throw error;
      }
      // Another test worker may briefly hold the target open on Windows.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

export async function generateFixtures(): Promise<void> {
  if (existsSync(SAMPLE_TEXT_PDF) && existsSync(SAMPLE_SCANNED_PDF)) {
    return;
  }
  mkdirSync(FIXTURES_DIR, { recursive: true });

  const textDoc = await PDFDocument.create();
  const textFont = await textDoc.embedFont(StandardFonts.Helvetica);
  for (let pageNo = 1; pageNo <= 2; pageNo += 1) {
    const page = textDoc.addPage([612, 792]);
    page.drawText(`PaperLens sample page ${pageNo}`, {
      x: 72,
      y: 720,
      size: 16,
      font: textFont,
    });
    FILLER_LINES.forEach((line, index) => {
      page.drawText(line, { x: 72, y: 690 - index * 18, size: 11, font: textFont });
    });
  }
  writeFixture(SAMPLE_TEXT_PDF, await textDoc.save());

  const scannedDoc = await PDFDocument.create();
  const pixel = await scannedDoc.embedPng(ONE_PIXEL_PNG_BASE64);
  const scannedPage = scannedDoc.addPage([612, 792]);
  scannedPage.drawImage(pixel, { x: 72, y: 720, width: 64, height: 64 });
  writeFixture(SAMPLE_SCANNED_PDF, await scannedDoc.save());
}
