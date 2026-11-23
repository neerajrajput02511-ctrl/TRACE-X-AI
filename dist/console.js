import {createDemo,createCase,importFile,analyze,ask} from './engine.js';
import {listCases,saveCase} from './storage.js';
import {icon,esc,count,stamp,button,head,rowRefs,empty} from './case-ui.js';
import {sections,shell,overview,sources,network,towers,devices,assistant,reports,reviewed,pageHeader} from './case-views.js';
import './register.js';

const $ = selector=>document.querySelector(selector);
const views={overview,sources,network,towers,devices,assistant,reports};
const state={view:'overview',search:'',offset:0,node:'',towerSubject:'',edgeLimit:50,timelineLimit:50,deviceLimit:50,ipLimit:50,auditLimit:20};
const aliases={graph:'network',evidence:'sources',report:'reports',map:'towers'};
let cases=[], c=null, a=null, busy=false, noteTimer;
const team=()=>window.TRACEX_TEAM===true;
const canEdit=()=>!team() || ['investigator','admin'].includes(window.traceSession?.role);
const canReview=()=>!team() || ['reviewer','admin'].includes(window.traceSession?.role);
const uid=()=>crypto.randomUUID();
function log(item,action,detail){(item.audit||=[]).push({time:new Date().toISOString(),action,detail});}
function dirty(item){item.contentVersion=(item.contentVersion||0)+1;item.review=null;}
function remembered() {try{return localStorage.getItem(team()?'tracex.team.case':'tracex.active.case');}catch{return null;}}
function remember(id) {try{localStorage.setItem(team()?'tracex.team.case':'tracex.active.case',id);}catch{/* Browser storage may be unavailable in private mode. */}}
function toast(message,error=false){
  clearTimeout(noteTimer);
  const el=$('#status'); el.textContent=message;el.className='toast '+(error?'error':'');
  noteTimer=setTimeout(()=>{el.className='';el.textContent='';},6500);
}
function fail(error){toast(error?.message || 'Unable to complete this action.',true);}
function getView(){const key=location.hash.slice(1).toLowerCase();return Object.hasOwn(views,aliases[key]||key)?(aliases[key]||key):'overview';}
function nav(key){if(state.view===key){render();return;}location.hash=key;}
function hideModal(){if($('#case-dialog').open)$('#case-dialog').close();}
function modal(title,content,wide=false){
  const box=$('#case-dialog');box.className=wide?'wide':'';
  box.innerHTML=`<header class="dialog-top"><h2 id="dialog-title">${esc(title)}</h2><button type="button" class="icon-button" aria-label="Close dialog" data-action="close">${icon('close')}</button></header><div class="dialog-body">${content}</div>`;
  if(!box.open)box.showModal();box.scrollTop=0;
}
function selectCase(id){
  c=cases.find(x=>x.id===id)||cases[0];a=c?analyze(c):null;
  Object.assign(state,{search:'',offset:0,node:'',towerSubject:'',edgeLimit:50,timelineLimit:50,deviceLimit:50,ipLimit:50,auditLimit:20});
  if(c)remember(c.id);hideModal();render();
}
function accountControls(){
  if(!team() || !window.traceSession)return '';
  return '<div class="team-user">'+icon('user',16)+'<span>'+esc(window.traceSession.username)+' · '+esc(window.traceSession.role)+'</span>'+button('Sign out','logout','','text-button')+'</div>';
}
function render(){
  state.view=getView();
  if(!c){
    $('#sidebar').innerHTML='<a href="./index.html" class="brand">TRACE−X</a>'+accountControls();
    $('#main').innerHTML=head('Case workspace','No case is available for this account.')+(canEdit()?button('Create case','new','','button primary','plus'):'');
    document.querySelector('#topbar').innerHTML=accountControls();
    return;
  }
  const s=shell(state.view,cases,c,!team());
  $('#sidebar').innerHTML=s.side;
  $('#topbar').innerHTML=s.top;
  $('#main').innerHTML=pageHeader(state.view,c)+views[state.view](c,a,state);
  if(!canEdit()){
    document.querySelectorAll('[data-action="import"],[data-action="save-chat"],#switch-case option[value="__new__"]').forEach(el=>el.remove());
  }
  if(!canReview()) document.querySelectorAll('[data-action="review"]').forEach(el=>{el.disabled=true;el.title='A reviewer must sign this report.';});
  if(state.view==='reports' && !team()) {
    const review=$('[data-action="review"]');if(review)review.title='Record a local self-review on this device';
  }
  if(team() && window.traceSession){
    const foot=$('.side-foot'); if(foot)foot.insertAdjacentHTML('beforebegin',`${accountControls()}`);
  }
  document.title=sections[state.view][0]+' · TRACE-X';
}
async function write(fn) {
  if(busy) throw new Error('An operation is in progress. Wait for it to finish.');
  busy=true;document.body.classList.add('pending');
  try{
    const item=structuredClone(c);
    const result=await fn(item);
    await saveCase(item);
    cases=cases.map(x=>x.id===item.id?item:x);
    c=item;a=analyze(c);render();return result;
  }finally{busy=false;document.body.classList.remove('pending');}
}
function newCaseModal(){
  if(!canEdit())throw new Error('Only an investigator or admin can create a case.');
  modal('Create case',`<form data-form="new-case" class="dialog-form"><label for="new-case-name">Case name</label><input id="new-case-name" autofocus name="name" maxlength="80" required placeholder="e.g. Airport liaison"><p>Evidence, questions and findings are kept within this case.</p><div class="form-actions">${button('Cancel','close','','button')}<button class="button primary">Create case</button></div></form>`);
}
function importModal(){
  if(!canEdit())throw new Error('Your role cannot import files.');
  modal('Import evidence',`<form data-form="import" class="dialog-form"><p>Import CDR, IPDR or tower lists as CSV or TSV. Use synthetic data in the demo. Times without an offset are read as IST.</p><label class="file-picker" for="evidence-files">${icon('upload',28)}<strong>Select evidence files</strong><span>CSV or TSV · multiple files supported</span><input id="evidence-files" type="file" name="files" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" multiple required></label><details class="example"><summary>Supported header examples</summary><p>CDR</p><code>Calling Number,Called Number,Timestamp,Duration,Cell ID</code><p>IPDR</p><code>Subscriber,Public IP,Source Port,Protocol,Session Start,Session End</code><p>Tower list</p><code>Cell ID,Tower Name,Latitude,Longitude</code></details><div class="form-actions">${button('Cancel','close','','button')}<button class="button primary">Import files</button></div></form>`);
}
function detailsTable(items){return `<dl class="details">${items.map(([label,v])=>`<dt>${esc(label)}</dt><dd>${esc(v??'—')}</dd>`).join('')}</dl>`;}
function showFile(id){
  const f=c.files.find(v=>v.id===id);if(!f)return;
  const qa=f.qa;
  modal('Source file',`<h3 class="dialog-file">${esc(f.name)}</h3>${detailsTable([['Type',f.type],['SHA-256',f.sha256],['Accepted',qa.accepted],['Duplicates',qa.duplicate],['Rejected',qa.rejected]])}
    ${qa.issues?.length?`<h3>Quality checks</h3><ul class="qa-list">${qa.issues.map(x=>`<li>Line ${esc(x.line)} · ${esc(x.message)}</li>`).join('')}</ul>`:''}<details class="example"><summary>Original file preview</summary><pre>${esc(String(f.raw||'').slice(0,12000))}</pre>${(f.raw||'').length>12000?'<p>Preview limited to 12,000 characters. The original file remains in the case.</p>':''}</details>`,true);
}
function showRow(id){
  const r=c.records.find(x=>x.id===id);if(!r)return;
  modal('Source record '+id,`<div class="record-title"><span class="sample-tag">${esc(r.kind)}</span><strong>${stamp(r.time)} IST</strong></div>${detailsTable([['Party',r.from],...(r.to?[['Counterparty',r.to]]:[]),...(r.kind==='CDR'?[['Duration',r.duration+' seconds']]:[['Public IP',r.ip],['Source port',r.port||'Missing'],['Protocol',r.protocol||'Missing']]),...(r.cell?[['Cell',r.cell]]:[])])}<h3>Original source rows</h3>${(r.refs||[]).map(ref=>{
    const f=c.files.find(x=>x.id===ref.fileId);return `<div class="raw-row"><div><strong>${esc(f?.name||ref.fileId)}</strong><span>Line ${esc(ref.line)}</span></div><pre>${esc(ref.raw)}</pre>${f?button('View file & fingerprint','file',f.id,'text-button'):''}</div>`;
  }).join('')}`,true);
}
function showRows(ids){
  const set=new Set(ids), rows=c.records.filter(r=>set.has(r.id));
  modal('Cited source rows',rows.length?`<div class="file-list">${rows.map(r=>`<button class="file-entry" data-action="row" data-value="${esc(r.id)}"><span class="file-icon">${icon('file',17)}</span><span class="file-entry-name"><strong>${esc(r.id)} · ${esc(r.from)} ${r.to?' / '+esc(r.to):''}</strong><small>${stamp(r.time)} IST</small></span><span class="file-link">Open row</span></button>`).join('')}</div>`:empty('No matching rows','This case has no source rows for this selection.'),true);
}
function showLead(id){
  const l=a.leads.find(x=>x.id===id);if(!l)return;
  modal('Case lead',`<h3>${esc(l.title)}</h3><p>${esc(l.detail)}</p><h4>Cited records</h4>${rowRefs(l.ids)}<div class="form-actions">${canEdit()?button('Save finding','save-lead',l.id,'button primary','bookmark'):''}</div>`);
}
async function saveFinding(title,text,ids){
  if(!canEdit())throw new Error('Your role cannot edit findings.');
  if(!ids.length || ids.some(id=>!c.records.some(r=>r.id===id)))throw new Error('A finding must cite records in the current case.');
  if(c.findings?.some(f=>f.title===title&&f.text===text&&JSON.stringify(f.ids)===JSON.stringify(ids))){hideModal();toast('This finding is already in the report.');return;}
  await write(item=>{(item.findings||=[]).push({id:uid(),title,text,ids:[...new Set(ids)],createdAt:new Date().toISOString()});dirty(item);log(item,'Finding saved',title);});
  hideModal();toast('Finding saved to the case report.');
}
async function submitAsk(question){
  if(!question.trim())return;
  await write(async item=>{
    const answer=ask(item,question);
    if(!answer.supported) {
      try {
        const {routeQuestion}=await import('./query-router.js');
        answer.suggestion=await routeQuestion(item,question);
      } catch {answer.suggestion=null;}
    }
    (item.chat||=[]).push({id:uid(),question,...answer,time:new Date().toISOString()});
    log(item,'Assistant query',question);
  });
  const latest=$('.exchange:last-child'); if(latest) latest.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function reviewModal(){
  if(!canReview())throw new Error('A reviewer must sign this report.');
  if(!c.findings?.length){toast('Save at least one cited finding before review.',true);return;}
  modal(team()?'Review & sign report':'Local review & sign-off',`<form data-form="review" class="dialog-form"><p>Review ${count(c.findings.length)} saved finding${c.findings.length===1?'':'s'} and their source rows before signing.</p><label for="reviewer">Reviewer name</label><input name="reviewer" id="reviewer" required maxlength="80" ${team()?`value="${esc(window.traceSession?.username)}" readonly`:'placeholder="Enter your name"'}><label class="check-field"><input type="checkbox" required> I have reviewed the cited source records and the limits of each finding.</label><div class="form-actions">${button('Cancel','close','','button')}<button class="button primary">Sign report</button></div></form>`);
}
async function printReport(){
  if(!reviewed(c))throw new Error('Review and sign the current report before printing.');
  await write(item=>log(item,'Report prepared','Signed version '+(item.contentVersion||0)+' prepared for printing.'));
  const findingRows=c.findings.flatMap(f=>f.ids), ids=new Set(findingRows);
  const records=c.records.filter(r=>ids.has(r.id)),files=new Set(records.flatMap(r=>r.refs.map(ref=>ref.fileId)));
  $('#print-report').innerHTML=`<div class="print-title">TRACE−X / INVESTIGATION REPORT</div><h1>${esc(c.name)}</h1><p>${esc(c.id)} · ${team()?'Team review':'Local review'} · ${c.id==='CASE-RJ-001'?'Synthetic demonstration case · ':''}Version ${c.contentVersion||0}</p><p>Reviewed by ${esc(c.review.reviewer)} on ${stamp(c.review.signedAt)} IST.</p><h2>Reviewed findings</h2>${c.findings.map(f=>`<article><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p><p>Source IDs · ${f.ids.map(esc).join(', ')}</p></article>`).join('')}<h2>Source citations</h2>${records.map(r=>`<p><strong>${esc(r.id)}</strong> · ${stamp(r.time)} IST · ${r.refs.map(ref=>esc(c.files.find(f=>f.id===ref.fileId)?.name||ref.fileId)+' (line '+esc(ref.line)+')').join(', ')}</p>`).join('')}<h2>Source file fingerprints</h2>${c.files.filter(f=>files.has(f.id)).map(f=>`<p><strong>${esc(f.name)}</strong><br>SHA-256 · <code>${esc(f.sha256)}</code></p>`).join('')}<p>Findings describe patterns observed in the imported records. Investigator review is required for interpretation.</p>`;
  window.print();
}
async function imported(files){
  if(!canEdit())throw new Error('Your role cannot import files.');
  if(!files.length)throw new Error('Choose at least one file.');
  const outcomes=[];
  await write(async item=>{
    let changed=false;
    for(const f of files){
      try{
        const before=item.files.length;
        const qa=await importFile(item,f.name,new Uint8Array(await f.arrayBuffer()));
        outcomes.push({name:f.name,qa});
        if(item.files.length!==before){changed=true;log(item,'Evidence imported',f.name+' · '+qa.accepted+' accepted, '+qa.duplicate+' duplicates, '+qa.rejected+' rejected');}
      }catch(err){outcomes.push({name:f.name,error:err.message});}
    }
    if(changed)dirty(item);
  });
  modal('Import results',`<div class="import-results">${outcomes.map(o=>`<article><h3>${esc(o.name)}</h3><p>${o.error?esc(o.error):`${count(o.qa.accepted)} accepted · ${count(o.qa.duplicate)} duplicates · ${count(o.qa.rejected)} rejected`}</p></article>`).join('')}</div><div class="form-actions">${button('Open evidence library','finish-import','','button primary')}</div>`);
}
document.addEventListener('click',async event=>{
  const btn=event.target.closest('[data-action]');if(!btn)return;
  const action=btn.dataset.action,v=btn.dataset.value || '';
  if(busy){toast('Saving the current action…');return;}
  try{
    switch(action){
      case 'logout':{
        const response=await fetch('./api/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
        if(!response.ok)throw new Error('Could not sign out. Please try again.');
        window.location.replace('./login.html');break;
      }
      case 'menu':{const open=document.body.classList.toggle('menu-open');btn.setAttribute('aria-expanded',String(open));break;}
      case 'close':hideModal();break;
      case 'nav':nav(v);break;
      case 'new':newCaseModal();break;
      case 'import':importModal();break;
      case 'finish-import':hideModal();nav('sources');break;
      case 'file':showFile(v);break;
      case 'row':showRow(v);break;
      case 'rows':showRows(JSON.parse(v));break;
      case 'lead':showLead(v);break;
      case 'save-lead':{const l=a.leads.find(x=>x.id===v);if(l)await saveFinding(l.title,l.detail,l.ids);break;}
      case 'save-chat':{const m=c.chat.find(x=>x.id===v);if(m?.supported)await saveFinding(m.question,m.text,m.ids);break;}
      case 'prompt':await submitAsk(v);break;
      case 'review':reviewModal();break;
      case 'print':await printReport();break;
      case 'node':state.node=v;state.edgeLimit=50;if(state.view==='network')render();else nav('network');break;
      case 'all-nodes':state.node='';render();break;
      case 'clear-search':state.search='';state.offset=0;render();break;
      case 'page':state.offset=Number(v)||0;render();break;
      case 'more-audit':state.auditLimit+=30;render();break;
      case 'more-edges':state.edgeLimit+=50;render();break;
      case 'more-timeline':state.timelineLimit+=50;render();break;
      case 'more-devices':state.deviceLimit+=50;render();break;
      case 'more-ip':state.ipLimit+=50;render();break;
    }
  }catch(err){fail(err);}
});
document.addEventListener('keydown',event=>{
  if(event.target.closest('.graph-node') && (event.key==='Enter'||event.key===' ')){
    event.preventDefault();event.target.closest('.graph-node').dispatchEvent(new MouseEvent('click',{bubbles:true}));
  }
  if(event.key==='Escape')document.body.classList.remove('menu-open');
});
document.addEventListener('change',event=>{
  if(event.target.id==='switch-case'){
    if(event.target.value==='__new__'){event.target.value=c.id;newCaseModal();}
    else if(!busy)selectCase(event.target.value);
  }
  if(event.target.id==='tower-subject'){state.towerSubject=event.target.value;render();}
});
document.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();
  if(busy)return;
  const submit=form.querySelector('button:not([type="button"])');if(submit)submit.disabled=true;
  try{
    const data=new FormData(form);
    switch(form.dataset.form){
      case 'new-case':{
        if(!canEdit())throw new Error('Your role cannot create cases.');
        const name=String(data.get('name')||'').trim();if(!name)throw new Error('Enter a case name.');
        const item=createCase(name);log(item,'Case created',name);await saveCase(item);cases.push(item);selectCase(item.id);nav('overview');toast('Case created.');break;
      }
      case 'import':await imported(Array.from(form.elements.files.files));break;
      case 'ask':await submitAsk(String(data.get('question')||'').trim());break;
      case 'search':state.search=String(data.get('query')||'').trim();state.offset=0;render();break;
      case 'review':{
        if(!canReview()||!c.findings?.length)throw new Error('A reviewer and at least one finding are required.');
        const reviewer=team()?window.traceSession.username:String(data.get('reviewer')||'').trim();
        if(!reviewer)throw new Error('Enter a reviewer name.');
        await write(item=>{item.review={reviewer,signedAt:new Date().toISOString(),revisionKey:item.contentVersion||0};log(item,'Report signed',reviewer+' approved version '+(item.contentVersion||0));});
        hideModal();toast('Report signed and ready to print.');break;
      }
    }
  }catch(err){fail(err);}finally{if(submit)submit.disabled=false;}
});
window.addEventListener('hashchange',()=>{
  document.body.classList.remove('menu-open');hideModal();render();window.scrollTo(0,0);
});
document.addEventListener('click',e=>{
  if(e.target.closest('.nav-item'))document.body.classList.remove('menu-open');
  else if(document.body.classList.contains('menu-open')&&!e.target.closest('#sidebar,.mobile-menu'))document.body.classList.remove('menu-open');
});
async function initialise(){
  try{
    cases=await listCases();
    if(!cases.length && !team()){
      const sample=await createDemo();log(sample,'Demo case opened',sample.files.length+' synthetic source files loaded.');
      try{await saveCase(sample);cases=[sample];}catch(err){cases=await listCases();if(!cases.length)throw err;}
    }
    selectCase(remembered());
  }catch(err){
    $('#main').innerHTML=`<section class="panel loading"><h1>Workspace could not open</h1><p>${esc(err.message)}</p><button class="button primary" id="retry-open">Try again</button></section>`;
    $('#retry-open').addEventListener('click',()=>location.reload());
  }
}
initialise();
