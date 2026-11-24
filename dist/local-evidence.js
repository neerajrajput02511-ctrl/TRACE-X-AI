import {importFile, previewImport} from './engine.js';
import {sha256} from './crypto.js';
import {checkWorksheetXml, restrictedEntry, workbookExpandedLimit, workbookSizeLimit, worksheetEntry, worksheetToCsv} from './workbook-layout.js';

const isWorkbook = name => /\.xlsx$/i.test(name);
const checkedSheets = new WeakMap();

async function workbook(file, bytes) {
  const {readXlsx, unzipSync} = await import('./vendor/workbook.js');
  const worksheetFiles = [];
  let expanded = 0, entries = 0, expectedWorkbook = false;
  let contents;
  try {
    contents = unzipSync(bytes, {filter(entry) {
      entries++;
      expanded += entry.originalSize;
      if (entries > 300 || expanded > workbookExpandedLimit || restrictedEntry.test(entry.name)) {
        throw new Error('Unsupported workbook contents.');
      }
      if (entry.name === 'xl/workbook.xml') expectedWorkbook = true;
      if (!worksheetEntry.test(entry.name)) return false;
      worksheetFiles.push(entry.name);
      if (worksheetFiles.length > 1) throw new Error('Multiple worksheets.');
      return true;
    }});
  } catch {
    throw new Error('Choose a readable .xlsx file with one worksheet, without macros or external links.');
  }
  if (!expectedWorkbook || worksheetFiles.length !== 1) throw new Error('The workbook must contain exactly one worksheet.');
  checkWorksheetXml(new TextDecoder().decode(contents[worksheetFiles[0]]));
  let sheets;
  try {
    sheets = await readXlsx(file, {trim:false, parseNumber:String});
  } catch {
    throw new Error('Could not read the XLSX worksheet. Check its format or use a UTF-8 CSV.');
  }
  return worksheetToCsv(sheets);
}

function readWorkbook(file, bytes) {
  if (file.size > workbookSizeLimit) throw new Error('Choose a source file under 10 MB.');
  if (!checkedSheets.has(file)) {
    const parsed = (async () => workbook(file, bytes || new Uint8Array(await file.arrayBuffer())))();
    checkedSheets.set(file, parsed);
  }
  return checkedSheets.get(file);
}

function base64(bytes) {
  const chunks = [];
  for (let start = 0; start < bytes.length; start += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(start, start + 32768)));
  }
  return btoa(chunks.join(''));
}

export function originalSourceBytes(file) {
  return file.originalBase64
    ? Uint8Array.from(atob(file.originalBase64), character => character.charCodeAt(0))
    : new TextEncoder().encode(file.raw || '');
}

export async function previewLocalFile(file) {
  if (!isWorkbook(file.name)) return previewImport(file);
  const {text, sheet} = await readWorkbook(file);
  return {...await previewImport(text), sheet};
}

export async function importLocalFile(item, file, options) {
  if (!isWorkbook(file.name)) return importFile(item, file.name, file, options);
  if (file.size > workbookSizeLimit) throw new Error('Choose a source file under 10 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256(bytes);
  const previous = item.files.find(f => f.sha256 === hash);
  if (previous) {
    return {...previous.qa, accepted:0, duplicate:previous.qa.accepted+previous.qa.duplicate, alreadyImported:true};
  }
  const {text, sheet} = await readWorkbook(file, bytes);
  // Workbooks with the same worksheet text can still have distinct original bytes.
  const draft = {...item, files:item.files.map(f => ({...f, sha256:''}))};
  const qa = await importFile(draft, file.name, text, options);
  const normalized = draft.files.at(-1);
  Object.assign(normalized, {sha256:hash, originalBase64:base64(bytes), sheet});
  qa.sheet = sheet;
  item.files.push(normalized);
  return qa;
}
