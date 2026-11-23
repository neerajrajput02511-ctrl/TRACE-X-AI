import {createDemo,createCase,importFile,previewImport,analyze,ask} from './engine.js';
import {api,casePath,jsonRequest,listCases,saveCase} from './storage.js';
import {icon,esc,count,stamp,button,head,rowRefs,empty} from './case-ui.js';
import {sections,shell,overview,sources,network,towers,devices,assistant,reports,reviewed,pageHeader} from './case-views.js';
import {caseProfile,caseDetailsForm,assignmentForm,adminPage,adminUserForm,importPreview,importOptions} from './case-tools.js';
import {sha256,uuid} from './crypto.js';
import {mountSpatial,releaseSpatial} from './spatial.js';
import './register.js';

const $ = selector=>document.querySelector(selector);
const views={overview,sources,network,towers,devices,assistant,reports};
const state={view:'overview',search:'',offset:0,filters:{},serverSearch:null,searchError:'',node:'',towerSubject:'',edgeLimit:50,timelineLimit:50,deviceLimit:50,ipLimit:50,auditLimit:20};
const aliases={graph:'network',evidence:'sources',report:'reports',map:'towers'};
let cases=[], c=null, a=null, busy=false, noteTimer, searchToken=0, searchKey='', pendingFiles=[], adminUsers=null, adminHealth=null, adminError='', adminLoading=false;
const team=()=>window.TRACEX_TEAM===true;
const readOnly=()=>!team()&&(window.TRACEX_READ_ONLY===true||(location.hostname==='appassets.androidplatform.net'&&new URLSearchParams(location.search).get('demo')==='1'));
const admin=()=>team()&&window.traceSession?.role==='admin';
const archive=()=>c?.metadata?.status==='archived';
const canCreate=()=>!readOnly()&&(!team()||['investigator','admin'].includes(window.traceSession?.role));
const canEdit=()=>canCreate()&&!archive();
const canReview=()=>!readOnly()&&!archive()&&(!team()||(['reviewer','admin'].includes(window.traceSession?.role)&&!c?.contributors?.includes(window.traceSession.username)));
const canManage=()=>!!c&&(admin()||(team()&&c.owner===window.traceSession?.username));
const uid=uuid;
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
function getView(){const key=location.hash.slice(1).toLowerCase();return key==='admin'&&admin()?'admin':Object.hasOwn(views,aliases[key]||key)?(aliases[key]||key):'overview';}
function nav(key){if(state.view===key){render();return;}location.hash=key;}
function hideModal(){if($('#case-dialog').open)$('#case-dialog').close();}
function modal(title,content,wide=false){
  const box=$('#case-dialog');box.className=wide?'wide':'';
  box.innerHTML=`<header class="dialog-top"><h2 id="dialog-title">${esc(title)}</h2><button type="button" class="icon-button" aria-label="Close dialog" data-action="close">${icon('close')}</button></header><div class="dialog-body">${content}</div>`;
  if(!box.open)box.showModal();box.scrollTop=0;
}
function selectCase(id){
  c=cases.find(x=>x.id===id)||cases[0];a=c?analyze(c):null;
  searchKey='';searchToken++;
  Object.assign(state,{search:'',offset:0,filters:{},serverSearch:null,searchError:'',node:'',towerSubject:'',edgeLimit:50,timelineLimit:50,deviceLimit:50,ipLimit:50,auditLimit:20,leadLimit:4,networkFrom:'',networkTo:'',towerFrom:'',towerTo:'',pathA:'',pathB:''});
  if(c)remember(c.id);hideModal();render();
}
function accountControls(){
  if(!team() || !window.traceSession)return '';
  return '<div class="team-user">'+icon('user',16)+'<span>'+esc(window.traceSession.username)+' · '+esc(window.traceSession.role)+'</span>'+button('Sign out','logout','','text-button')+'</div>';
}
function render(){
  releaseSpatial();
  state.view=getView();
  state.teamMode=team();state.readOnly=readOnly();
  const adminView=state.view==='admin';
  if(!c){
    $('#sidebar').innerHTML='<a href="./index.html" class="brand">TRACE−X AI</a>'+(admin()?'<div class="nav-area"><a class="nav-item" href="#overview">Case workspace</a><a class="nav-item" href="#admin">Administration</a></div>':'')+accountControls();
    $('#main').innerHTML=adminView?head('Administration','Account and access review for your unit.')+adminBody():head('Case workspace','No case is available for this account.')+(canCreate()?button('Create case','new','','button primary','plus'):'');
    $('#topbar').innerHTML='<div class="crumb">'+button('Menu','menu','','mobile-menu icon-button','menu')+'</div>'+accountControls();
    if(adminView)loadAdmin();
    return;
  }
  const s=shell(state.view,cases,c,!team(),admin(),readOnly());
  $('#sidebar').innerHTML=s.side;
  $('#topbar').innerHTML=s.top;
  $('#main').innerHTML=pageHeader(state.view,c)+(adminView?adminBody():views[state.view](c,a,state))+(state.view==='overview'?caseProfile(c,canManage()):'');
  if(!canEdit()){
    document.querySelectorAll('[data-action="import"],[data-action="save-chat"]').forEach(el=>el.remove());
  }
  if(!canCreate()) $('#switch-case option[value="__new__"]')?.remove();
  if(!canReview()) document.querySelectorAll('[data-action="review"]').forEach(el=>{el.disabled=true;el.title='A reviewer must sign this report.';});
  if(state.view==='reports' && !team()) {
    const review=$('[data-action="review"]');if(review)review.title='Record a local self-review on this device';
  }
  if(team() && window.traceSession){
    const foot=$('.side-foot'); if(foot)foot.insertAdjacentHTML('beforebegin',`${accountControls()}`);
  }
  if(readOnly()) $('#main').insertAdjacentHTML('afterbegin','<p class="demo-notice">Offline synthetic demo · Read-only case records. Questions are cleared when you leave the app.</p>');
  document.title=sections[state.view][0]+' · TRACE-X';
  mountSpatial(c,a,state);
  if(adminView)loadAdmin();
  if(state.view==='sources'&&team())loadRecords();
}
function acceptCase(item) {
  cases=cases.map(value=>value.id===item.id?item:value);
  c=item;a=analyze(item);render();
}
function adminBody(){
  return adminError?empty('Administration unavailable',adminError)+button('Retry','admin-refresh','','button primary'):adminPage(adminUsers,adminHealth,cases);
}
async function loadAdmin(){
  if(adminLoading||adminUsers!==null||adminError)return;
  adminLoading=true;
  try{
    [adminUsers,adminHealth]=await Promise.all([api('./api/admin/users'),api('./api/admin/health')]);
  }catch(error){adminError=error.message;}
  finally{adminLoading=false;if(state.view==='admin')render();}
}
async function loadRecords(){
  const query=new URLSearchParams({q:state.search,offset:String(state.offset),limit:'30'});
  for(const [key,value] of Object.entries(state.filters))if(value)query.set(key,value);
  const key=c.id+'@'+c.revision+'?'+query;
  if(searchKey===key)return;searchKey=key;
  const token=++searchToken;
  state.serverSearch=null;state.searchError='';
  try{
    const result=await api(casePath(c.id,'/records?'+query));
    if(token===searchToken)state.serverSearch=result;
  }catch(error){if(token===searchToken)state.searchError=error.message;}
  finally{if(token===searchToken&&state.view==='sources')render();}
}
function reloadSearch(){
  searchKey='';state.serverSearch=null;state.searchError='';render();
}
async function trackView(action,ref) {
  if(!team())return;
  const id=c?.id;
  try{
    const item=await api(casePath(id,'/activity'),jsonRequest('POST',{action,ref}));
    if(item?.activity?.length&&c?.id===id && item.activity.length>=(c.activity?.length||0))c.activity=item.activity;
  }catch(error){fail(error);}
}
async function write(fn) {
  if(busy) throw new Error('An operation is in progress. Wait for it to finish.');
  busy=true;document.body.classList.add('pending');
  try{
    const item=structuredClone(c);
    const result=await fn(item);
    if(!readOnly())await saveCase(item);
    acceptCase(item);return result;
  }finally{busy=false;document.body.classList.remove('pending');}
}
function newCaseModal(){
  if(!canCreate())throw new Error('Only an investigator or admin can create a case.');
  modal('Create case',`<form data-form="new-case" class="dialog-form"><label for="new-case-name">Case name</label><input id="new-case-name" autofocus name="name" maxlength="80" required placeholder="e.g. Airport liaison"><p>Evidence, questions and findings are kept within this case.</p><div class="form-actions">${button('Cancel','close','','button')}<button class="button primary">Create case</button></div></form>`);
}
function importModal(){
  if(!canEdit())throw new Error('Your role cannot import files.');
  pendingFiles=[];
  const formats=team()?'CSV, TSV, text or XLSX':'CSV, TSV or text';
  modal('Import evidence',`<form data-form="import" class="dialog-form"><p>Choose files to preview their source columns. Use synthetic data in the demo.</p><label class="file-picker" for="evidence-files">${icon('upload',28)}<strong>Select evidence files</strong><span>${formats} · multiple files supported</span><input id="evidence-files" type="file" name="files" accept=".csv,.tsv,.txt${team()?',.xlsx':''}" multiple required></label><details class="example"><summary>Supported header examples</summary><p>CDR</p><code>Calling Number,Called Number,Timestamp,Duration,Cell ID</code><p>IPDR</p><code>Subscriber,Public IP,Source Port,Protocol,Session Start,Session End</code><p>Tower list</p><code>Cell ID,Tower Name,Latitude,Longitude</code></details><div class="form-actions">${button('Cancel','close','','button')}<button class="button primary">Preview mapping</button></div></form>`);
}
function detailsTable(items){return `<dl class="details">${items.map(([label,v])=>`<dt>${esc(label)}</dt><dd>${esc(v??'—')}</dd>`).join('')}</dl>`;}
function showFile(id){
  const f=c.files.find(v=>v.id===id);if(!f)return;
  const qa=f.qa;
  const path=casePath(c.id,'/sources/'+encodeURIComponent(id));
  modal('Source file',`<h3 class="dialog-file">${esc(f.name)}</h3>${detailsTable([['Type',f.type],['SHA-256',f.sha256],['Accepted',qa.accepted],['Duplicates',qa.duplicate],['Rejected',qa.rejected]])}
    <div class="section-actions">${button('Verify SHA-256','verify-file',id,'button small','check')}${team()?`<a class="button small" download href="${esc(path)}">Download original</a>`:button('Download original','local-file',id,'button small')}</div><p id="verify-result" role="status"></p>
    ${qa.issues?.length?`<h3>Quality checks</h3><ul class="qa-list">${qa.issues.slice(0,100).map(x=>`<li>Line ${esc(x.line)} · ${esc(x.message)}</li>`).join('')}</ul>`:''}${qa.issues?.length>100?`<p>Showing 100 of ${count(qa.issues.length)} quality messages.</p>`:''}
    ${f.raw!=null?`<details class="example"><summary>${f.sheet?'Worksheet text preview':'Original file preview'}</summary><pre>${esc(String(f.raw).slice(0,12000))}</pre>${f.raw.length>12000?'<p>Preview limited to 12,000 characters. The original file remains in the case.</p>':''}</details>`:''}`,true);
  void trackView('Source viewed',id);
}
function showRow(id){
  const r=c.records.find(x=>x.id===id);if(!r)return;
  modal('Source record '+id,`<div class="record-title"><span class="sample-tag">${esc(r.kind)}</span><strong>${stamp(r.time)} IST</strong></div>${detailsTable([['Party',r.from],...(r.to?[['Counterparty',r.to]]:[]),...(r.kind==='CDR'?[['Duration',r.duration==null?'Unknown':r.duration+' seconds']]:[['Public IP',r.ip],['Source port',r.port||'Missing'],['Protocol',r.protocol||'Missing'],['Destination IP',r.destinationIp||'Unknown'],['Destination port',r.destinationPort||'Unknown'],['End of session',r.end?stamp(r.end)+' IST':'Missing']]),...(r.cell?[['Cell',r.cell]]:[])])}<h3>Original source rows</h3>${(r.refs||[]).map(ref=>{
    const f=c.files.find(x=>x.id===ref.fileId), sheet=ref.sheet||f?.sheet;return `<div class="raw-row"><div><strong>${esc(f?.name||ref.fileId)}</strong><span>${sheet?esc(sheet)+' · ':''}Row ${esc(ref.line)}</span></div><pre>${esc(ref.raw)}</pre>${f?button('View file & fingerprint','file',f.id,'text-button'):''}</div>`;
  }).join('')}`,true);
  void trackView('Record viewed',id);
}
async function verifyFile(id){
  const f=c.files.find(v=>v.id===id);if(!f)return;
  const output=$('#verify-result');output.textContent='Checking original bytes…';
  try{
    const result=team()?await api(casePath(c.id,'/sources/'+encodeURIComponent(id)+'/verify'),jsonRequest('POST',{})):
      {ok:await sha256(new TextEncoder().encode(f.raw||''))===f.sha256};
    output.textContent=result.ok?'Verified. The original matches its recorded SHA-256.':'Integrity check failed. The current bytes differ from the recorded SHA-256.';
    output.className=result.ok?'integrity-pass':'field-error';
  }catch(error){output.textContent=error.message;output.className='field-error';}
}
function localFile(id){
  const f=c.files.find(v=>v.id===id);if(!f)return;
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([f.raw],{type:'text/plain;charset=utf-8'}));
  link.download=f.name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1500);
}
function showRows(ids){
  const set=new Set(ids), rows=c.records.filter(r=>set.has(r.id));
  modal('Cited source rows',rows.length?`<div class="file-list">${rows.map(r=>`<button class="file-entry" data-action="row" data-value="${esc(r.id)}"><span class="file-icon">${icon('file',17)}</span><span class="file-entry-name"><strong>${esc(r.id)} · ${esc(r.from)} ${r.to?' / '+esc(r.to):''}</strong><small>${stamp(r.time)} IST</small></span><span class="file-link">Open row</span></button>`).join('')}</div>`:empty('No matching rows','This case has no source rows for this selection.'),true);
}
function showLead(id){
  const l=a.leads.find(x=>x.id===id);if(!l)return;
  const statuses={new:'New',in_review:'In review',cleared:'Cleared',dismissed:'Dismissed'};
  const tracking=c.leadStates?.[id]||{status:'new',reviewer:''};
  const reviewers=(c.assignments||[]).filter(u=>u.role==='reviewer');
  const tracked=team()&&!archive()?`<form class="dialog-form lead-form" data-form="lead-state"><input type="hidden" name="leadId" value="${esc(id)}"><label>Lead status<select name="status">${Object.entries(statuses).map(([status,label])=>`<option value="${status}" ${tracking.status===status?'selected':''}>${label}</option>`).join('')}</select></label><label>Assigned reviewer<select name="reviewer"><option value="">Unassigned</option>${reviewers.map(u=>`<option ${tracking.reviewer===u.username?'selected':''} value="${esc(u.username)}">${esc(u.username)}</option>`).join('')}</select></label><button class="button">Update lead</button></form>`:'';
  modal('Case lead',`<h3>${esc(l.title)}</h3><p>${esc(l.detail)}</p><p class="lead-caption">Analytical lead. Review the underlying records and any missing fields before interpreting this pattern.</p><h4>Cited records</h4>${rowRefs(l.ids)}${tracked}<div class="form-actions">${canEdit()?button('Save finding','save-lead',l.id,'button primary','bookmark'):''}</div>`);
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
  if(archive())throw new Error('Reopen this case to ask new questions.');
  await write(async item=>{
    const answer=ask(item,question);
    if(!answer.supported) {
      try {
        const {routeQuestion}=await import('./query-router.js');
        answer.suggestion=await routeQuestion(item,question);
      } catch {answer.suggestion=null;}
    }
    (item.chat||=[]).push({id:uid(),question,...answer,time:new Date().toISOString()});
    if(!readOnly())log(item,'Assistant query',question);
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
async function upload(file,options,preview=false){
  const data=new FormData();data.set('file',file);data.set('options',JSON.stringify(options));
  if(preview)data.set('preview','true');
  return api(casePath(c.id,'/uploads'),{method:'POST',body:data});
}
async function previewFiles(files){
  if(!canEdit())throw new Error('Your role cannot import files.');
  if(!files.length)throw new Error('Choose at least one file.');
  busy=true;
  try {
    modal('Preparing file preview','<p class="loading">Reading source columns…</p>');
    pendingFiles=await Promise.all(files.map(async file=>{
      try{
        if(file.size>10*1024*1024)throw new Error('Choose a file under 10 MB.');
        if(!/\.(csv|tsv|txt|xlsx)$/i.test(file.name))throw new Error('Choose a supported evidence file.');
        const preview=team()?await upload(file,{revision:c.revision},true):await previewImport(file);
        return {file,preview};
      }catch(error){return {file,error:error.message};}
    }));
    modal('Confirm source mapping',importPreview(pendingFiles),true);
  } finally {busy=false;}
}
async function confirmImport(data){
  if(!canEdit())throw new Error('Your role cannot import files.');
  const batch=pendingFiles.flatMap((entry,index)=>entry.preview?[{file:entry.file,options:importOptions(data,entry,index,c.revision)}]:[]);
  const outcomes=[];
  if(team()){
    busy=true;
    try{
      for(const entry of batch) {
        try{
          const item=await upload(entry.file,{...entry.options,revision:c.revision});
          outcomes.push({name:entry.file.name,qa:item.uploadQa});
          acceptCase(item);
        }catch(error){outcomes.push({name:entry.file.name,error:error.message});}
      }
    }finally{busy=false;}
  } else await write(async item=>{
    let changed=false;
    for(const {file:f,options} of batch){
      try{
        const before=item.files.length;
        const qa=await importFile(item,f.name,f,options);
        outcomes.push({name:f.name,qa});
        if(item.files.length!==before){changed=true;log(item,'Evidence imported',f.name+' · '+qa.accepted+' accepted, '+qa.duplicate+' duplicates, '+qa.rejected+' rejected');}
      }catch(err){outcomes.push({name:f.name,error:err.message});}
    }
    if(changed)dirty(item);
  });
  pendingFiles=[];
  modal('Import results',`<div class="import-results">${outcomes.map(o=>`<article><h3>${esc(o.name)}</h3><p>${o.error?esc(o.error):`${count(o.qa?.accepted)} accepted · ${count(o.qa?.duplicate)} duplicates · ${count(o.qa?.rejected)} rejected`}</p>${o.qa?.issues?.length?`<details class="example"><summary>Row-level quality checks</summary><ul>${o.qa.issues.slice(0,75).map(issue=>`<li>Row ${esc(issue.line)} · ${esc(issue.message)}</li>`).join('')}</ul>${o.qa.issues.length>75?'<p>Additional messages are available from the imported source.</p>':''}</details>`:''}</article>`).join('')}</div><div class="form-actions">${button('Open evidence library','finish-import','','button primary')}</div>`);
}
document.addEventListener('click',async event=>{
  const btn=event.target.closest('[data-action]');if(!btn)return;
  const action=btn.dataset.action,v=btn.dataset.value || '';
  if(busy){toast('Saving the current action…');return;}
  try{
    switch(action){
      case 'logout':{
        await api('./api/logout',jsonRequest('POST',{}));
        window.location.replace('./login.html');break;
      }
      case 'menu':{const open=document.body.classList.toggle('menu-open');btn.setAttribute('aria-expanded',String(open));break;}
      case 'close':hideModal();break;
      case 'nav':nav(v);break;
      case 'new':newCaseModal();break;
      case 'open-case':selectCase(v);nav('overview');break;
      case 'edit-case':if(canManage())modal('Edit case details',caseDetailsForm(c));break;
      case 'reopen-case':if(canManage()){
        acceptCase(await api(casePath(c.id,'/details'),jsonRequest('PATCH',{status:'open'})));
        toast('Case reopened.');
      }break;
      case 'assign-case':if(canManage()){
        const id=c.id;
        const users=await api(casePath(id,'/assignment-candidates'));
        if(c.id===id)modal('Manage case access',assignmentForm(c,users));
      }break;
      case 'admin-add':if(admin())modal('Add unit account',adminUserForm(null));break;
      case 'admin-edit':if(admin())modal('Manage unit account',adminUserForm(adminUsers.find(u=>u.username===v)));break;
      case 'admin-refresh':adminUsers=null;adminError='';render();break;
      case 'refresh-case':{const id=c?.id;cases=await listCases();selectCase(id);break;}
      case 'import':importModal();break;
      case 'finish-import':hideModal();nav('sources');break;
      case 'file':showFile(v);break;
      case 'verify-file':await verifyFile(v);break;
      case 'local-file':localFile(v);break;
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
      case 'clear-search':state.search='';state.offset=0;state.filters={};reloadSearch();break;
      case 'refresh-search':reloadSearch();break;
      case 'page':state.offset=Number(v)||0;reloadSearch();break;
      case 'more-audit':state.auditLimit+=30;render();break;
      case 'more-edges':state.edgeLimit+=50;render();break;
      case 'more-timeline':state.timelineLimit+=50;render();break;
      case 'more-devices':state.deviceLimit+=50;render();break;
      case 'more-ip':state.ipLimit+=50;render();break;
      case 'more-leads':state.leadLimit+=20;render();break;
      case 'clear-range':{
        const key=v==='graph-range'?'network':'tower';state[key+'From']='';state[key+'To']='';render();break;
      }
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
        if(!canCreate())throw new Error('Your role cannot create cases.');
        const name=String(data.get('name')||'').trim();if(!name)throw new Error('Enter a case name.');
        const item=createCase(name);log(item,'Case created',name);await saveCase(item);cases.push(item);selectCase(item.id);nav('overview');toast('Case created.');break;
      }
      case 'case-details':{
        if(!canManage())throw new Error('You cannot edit this case.');
        await updateCase('/details','PATCH',Object.fromEntries(data),'Case details saved.');break;
      }
      case 'case-assignment':{
        if(!canManage())throw new Error('You cannot assign this case.');
        await updateCase('/assignments','PUT',{usernames:data.getAll('usernames')},'Case access updated.');break;
      }
      case 'lead-state':{
        if(!team()||archive())throw new Error('This lead cannot be edited.');
        await updateCase('/leads/'+encodeURIComponent(String(data.get('leadId'))),'PATCH',{status:data.get('status'),reviewer:data.get('reviewer')},'Lead status saved.');break;
      }
      case 'admin-user':{
        if(!admin())throw new Error('Administrator access is required.');
        const user=String(data.get('username'));
        const editing=form.elements.username.readOnly;
        const payload=editing?{active:data.has('active'),role:data.get('role')}:{username:user,role:data.get('role'),password:data.get('password')};
        await api('./api/admin/users'+(editing?'/'+encodeURIComponent(user):''),jsonRequest(editing?'PATCH':'POST',payload));
        hideModal();adminUsers=null;adminError='';render();toast(editing?'Account updated.':'Account created.');break;
      }
      case 'import':await previewFiles(Array.from(form.elements.files.files));break;
      case 'confirm-import':await confirmImport(data);break;
      case 'ask':await submitAsk(String(data.get('question')||'').trim());break;
      case 'search':
        state.search=String(data.get('query')||'').trim();state.offset=0;
        state.filters=Object.fromEntries([...data].filter(([key])=>key!=='query').map(([key,value])=>[key,String(value).trim()]));
        reloadSearch();break;
      case 'graph-range':
      case 'tower-range':{
        const start=String(data.get('start')),end=String(data.get('end'));
        if(start&&end&&start>end)throw new Error('The end date must be on or after the start date.');
        const key=form.dataset.form==='graph-range'?'network':'tower';
        state[key+'From']=start;state[key+'To']=end;render();break;
      }
      case 'common-path':
        if(data.get('left')===data.get('right'))throw new Error('Select two different parties.');
        state.pathA=String(data.get('left'));state.pathB=String(data.get('right'));render();break;
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
async function updateCase(path,method,data,message){
  const id=c.id;const item=await api(casePath(id,path),jsonRequest(method,data));
  if(c.id===id){acceptCase(item);hideModal();}toast(message);
}
window.addEventListener('hashchange',()=>{
  document.body.classList.remove('menu-open');hideModal();render();window.scrollTo(0,0);
});
document.addEventListener('click',e=>{
  if(e.target.closest('.nav-item'))document.body.classList.remove('menu-open');
  else if(document.body.classList.contains('menu-open')&&!e.target.closest('#sidebar,.mobile-menu'))document.body.classList.remove('menu-open');
});
async function initialise(){
  try{
    if(readOnly()){cases=[await createDemo()];selectCase(cases[0].id);return;}
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
