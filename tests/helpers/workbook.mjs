import {zipSync,strToU8} from 'fflate';

// Minimal OOXML workbook with a physical row gap for provenance tests.
export function sampleWorkbook() {
  const types='http://schemas.openxmlformats.org/package/2006/content-types';
  const relationships='http://schemas.openxmlformats.org/package/2006/relationships';
  const office='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const sheet='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const content={
    '[Content_Types].xml': '<Types xmlns="'+types+'"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="'+relationships+'"><Relationship Id="rId1" Type="'+office+'/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<workbook xmlns="'+sheet+'" xmlns:r="'+office+'"><sheets><sheet name="Synthetic calls" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="'+relationships+'"><Relationship Id="rId1" Type="'+office+'/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
  };
  const rows=new Map([[1,['From ID','To ID','When']],[3,['A','X','2026-11-18 10:14']],[5,['B','X','2026-11-18 10:41']]]);
  const xml=[...rows].map(([idx,cells])=>'<row r="'+idx+'">'+cells.map((s,i)=>'<c r="'+String.fromCharCode(65+i)+idx+'" t="inlineStr"><is><t>'+s+'</t></is></c>').join('')+'</row>').join('');
  content['xl/worksheets/sheet1.xml']='<worksheet xmlns="'+sheet+'"><sheetData>'+xml+'</sheetData></worksheet>';
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(content).map(([name,value])=>[name,strToU8(value)]))));
}
