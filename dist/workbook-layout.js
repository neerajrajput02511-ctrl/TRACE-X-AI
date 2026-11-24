export const workbookSizeLimit = 10 * 1024 * 1024;
export const workbookExpandedLimit = 40 * 1024 * 1024;
export const worksheetEntry = /^xl\/worksheets\/[^/]+\.xml$/i;
export const restrictedEntry = /vbaProject|^xl\/externalLinks\//i;
const rowLimit = 100000, columnLimit = 128;

export function checkWorksheetXml(xml) {
  if (/<!DOCTYPE\b/i.test(xml)) throw new Error('Unsupported workbook declaration.');
  for (const tag of xml.matchAll(/<(?:\w+:)?(?:c|row)\b[^>]*\br\s*=\s*["']([A-Z]*)(\d+)["']/gi)) {
    let column = 0;
    for (const letter of tag[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
    if (column > columnLimit || Number(tag[2]) > rowLimit) {
      throw new Error('Use up to 100,000 worksheet rows and 128 columns.');
    }
  }
}

function csvCell(value) {
  if (value == null) return '';
  const text = value instanceof Date ? value.toISOString().replace(/Z$/, '') : String(value);
  // A literal newline inside a cell must not change physical worksheet row citations.
  return '"' + text.replace(/\r\n|\r|\n/g, '␤').replace(/"/g, '""') + '"';
}

export function worksheetToCsv(sheets) {
  const first = sheets[0];
  if (!first || sheets.length !== 1 || first.data.length < 2 || first.data.length > rowLimit) {
    throw new Error('Use one worksheet with a header and between 1 and 99,999 data rows.');
  }
  const width = first.data[0].length;
  if (first.data.some(row => row.length > columnLimit)) throw new Error('Use up to 128 worksheet columns.');
  return {
    sheet: first.sheet,
    text: first.data.map(row => Array.from({length:width}, (_, index) => csvCell(row[index])).join(',')).join('\n')
  };
}
