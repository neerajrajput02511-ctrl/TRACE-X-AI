import Busboy from 'busboy';
import yauzl from 'yauzl';
import readXlsx from 'read-excel-file/node';
import {createHash} from 'node:crypto';
import * as engine from '../dist/engine.js';
import {checkWorksheetXml, restrictedEntry, workbookExpandedLimit, workbookSizeLimit, worksheetEntry, worksheetToCsv} from '../dist/workbook-layout.js';

const limit = workbookSizeLimit;
const accepted = /\.(csv|tsv|txt|xlsx)$/i;
const problem = (message, status=400)=>Object.assign(new Error(message),{status});
const sha = bytes=>createHash('sha256').update(bytes).digest('hex');
function options(input={}) {
  if(!input || Array.isArray(input) || typeof input!=='object')throw problem('Supply valid import options.');
  const {columnMap,timezoneOffsetMinutes,revision}=input;
  if(columnMap!==undefined && (!columnMap || typeof columnMap!=='object' || Array.isArray(columnMap) ||
      Object.keys(columnMap).length>48 || Object.entries(columnMap).some(([key,value])=>!/^\w{1,32}$/.test(key)||typeof value!=='string'||value.length>256)))throw problem('Supply a valid column map.');
  if(revision!==undefined && (!Number.isSafeInteger(revision)||revision<0))throw problem('Supply a valid revision.');
  if(timezoneOffsetMinutes!==undefined && (!Number.isInteger(timezoneOffsetMinutes)||Math.abs(timezoneOffsetMinutes)>840))throw problem('Invalid timezone offset.');
  return {columnMap,timezoneOffsetMinutes,revision};
}

export async function readUpload(req) {
  if(Number(req.headers['content-length']||0)>limit+65536)throw problem('Choose a source file smaller than 10 MB.',413);
  return new Promise((resolve,reject)=>{
    let parser;
    try {parser=Busboy({headers:req.headers,limits:{files:1,fields:2,fileSize:limit,fieldSize:12000,parts:4}});}
    catch {reject(problem('Use multipart/form-data with a file field.',415));return;}
    let filename='', bytes, preview=false, settings={}, issue;
    parser.on('file',(key,stream,info)=>{
      filename=info.filename;
      const chunks=[];
      if(key!=='file'||!accepted.test(filename)||filename.length>254||/[\x00-\x1f\x7f/\\]/.test(filename)){
        issue=problem('Select a CSV, TSV, TXT or XLSX file.',415);stream.resume();return;
      }
      stream.on('data',chunk=>chunks.push(chunk));
      stream.on('limit',()=>{issue=problem('Choose a source file smaller than 10 MB.',413);});
      stream.on('end',()=>{bytes=Buffer.concat(chunks);});
    });
    parser.on('field',(key,value,info)=>{
      try{
        if(info.valueTruncated)throw problem('Import options exceed the size limit.',413);
        if(key==='options')settings=options(JSON.parse(value));
        else if(key==='preview')preview=value==='true';
        else throw problem('Unexpected upload field.');
      }catch(error){issue=error.status?error:problem('Invalid import options.');}
    });
    for(const name of ['partsLimit','filesLimit','fieldsLimit'])parser.on(name,()=>{issue=problem('Upload one source file at a time.',413);});
    parser.on('error',()=>reject(problem('Could not read the upload.')));
    req.on('aborted',()=>reject(problem('Upload cancelled.')));
    parser.on('close',()=>issue?reject(issue):bytes?.length?resolve({filename,bytes,preview,options:settings}):reject(problem('The source file is empty.')));
    req.pipe(parser);
  });
}

async function inspectZip(bytes) {
  return new Promise((resolve,reject)=>{
    const invalid=()=>reject(problem('The XLSX must contain one supported worksheet with no macros and at most 100,000 rows and 128 columns.'));
    yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
      if(error){invalid();return;}
      const fail=()=>{zip.close();invalid();};
      let total=0, worksheets=0, workbook=false;
      zip.on('error',fail);
      zip.on('end',()=>workbook&&worksheets===1?resolve():invalid());
      zip.on('entry',entry=>{
        total+=entry.uncompressedSize;
        const name=entry.fileName;
        if(zip.entryCount>300||total>workbookExpandedLimit||restrictedEntry.test(name)){fail();return;}
        if(name==='xl/workbook.xml')workbook=true;
        if(!worksheetEntry.test(name)){zip.readEntry();return;}
        if(++worksheets>1){fail();return;}
        zip.openReadStream(entry,(err,stream)=>{
          if(err){fail();return;}
          const chunks=[];
          stream.on('data',chunk=>chunks.push(chunk));stream.on('error',fail);
          stream.on('end',()=>{
            try{checkWorksheetXml(Buffer.concat(chunks).toString('utf8'));}
            catch{fail();return;}
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}
async function workbook(bytes) {
  await inspectZip(bytes);
  let sheets;
  try {sheets=await readXlsx(bytes,{trim:false,parseNumber:String});}
  catch {throw problem('Could not read the XLSX worksheet. Save it as a UTF-8 CSV if the workbook uses unsupported cells.');}
  return worksheetToCsv(sheets);
}
export async function previewUpload(upload) {
  try {
    if(!/\.xlsx$/i.test(upload.filename))return await engine.previewImport(upload.bytes,upload.options);
    const {text,sheet}=await workbook(upload.bytes);
    return {...await engine.previewImport(text,upload.options),sheet};
  }catch(error){throw error.status?error:problem(error.message);}
}
export async function stageImport(item, {filename,bytes,options:settings={}}) {
  try {
    if(!/\.xlsx$/i.test(filename))return await engine.importFile(item,filename,bytes,settings);
    const hash=sha(bytes), previous=item.files.find(f=>f.sha256===hash);
    if(previous)return {...previous.qa,accepted:0,duplicate:previous.qa.accepted+previous.qa.duplicate,alreadyImported:true};
    const {text,sheet}=await workbook(bytes);
    // Use the true workbook digest for idempotence. Independent workbooks may
    // contain identical rows, so retain all workbook provenance for deduped calls.
    const shadows=item.files.map(({sha256,...rest})=>({...rest,sha256:''}));
    const draft={...item,files:shadows};
    const qa=await engine.importFile(draft,filename,text,settings);
    const file=draft.files.at(-1);
    file.sha256=hash;
    file.originalBase64=Buffer.from(bytes).toString('base64');
    file.sheet=sheet;
    qa.sheet=sheet;
    item.files.push(file);
    return qa;
  }catch(error){throw error.status?error:problem(error.message);}
}
export function replaySourceFile(item,file) {
  const bytes=file.originalBase64?Buffer.from(file.originalBase64,'base64'):Buffer.from(file.raw,'utf8');
  if(!bytes.length||bytes.length>limit||!accepted.test(file.name))throw problem('Invalid original source file.');
  const settings=options({columnMap:file.qa?.columnMap,timezoneOffsetMinutes:file.qa?.defaultTimezoneOffsetMinutes});
  return stageImport(item,{filename:file.name,bytes,options:settings});
}
