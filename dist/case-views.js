import {icon,esc,count,stamp,button,head,rowRefs,empty,graph,towerPlot} from './case-ui.js';
import {analyze} from './engine.js';
export const sections = {
  overview:['Case overview','overview','A working view of the evidence, connections and leads in this case.'],
  sources:['Evidence library','evidence','Inspect source files, import quality and original records.'],
  network:['Link analysis','network','Explore recorded connections and the rows behind each relationship.'],
  towers:['Tower timeline','towers','Inspect tower observations by time and party. All times are IST.'],
  devices:['Devices & IP sessions','devices','Review recorded device identifiers and IP session metadata.'],
  assistant:['Case assistant','assistant','Ask about the open case and inspect the evidence behind each answer.'],
  reports:['Reports & audit','reports','Review saved findings and approve the report before export.'],
  admin:['Administration','lock','Manage unit accounts and review access to active cases.']
};
export function shell(view, cases, c, local=true, admin=false, readOnly=false) {
  const section=(key,label,items)=>`<div class="nav-group"><p>${label}</p>${items.map(id=>`<a href="#${id}" class="nav-item ${view===id?'selected':''}" ${view===id?'aria-current="page"':''}>${icon(sections[id][1],18)}<span>${sections[id][0]}</span></a>`).join('')}</div>`;
  return {
    side:`<a href="./index.html" class="brand"><span class="brandmark">${icon('logo',30)}</span><span>TRACE<span class="brand-x">−X</span> AI</span></a><div class="nav-area">${section('case','WORKSPACE',['overview','sources','network','towers','devices'])}${section('tools','INVESTIGATION',['assistant','reports'])}${admin?section('admin','ADMIN',['admin']):''}</div><div class="side-foot">${icon(local?'database':'lock',17)}<span>${readOnly?'Offline synthetic demo':local?'Device workspace':'Shared workspace'}</span><a href="./index.html">Website</a></div>`,
    top:`<div class="crumb"><button class="mobile-menu icon-button" data-action="menu" aria-label="Toggle navigation" aria-expanded="false">${icon('menu')}</button><span class="crumb-icon">${icon('case',17)}</span><span>Workspace</span><i>/</i><strong>${esc(sections[view][0])}</strong></div><div class="case-control"><label for="switch-case">Active case</label><span class="select-wrap"><select id="switch-case" aria-label="Switch active case">${cases.map(x=>`<option value="${esc(x.id)}" ${x.id===c.id?'selected':''}>${esc(x.name)}</option>`).join('')}<option value="__new__">+ Create case</option></select>${icon('chevron',16)}</span></div>`
  };
}
function metric(label,value,sub,ico,cls='') {
  return `<div class="metric"><div class="metric-label">${esc(label)}${icon(ico,17)}</div><strong class="${cls}">${count(value)}</strong><span>${esc(sub)}</span></div>`;
}
function caseTags(c) {
  return `<div class="case-meta"><span class="case-id">${esc(c.id)}</span><i></i><span>${esc(c.name)}</span>${c.synthetic||(!window.TRACEX_TEAM&&c.id==='CASE-RJ-001')?'<span class="sample-tag">Synthetic case</span>':''}${c.metadata?.status==='archived'?'<span class="sample-tag">Archived</span>':''}</div>`;
}
function fileList(c,limit=Infinity) {
  return c.files.length?`<div class="file-list">${c.files.slice(-limit).reverse().map(f=>`<button class="file-entry" data-action="file" data-value="${esc(f.id)}"><span class="file-icon">${icon('file',19)}</span><span class="file-entry-name"><strong>${esc(f.name)}</strong><small>${esc(f.type)} · ${count(f.qa.accepted)} accepted · ${count(f.qa.duplicate)} duplicates</small></span><span class="file-link">Inspect</span></button>`).join('')}</div>`:empty('No source files','Import CDR, IPDR or tower CSV files to start the case.');
}
function recordTable(rows) {
  if(!rows.length) return empty('No matching records','Import records or choose a different filter.');
  return `<div class="table-scroll"><table><thead><tr><th>Record</th><th>Type</th><th>Party</th><th>Counterparty / IP</th><th>Time · IST</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${button(r.id,'row',r.id,'cite')}</td><td>${esc(r.kind)}</td><td>${esc(r.from||'—')}</td><td>${esc(r.to||r.ip||'—')}</td><td>${esc(stamp(r.time,true))}</td></tr>`).join('')}</tbody></table></div>`;
}
function leadList(c,a,limit) {
  const statuses={new:'New',in_review:'In review',cleared:'Cleared',dismissed:'Dismissed'};
  return a.leads.length?`<div class="lead-list">${a.leads.slice(0,limit).map(l=>{
    const tracked=c.leadStates?.[l.id];
    const details=`${count(l.ids.length)} source record${l.ids.length===1?'':'s'}${tracked?' · '+esc(statuses[tracked.status]||'New')+(tracked.reviewer?' · '+esc(tracked.reviewer):''):''}`;
    return `<button data-action="lead" data-value="${esc(l.id)}"><span class="lead-pin">${icon('network',17)}</span><span><strong>${esc(l.title)}</strong><small>${details}</small></span><span class="lead-view">View</span></button>`;
  }).join('')}</div>`:empty('No leads yet','Leads appear when the case records support a relationship or pattern.');
}
function callActivity(a) {
  if(!a.callStats?.days.length)return '';
  const {duration,durationIds,nightIds,days}=a.callStats;
  return `<section class="panel gap">${head('Call activity','Daily volume and duration computed from normalized call records.')}<ul class="stats-list">
      <li><span><strong>Total recorded duration</strong><br><small>${count(duration)} seconds</small></span>${durationIds.length?button('Inspect duration rows','rows',JSON.stringify(durationIds),'cite'):''}</li>
      <li><span><strong>Night-time calls</strong><br><small>${count(nightIds.length)} records · 22:00–05:59 IST</small></span>${nightIds.length?button('Inspect night rows','rows',JSON.stringify(nightIds),'cite'):''}</li>
    </ul><div class="table-scroll"><table><thead><tr><th>Date (IST)</th><th>Calls</th><th>Duration (s)</th><th>Source</th></tr></thead><tbody>${days.slice(-30).reverse().map(day=>`<tr><td>${esc(day.date)}</td><td>${count(day.count)}</td><td>${count(day.duration)}</td><td>${button('Inspect rows','rows',JSON.stringify(day.ids),'cite')}</td></tr>`).join('')}</tbody></table></div></section>`;
}
export function overview(c,a,state) {
  return `<div class="metrics">${metric('Total records',a.total,`${a.cdrCount} CDR / ${a.ipdrCount} IPDR`,'database')}${metric('Contact parties',a.contacts,`${a.edges.length} recorded links`,'network')}${metric('Source files',c.files.length,'SHA-256 fingerprinted','evidence')}${metric('Analytical leads',a.leads.length,'Available for review','pulse','orange')}</div><div class="overview-grid"><section class="panel net-panel">${head('Contact network','Observed links in the call records.',button('Explore','nav','network','text-button'))}${graph(a)}<div class="graph-foot"><span><i class="dot-orange"></i>Focus party</span><span><i class="dot-blue"></i>Contact</span><small>Select a node to inspect</small></div></section><section class="panel lead-panel">${head('Case leads', 'Patterns linked to original records.')}${leadList(c,a,state.leadLimit||4)}${a.leads.length>(state.leadLimit||4)?`<div class="paginator">${button('Show more leads','more-leads','','button small')}</div>`:''}<div class="ask-shortcut"><span class="assistant-icon">${icon('assistant',18)}</span><div><strong>Case assistant</strong><p>Ask a question about these records.</p></div>${button('Ask','nav','assistant','text-button')}</div></section><section class="panel recent-panel">${head('Source files','Original imports and validation results.',button('View library','nav','sources','text-button'))}${fileList(c,3)}</section><section class="panel">${head('Recent activity','Latest actions in this workspace.')}${auditList(c,3)}</section></div>${callActivity(a)}`;
}
export function sources(c,a,state) {
  const filter=state.search.trim().toLowerCase();
  const localRows=state.teamMode?[]:c.records.filter(r=>[r.id,r.kind,r.from,r.to,r.cell,r.ip,r.imei,r.imsi].some(v=>String(v||'').toLowerCase().includes(filter)));
  const result=state.teamMode?state.serverSearch:{rows:localRows.slice(state.offset,state.offset+30),total:localRows.length};
  const fields=[['number','Party'],['from','From date (IST)','date'],['to','To date (IST)','date'],['operator','Source filename / operator'],['imei','IMEI'],['tower','Cell ID'],['ip','IP address'],['protocol','Protocol'],['session','Session']];
  const f=state.filters||{};
  const advanced=state.teamMode?`<details class="filter-details" ${Object.values(f).some(Boolean)?'open':''}><summary>More filters</summary><div class="filter-grid">${fields.map(([key,label,type])=>`<label>${label}<input name="${key}" type="${type||'text'}" value="${esc(f[key]||'')}" maxlength="128"></label>`).join('')}<label>Record kind<select name="kind" aria-label="Record kind"><option value="">All records</option><option ${f.kind==='CDR'?'selected':''}>CDR</option><option ${f.kind==='IPDR'?'selected':''}>IPDR</option></select></label><label>Sort by time<select name="sort" aria-label="Sort by time"><option value="">Newest first</option><option value="oldest" ${f.sort==='oldest'?'selected':''}>Oldest first</option></select></label></div></details>`:'';
  return `<section class="panel">${head('Imported files','Select a file to view its hash and row-level quality checks.')}${fileList(c)}</section><section class="panel gap">${head('Normalized records','Select a record ID to open its original source rows.')}<form data-form="search" class="search-line"><label for="row-search">Search records</label><input id="row-search" name="query" type="search" value="${esc(state.search)}" placeholder="Record ID, party, cell or IP"><button class="button">Search</button>${filter||Object.values(f).some(Boolean)?button('Clear','clear-search','','text-button'):''}${advanced}</form>${state.searchError?empty('Search unavailable',state.searchError)+button('Retry','refresh-search','','button small'):!result?empty('Loading records','Reading the case index.'):`${recordTable(result.rows)}<div class="paginator"><span>${result.total?`${state.offset+1}–${Math.min(result.total,state.offset+30)} of `:''}${count(result.total)} records</span><div>${state.offset>0?button('Previous','page',Math.max(0,state.offset-30),'button small'):''}${result.total>state.offset+30?button('Next','page',state.offset+30,'button small'):''}</div></div>`}</section>`;
}
function inRange(time,from,to){
  const ist=new Date(Date.parse(time)+330*60000).toISOString().slice(0,10);
  return (!from||ist>=from)&&(!to||ist<=to);
}
function rangeForm(form,start,end) {
  return `<form class="range-form" data-form="${form}"><label>From date (IST)<input name="start" type="date" value="${esc(start||'')}"></label><label>To date (IST)<input name="end" type="date" value="${esc(end||'')}"></label><button class="button small">Apply dates</button>${start||end?button('Clear dates','clear-range',form,'text-button'):''}</form>`;
}
function commonPath(filtered,state) {
  const selectedA=state.pathA||'',selectedB=state.pathB||'';
  const byId=new Map();
  for(const e of filtered.edges){
    if(e.source!==selectedA&&e.target!==selectedA)continue;
    byId.set(e.source===selectedA?e.target:e.source,e);
  }
  const paths=filtered.edges.filter(e=>e.source===selectedB||e.target===selectedB)
    .map(right=>{const via=right.source===selectedB?right.target:right.source;return {via,right,left:byId.get(via)};})
    .filter(p=>p.left&&p.via!==selectedA&&p.via!==selectedB)
    .sort((x,y)=>y.left.count+y.right.count-x.left.count-x.right.count);
  const choices=id=>'<option value="">Choose a party</option>'+filtered.nodes.slice(0,160).map(n=>`<option value="${esc(n.id)}" ${id===n.id?'selected':''}>${esc(n.id)}</option>`).join('');
  return `<section class="panel gap">${head('Shared contacts','Compare two parties using only the selected dates. Find contacts that appear in both call histories.')}<form class="range-form" data-form="common-path"><label>First party<select name="left" aria-label="First party" required>${choices(selectedA)}</select></label><label>Second party<select name="right" aria-label="Second party" required>${choices(selectedB)}</select></label><button class="button small">Find shared contacts</button></form>
    ${selectedA&&selectedB?(paths.length?`<ul class="stats-list">${paths.slice(0,50).map(p=>`<li><div><strong>${esc(selectedA)} · ${esc(p.via)} · ${esc(selectedB)}</strong><br><small>${count(p.left.count)} and ${count(p.right.count)} recorded calls</small></div>${button('Inspect source rows','rows',JSON.stringify([...p.left.ids,...p.right.ids]),'cite')}</li>`).join('')}</ul>`:empty('No shared contacts','The available rows do not show a common contact for these two parties.')):''}
  </section>`;
}
export function network(c,a,state) {
  const filtered=state.networkFrom||state.networkTo?analyze({...c,records:c.records.filter(r=>inRange(r.time,state.networkFrom,state.networkTo))}):a;
  const selected=filtered.nodes.find(n=>n.id===state.node);
  const edges=filtered.edges.filter(e=>!selected||e.source===selected.id||e.target===selected.id).sort((x,y)=>y.count-x.count);
  return `<section class="panel">${head('Contact network','Select a node to inspect its recorded links.')}${rangeForm('graph-range',state.networkFrom,state.networkTo)}${graph(filtered,state.node)}<div class="graph-foot"><span><i class="dot-orange"></i>Focus party</span><span><i class="dot-blue"></i>Contact</span><small>Up to 10 visible parties</small></div></section><section class="panel gap">${head(selected?'Connections for '+selected.id:'Recorded connections','Forward calls go from the first party to the second.',selected?button('All connections','all-nodes','','text-button'):'')}<div class="table-scroll"><table><thead><tr><th>First party</th><th>Second party</th><th>Forward</th><th>Reverse</th><th>Duration (s)</th><th>Evidence</th></tr></thead><tbody>${edges.slice(0,state.edgeLimit).map(e=>`<tr><td>${esc(e.source)}</td><td>${esc(e.target)}</td><td>${count(e.forward)}</td><td>${count(e.reverse)}</td><td>${count(e.seconds)}</td><td>${button('Inspect rows','rows',JSON.stringify(e.ids),'cite')}</td></tr>`).join('')}</tbody></table></div>${!edges.length?empty('No connections','No call records match the selected dates.'):''}${edges.length>state.edgeLimit?`<div class="paginator">${button('Show more connections','more-edges','','button small')}</div>`:''}</section>${commonPath(filtered,state)}`;
}
export function towers(c,a,state) {
  const parties=[...new Set(a.timeline.map(e=>e.subject).filter(Boolean))];
  const timeline=a.timeline.filter(e=>(!state.towerSubject||e.subject===state.towerSubject)&&inRange(e.time,state.towerFrom,state.towerTo));
  return `<section class="panel">${head('Tower observations','Markers show recorded cell sites. A device location is approximate.')}${rangeForm('tower-range',state.towerFrom,state.towerTo)}<div class="select-line"><label for="tower-subject">Party</label><select id="tower-subject"><option value="">All parties</option>${parties.map(p=>`<option ${p===state.towerSubject?'selected':''}>${esc(p)}</option>`).join('')}</select></div>${towerPlot(timeline)}</section><section class="panel gap">${head('Observation timeline','Chronological records for the selected party and dates.')}${timeline.length?`<div class="table-scroll"><table><thead><tr><th>Time · IST</th><th>Party</th><th>Tower / cell</th><th>Source</th></tr></thead><tbody>${timeline.slice(0,state.timelineLimit).map(e=>`<tr><td>${stamp(e.time)}</td><td>${esc(e.subject)}</td><td><strong>${esc(e.name || e.cell)}</strong><small>${esc(e.cell)}${e.lat==null?' · Coordinates unavailable':''}</small></td><td>${button(e.recordId,'row',e.recordId,'cite')}</td></tr>`).join('')}</tbody></table></div>`:empty('No tower observations','No cell observations match the filters in this case.')}${timeline.length>state.timelineLimit?`<div class="paginator">${button('Show more observations','more-timeline','','button small')}</div>`:''}</section>`;
}
export function devices(c,a,state) {
  const sessions=c.records.filter(r=>r.kind==='IPDR');
  const pairs=a.devices, sessionsByIP=new Map();
  for(const r of sessions){
    if(!sessionsByIP.has(r.ip))sessionsByIP.set(r.ip,new Set());
    sessionsByIP.get(r.ip).add(r.from);
  }
  const observations=pairs.length?`<div class="table-scroll"><table><thead><tr><th>Party</th><th>IMEI / device</th><th>IMSI / SIM</th><th>Observed · IST</th><th>Source</th></tr></thead><tbody>${pairs.slice(0,state.deviceLimit).map(d=>`<tr><td>${esc(d.subject)}</td><td>${esc(d.imei||'—')}</td><td>${esc(d.imsi||'—')}</td><td>${stamp(d.time,true)}</td><td>${button(d.recordId,'row',d.recordId,'cite')}</td></tr>`).join('')}</tbody></table></div>`:empty('No device observations','Import records with an IMEI or IMSI field.');
  const changes=(a.changes||[]).length?`<ul class="stats-list">${a.changes.slice(0,40).map(d=>`<li><div><strong>${esc(d.subject)} · ${esc(d.field.toUpperCase())}</strong><br><small>${esc(d.before)} → ${esc(d.after)} · ${stamp(d.time)} IST</small></div>${button('Inspect change','rows',JSON.stringify(d.ids),'cite')}</li>`).join('')}</ul>`:empty('No device changes','The current records have no comparable changes.');
  const sharing=(a.sharedDevices||[]).length?`<ul class="stats-list">${a.sharedDevices.slice(0,40).map(d=>`<li><div><strong>${esc(d.imei)}</strong><br><small>${esc(d.subjects.join(', '))}</small></div>${button('Inspect shared device','rows',JSON.stringify(d.ids),'cite')}</li>`).join('')}</ul>`:empty('No shared devices','No device identifier is recorded for multiple parties.');
  const ip=sessions.length?`<div class="table-scroll"><table><thead><tr><th>Observed · IST</th><th>Subscriber</th><th>Public source</th><th>Destination</th><th>Protocol</th><th>Data quality</th><th>Source</th></tr></thead><tbody>${sessions.slice(0,state.ipLimit).map(r=>{
    const gaps=[sessionsByIP.get(r.ip).size>1?'Shared IP / possible CGNAT':'',!r.port?'Source port missing':'',!r.end?'Session end missing':'',!r.protocol?'Protocol missing':''].filter(Boolean);
    return `<tr><td>${stamp(r.time,true)}${r.end?`<small>Ends ${stamp(r.end,true)}</small>`:''}</td><td>${esc(r.from||'—')}</td><td>${esc(r.ip||'Unknown')}${r.port?' : '+esc(r.port):''}</td><td>${esc(r.destinationIp||'Unknown')}${r.destinationPort?' : '+esc(r.destinationPort):''}</td><td>${esc(r.protocol||'Unknown')}</td><td>${gaps.length?gaps.map(g=>`<small>${esc(g)}</small>`).join(''):'Inspect source row'}</td><td>${button(r.id,'row',r.id,'cite')}</td></tr>`;
  }).join('')}</tbody></table></div>`:empty('No IP sessions','Import an IPDR file to inspect available session metadata.');
  return `<section class="panel">${head('Device observations','Recorded IMEI and SIM identifiers for each party.')}${observations}${pairs.length>state.deviceLimit?button('Show more devices','more-devices','','button small'):''}</section><section class="panel gap">${head('Identifier changes','Changes are observations from pairs of records.')}${changes}</section><section class="panel gap">${head('Shared devices','IMEI associations observed for more than one party.')}${sharing}</section><section class="panel gap">${head('IP sessions','Public addresses can be shared. Examine time, port and protocol together.')}${ip}${sessions.length>state.ipLimit?button('Show more sessions','more-ip','','button small'):''}</section>`;
}
export const promptsDemo=['Which contacts do A and B share?','Did A call B directly?','Show tower timeline for A','Show device changes for A','Who are the most frequent contacts?'];
export function assistant(c,a,state) {
  const history=c.chat||[];
  const prompts = c.subjects?.length>=2 ? [`Which contacts do ${c.subjects[0]} and ${c.subjects[1]} share?`,`Did ${c.subjects[0]} call ${c.subjects[1]} directly?`,`Show tower timeline for ${c.subjects[0]}`,'Who are the most frequent contacts?'] : ['Who are the most frequent contacts?',...a.nodes.slice(0,1).map(n=>'Show tower timeline for '+n.id)];
  if(a.ipdrCount)prompts.push('What IPDR matches have missing port information?');
  if(a.cdrCount)prompts.push('Show night calls');
  return `<div class="assistant-layout"><section class="panel chat"><div class="assistant-head"><span class="assistant-symbol">${icon('assistant',25)}</span><div><h2>Evidence-linked assistant</h2><p>Deterministic case queries · source-cited answers</p></div></div><div class="chat-thread">${history.length?history.slice(-20).map((item,i)=>`<article class="exchange"><div class="user-question"><small>QUESTION</small><p>${esc(item.question)}</p></div><div class="answer"><small>${item.supported?'EVIDENCE-LINKED ANSWER':'INSUFFICIENT EVIDENCE'}</small><p>${esc(item.text)}</p>${rowRefs(item.ids)}${item.suggestion?('<div class="suggestion"><p>Did you mean this question?</p>'+button(item.suggestion,'prompt',item.suggestion,'prompt')+'</div>'):''}${item.supported&&item.ids?.length?button('Save finding','save-chat',item.id,'text-button','bookmark'):''}</div></article>`).join(''):`<div class="chat-intro">${icon('network',34)}<h3>What do the records show?</h3><p>Ask about shared contacts, device changes or tower observations in ${esc(c.name)}.</p></div>`}</div><form data-form="ask" class="ask-form"><label for="case-question">Ask a case question</label><div><input id="case-question" name="question" required maxlength="400" autocomplete="off" placeholder="Ask about these records…"><button class="button primary">${icon('send',16)}Ask</button></div></form></section><section class="panel suggested">${head('Suggested questions','Run a question against this case.')}<div>${prompts.map(p=>button(p,'prompt',p,'prompt')).join('')}</div></section></div>`;
}
export function auditList(c,limit) {
  const list=[...(c.audit||[]),...(c.activity||[])].sort((a,b)=>String(b.time).localeCompare(String(a.time))).slice(0,limit);
  return list.length?`<ol class="activity">${list.map(e=>`<li><i></i><div><strong>${esc(e.action)}</strong><p>${esc(e.detail||e.ref||'')}${e.actor?' · '+esc(e.actor):''}</p><time>${stamp(e.time)}</time></div></li>`).join('')}</ol>`:empty('No activity yet','Case actions will appear here.');
}
export function reviewed(c){return !!c.review && c.review.revisionKey===(c.contentVersion||0);}
export function reports(c,a,state) {
  const findings=c.findings||[], signed=reviewed(c);
  const action=state.readOnly?'':signed?(state.teamMode?`<a class="button primary" download href="./api/cases/${encodeURIComponent(c.id)}/report.pdf">${icon('print',16)}Download PDF</a>`:button('Print / save PDF','print','','button primary','print')):button('Review & sign','review','','button primary','check');
  return `<section class="panel">${head('Case report',`${count(findings.length)} saved finding${findings.length===1?'':'s'} · ${signed?'Signed by '+c.review.reviewer:'Awaiting review'}`,action)}${findings.length?`<div class="report-findings">${findings.map(f=>`<article><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p>${rowRefs(f.ids)}</article>`).join('')}</div>`:empty('No saved findings',state.readOnly?'Review tools are available in the connected workspace.':'Open a case lead or an evidence-linked answer, then choose Save finding.')}${signed?`<p class="panel-note">Signed ${stamp(c.review.signedAt)} IST. Changes to evidence or findings require a new review.</p>`:''}</section><section class="panel gap">${head('Activity log','Case actions in reverse chronological order.',state.teamMode?button('Refresh','refresh-case','','button small'):'')}${auditList(c,state.auditLimit)}${((c.audit?.length||0)+(c.activity?.length||0))>state.auditLimit?button('Show earlier actions','more-audit','','button small'):''}</section>`;
}
export function pageHeader(view,c) {
  return `<header class="page-header"><div>${caseTags(c)}<h1>${esc(sections[view][0])}</h1><p>${esc(sections[view][2])}</p></div><div class="page-actions">${view==='overview'||view==='sources'?button('Import evidence','import','','button primary','upload'):''}</div></header>`;
}
