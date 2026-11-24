import {assertReportReady, reportOptions, writeReport} from './report-layout.js';

async function readFont(name) {
  const response = await fetch(new URL('./fonts/' + name, import.meta.url));
  if (!response.ok) throw new Error('A report font could not be loaded.');
  return response.arrayBuffer();
}

export async function createDeviceReport(item) {
  assertReportReady(item);
  const [, font, bold, devanagari] = await Promise.all([
    import('./vendor/pdfkit.js'), readFont('body.ttf'), readFont('body-semibold.ttf'), readFont('hindi.ttf')
  ]);
  if (typeof globalThis.PDFDocument !== 'function') throw new Error('The PDF renderer could not be loaded.');
  const doc = new globalThis.PDFDocument(reportOptions(item));
  const chunks = [];
  return new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.once('error', reject);
    doc.once('end', () => resolve(new Blob(chunks, {type:'application/pdf'})));
    writeReport(doc, item, {font, bold, devanagari}, {local:true});
    doc.end();
  });
}
