import PDFDocument from 'pdfkit';
import {fileURLToPath} from 'node:url';

const font=fileURLToPath(new URL('../dist/fonts/body.ttf',import.meta.url));
const bold=fileURLToPath(new URL('../dist/fonts/body-semibold.ttf',import.meta.url));
const devanagari=fileURLToPath(new URL('../dist/fonts/hindi.ttf',import.meta.url));
const ink='#142547', secondary='#3e536d', blue='#1c48ae', gray='#d2dbea';
const stamp=value=>Number.isFinite(Date.parse(value))?new Date(value).toISOString().replace('T',' ').replace('.000Z',' UTC'): 'Not recorded';

export function createReportPdf(item) {
  const reviewed=item.review?.revisionKey===item.contentVersion;
  if(!reviewed||!item.findings?.length) throw Object.assign(new Error('The current report needs reviewer sign-off.'),{status:403});
  const doc=new PDFDocument({size:'A4',margin:44,bufferPages:true,info:{Title:'TRACE-X AI • '+item.name,Author:'Team SHYNE',Subject:'Reviewed investigation findings'}});
  const chunks=[];
  const result=new Promise((resolve,reject)=>{
    doc.on('data',chunk=>chunks.push(chunk));doc.once('end',()=>resolve(Buffer.concat(chunks)));doc.once('error',reject);
  });
  const choose=(s,weight=font)=>/[\u0900-\u097f]/u.test(s)?devanagari:weight;
  function text(s,opts){doc.font(choose(s)).fontSize(11.5).fillColor(ink).text(String(s),opts);}
  function heading(s){doc.moveDown(.75).font(bold).fontSize(17).fillColor(blue).text(s);doc.moveDown(.25);}
  doc.font(bold).fontSize(13).fillColor(blue).text('TRACE-X AI  /  TEAM SHYNE');
  doc.moveDown(.7).font(choose(item.name,bold)).fontSize(29).fillColor(ink).text(item.name);
  doc.moveDown(.35);
  text(item.id+'   •   Reviewed version '+item.contentVersion+(item.synthetic?'   •   SYNTHETIC CASE':''));
  text('Investigator: '+(item.owner||'Not recorded'));
  text('Reviewer: '+item.review.reviewer+'   •   '+stamp(item.review.signedAt));
  text('Prepared: '+stamp(new Date().toISOString()));
  const details=item.metadata||{};
  if(details.scopeStart||details.scopeEnd)text('Case period: '+(details.scopeStart||'Unspecified')+' to '+(details.scopeEnd||'Unspecified'));
  if(details.summary)text(details.summary);

  const recordMap=new Map(item.records.map(r=>[r.id,r]));
  const fileMap=new Map(item.files.map(f=>[f.id,f]));
  const includedFiles=new Set();
  heading('Reviewed findings');
  for(const f of item.findings) {
    doc.font(choose(f.title,bold)).fontSize(13).fillColor(ink).text(f.title);
    text(f.text);
    for(const id of new Set(f.ids)) {
      const record=recordMap.get(id);
      if(!record)continue;
      const locators=record.refs.map(ref=>{
        const file=fileMap.get(ref.fileId);includedFiles.add(ref.fileId);
        return (file?.name||ref.fileId)+(file?.sheet?' / '+file.sheet:'')+' / row '+ref.line;
      });
      text(id+' • '+stamp(record.time)+' • '+locators.join(' | '),{indent:10});
      if(record.kind==='IPDR'&&(!record.port||!record.protocol))text('Data quality: missing '+[!record.port?'source port':'',!record.protocol?'protocol':''].filter(Boolean).join(' and ')+'. Subscriber attribution may be ambiguous.',{indent:10});
    }
    doc.moveDown(.65);
  }
  heading('Original source fingerprints');
  for(const id of includedFiles) {
    const f=fileMap.get(id);
    if(!f)continue;
    text(f.name+' • '+f.type);
    text('SHA-256   '+f.sha256);
    text(f.qa.accepted+' accepted • '+f.qa.duplicate+' duplicate • '+f.qa.rejected+' rejected');
    doc.moveDown(.4);
  }
  heading('Activity summary');
  const events=[...(item.audit||[]),...(item.activity||[])].sort((a,b)=>String(a.time).localeCompare(String(b.time)));
  text(events.length+' recorded events • most recent 12 shown');
  for(const e of events.slice(-12))text(stamp(e.time)+' • '+e.action+' • '+(e.actor||'Workspace'));
  heading('Interpretation limits');
  text('Findings describe the supplied records. Tower observations represent network coverage areas. A shared IP or device identifier can have multiple explanations. A hash records file integrity against the recorded digest.');
  const pages=doc.bufferedPageRange();
  for(let i=pages.start;i<pages.start+pages.count;i++){
    doc.switchToPage(i);
    const y=doc.page.height-34;
    doc.strokeColor(gray).moveTo(44,y-7).lineTo(doc.page.width-44,y-7).stroke();
    doc.font(font).fontSize(9).fillColor(secondary).text('TRACE-X AI  /  '+item.id+'  /  '+(i+1)+' of '+pages.count,44,y,{lineBreak:false});
  }
  doc.end();
  return result;
}
