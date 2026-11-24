import PDFDocument from 'pdfkit';
import {fileURLToPath} from 'node:url';
import {assertReportReady, reportOptions, writeReport} from '../dist/report-layout.js';

const fonts = {
  font: fileURLToPath(new URL('../dist/fonts/body.ttf', import.meta.url)),
  bold: fileURLToPath(new URL('../dist/fonts/body-semibold.ttf', import.meta.url)),
  devanagari: fileURLToPath(new URL('../dist/fonts/hindi.ttf', import.meta.url))
};

export function createReportPdf(item) {
  assertReportReady(item);
  const doc = new PDFDocument(reportOptions(item));
  const chunks = [];
  return new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.once('end', () => resolve(Buffer.concat(chunks)));
    doc.once('error', reject);
    writeReport(doc, item, fonts);
    doc.end();
  });
}
