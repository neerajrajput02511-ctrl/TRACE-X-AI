// Case data, original input and analytics stay in this JavaScript environment.
const IST = 330;
const HEADER = {
  from: ['callingnumber','callingpartynumber','aparty','caller','from','originatingnumber','sourcephone','callingno','fromnumber'],
  to: ['callednumber','calledpartynumber','bparty','callee','to','terminatingnumber','destinationphone','calledno','tonumber'],
  subscriber: ['subscriber','subscriberid','msisdn','mobilenumber','subscribernumber','subject','subjectnumber'],
  peer: ['peer','otherparty','otherpartynumber','counterparty','contactnumber'],
  direction: ['direction','calldirection','calltype'],
  time: ['startts','timestamp','starttime','datetime','calldatetime','sessionstart','startdatetime','callstart','sessionstarttime','eventtime'],
  date: ['date','calldate','sessiondate','startdate'],
  clock: ['time','calltime','localtime'],
  duration: ['duration','durationsec','durationseconds','callduration','durationsecs'],
  cell: ['cell','cellid','tower','towerid','firstcellid','startcellid','servingcellid'],
  imei: ['imei','deviceid','handsetid','deviceimei'],
  imsi: ['imsi','simid','subscriberimsi'],
  ip: ['ip','srcip','sourceip','publicip','externalip','publicipv4','publicipaddress','translatedsourceip','publicsourceip'],
  port: ['port','srcport','sourceport','publicport','externalport','translatedsourceport','publicsourceport'],
  protocol: ['protocol','transportprotocol','transport','proto'],
  end: ['endts','endtime','sessionend','enddatetime','sessionendtime'],
  name: ['name','towername','sitename','location','site','sitelabel','locality'],
  lat: ['lat','latitude','towerlatitude'],
  lon: ['lon','lng','longitude','towerlongitude']
};
const normalizeHeader = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const pairs = new Map(Object.entries(HEADER).flatMap(([field, names]) => names.map(name => [name, field])));
const unique = values => [...new Set(values)];
const order = (a,b) => a.localeCompare(b, 'en', {numeric:true});
const timestampOrder = (a,b) => a.time.localeCompare(b.time) || order(a.id,b.id);
const refIds = records => records.map(record => record.id);
const safeText = value => String(value ?? '').trim();
const normEntity = value => {
  const label = safeText(value);
  if (/^\+?[\d() -]+$/.test(label)) return label.replace(/[ ()-]/g, '').replace(/^\+91(?=\d{10}$)/, '').replace(/^0091(?=\d{10}$)/, '');
  return label.toUpperCase();
};

export function createCase(name = 'Untitled case') {
  return {id:'TX-' + crypto.randomUUID().slice(0,8).toUpperCase(), name:safeText(name) || 'Untitled case',
    createdAt:new Date().toISOString(), files:[], records:[], towers:[], subjects:[]};
}

// Keep each record's original physical starting line, including multiline CSV fields.
function parseDelimited(input) {
  const text = input.replace(/^\uFEFF/, '');
  const first = text.split(/\r\n|\r|\n/)[0];
  const delimiter = [',','\t',';'].sort((a,b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let values = [], value = '', quoted = false, closed = false, line = 1, startLine = 1, start = 0;
  function emit(end) {
    values.push(value);
    if (values.some(field => field.trim())) rows.push({values, line:startLine, raw:text.slice(start,end)});
    values = []; value = ''; closed = false;
  }
  for (let p=0; p<text.length; p++) {
    const ch = text[p];
    if (ch === '"') {
      if (quoted && text[p+1] === '"') { value += '"'; p++; continue; }
      if (quoted) { quoted = false; closed = true; continue; }
      if (!value && !closed) { quoted = true; continue; }
      throw new Error('Unexpected quote on line ' + line + '.');
    }
    if (ch === '\r' || ch === '\n') {
      const width = ch === '\r' && text[p+1] === '\n' ? 2 : 1;
      if (quoted) value += text.slice(p,p+width);
      else { emit(p); start = p + width; startLine = line+1; }
      p += width-1; line++; continue;
    }
    if (!quoted && ch === delimiter) {values.push(value); value=''; closed=false; continue;}
    if (closed && ch.trim()) throw new Error('Unexpected text after a quoted field on line ' + line + '.');
    value += ch;
  }
  if (quoted) throw new Error('Unclosed quote starting on line ' + startLine + '.');
  emit(text.length);
  return rows;
}

function parseTime(value, offset = IST) {
  const match = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(Z|[+-]\d{2}:?\d{2}|IST|UTC)?$/i.exec(value);
  if (!match) throw new Error('Invalid timestamp. Use YYYY-MM-DD HH:mm or an ISO timestamp.');
  const parts = match[1].split(/[/-]/).map(Number);
  const [y,m,d] = parts[0] > 99 ? parts : parts.reverse();
  const h = +match[2], min = +match[3], sec = +(match[4] || 0), ms = Number((match[5] || '').padEnd(3,'0'));
  const utc = new Date(Date.UTC(y,m-1,d,h,min,sec,ms));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m-1 || utc.getUTCDate() !== d || h>23 || min>59 || sec>59) throw new Error('Invalid calendar date or time.');
  const zone = (match[6] || '').toUpperCase();
  if (zone === 'UTC' || zone === 'Z') offset = 0;
  else if (zone === 'IST') offset = IST;
  else if (zone) {
    const z = zone.replace(':',''), hh=Number(z.slice(1,3)), mm=Number(z.slice(3));
    if (hh>14 || mm>59 || (hh===14 && mm)) throw new Error('Invalid timezone offset.');
    offset=(z[0]==='-' ? -1:1)*(hh*60+mm);
  }
  return new Date(utc.getTime()-offset*60000).toISOString();
}

const fingerprint = record => JSON.stringify([record.kind, record.from,record.to,record.time,record.duration,record.cell,record.imei,record.imsi,record.ip,record.port,record.protocol,record.end,record.observer]);
function parseRow(get, type, offset) {
  if (type === 'TOWER') {
    const cell=get('cell'), lat=Number(get('lat')), lon=Number(get('lon'));
    if (!cell || !get('lat') || !get('lon') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) throw new Error('Missing cell ID or invalid coordinates.');
    return {cell,name:get('name') || cell,lat,lon};
  }
  let timeInput = get('time') || get('clock');
  if (/^\d{1,2}:/.test(timeInput) && get('date')) timeInput = get('date') + ' ' + timeInput;
  const time=parseTime(timeInput,offset);
  let from=normEntity(get('from')), to=normEntity(get('to'));
  const subscriber=normEntity(get('subscriber')), peer=normEntity(get('peer'));
  if (type === 'IPDR') from=subscriber || from;
  if (type === 'CDR' && (!from || !to) && subscriber && peer) {
    const dir=get('direction').toLowerCase();
    if (/^(incoming|in|mt|inbound)$/.test(dir)) {from=peer;to=subscriber;}
    else if (/^(outgoing|out|mo|outbound)$/.test(dir)) {from=subscriber;to=peer;}
    else throw new Error('A subscriber/peer record requires incoming or outgoing direction.');
  }
  if (!from || (type==='CDR' && !to)) throw new Error('Missing subscriber or endpoint.');
  const rawDuration=get('duration');
  const duration=rawDuration ? Number(rawDuration) : null;
  if (rawDuration && (!Number.isFinite(duration) || duration<0)) throw new Error('Invalid duration in seconds.');
  const port=get('port'), ip=get('ip'), protocol=get('protocol').toUpperCase();
  if (type==='IPDR') {
    if (!ip) throw new Error('Missing IP address.');
    if (ip.includes(':')) {try {new URL('http://[' + ip + ']/');} catch {throw new Error('Invalid IPv6 address.');}}
    else if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) || ip.split('.').some(x=>+x>255)) throw new Error('Invalid IPv4 address.');
    if (port && (!/^\d{1,5}$/.test(port) || +port>65535)) throw new Error('Invalid source port.');
  }
  const end=get('end') ? parseTime(get('end'),offset) : '';
  if (end && end<time) throw new Error('Session ends before its start.');
  return {kind:type,from,to:type==='CDR'?to:'',time,duration,cell:get('cell'),imei:get('imei'),imsi:get('imsi'),ip,port:port?String(+port):'',protocol,end,observer:subscriber || from};
}

export async function importFile(caseObj, filename, input, options={}) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input)
    : input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input)
    : (typeof Blob !== 'undefined' && input instanceof Blob) ? new Uint8Array(await input.arrayBuffer()) : null;
  if (!bytes) throw new Error('Choose a UTF-8 CSV or TSV file.');
  if (bytes.length>10*1024*1024) throw new Error('Choose a file under 10 MB.');
  let raw;
  try {raw = new TextDecoder('utf-8',{fatal:true, ignoreBOM:true}).decode(bytes);} catch {throw new Error('Export the file as UTF-8 CSV or TSV.');}
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const sha256=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  const original=caseObj.files.find(file => file.sha256===sha256);
  if (original) return {...original.qa,accepted:0,duplicate:original.qa.accepted+original.qa.duplicate,fileId:original.id,alreadyImported:true};
  const parsed=parseDelimited(raw);
  if (parsed.length<2) throw new Error('The file needs a header and at least one data row.');
  const [header,...rows]=parsed, fields=new Map();
  header.values.forEach((label,index)=>{
    const field=options.columnMap?.[label] || pairs.get(normalizeHeader(label));
    if (field) {
      if (fields.has(field)) throw new Error('Two columns map to ' + field + '. Use a column map to select one.');
      fields.set(field,index);
    }
  });
  const type=fields.has('lat') && fields.has('lon') && fields.has('cell') ? 'TOWER'
    : fields.has('ip') ? 'IPDR'
    : (fields.has('from')&&fields.has('to')) || (fields.has('subscriber')&&fields.has('peer')) ? 'CDR' : '';
  if (!type) throw new Error('Unknown headers. Use caller/callee, subscriber and public_ip, or cell_id and coordinates.');
  const offset=options.timezoneOffsetMinutes ?? IST;
  if (!Number.isInteger(offset) || Math.abs(offset)>840) throw new Error('Invalid timezone offset.');
  const fileId='F'+String(caseObj.files.length+1).padStart(3,'0');
  const qa={fileId,type,total:rows.length,accepted:0,duplicate:0,rejected:0,issues:[],defaultTimezoneOffsetMinutes:offset};
  const existing=new Map(caseObj.records.map(r=>[fingerprint(r),r]));
  const cellIndex=new Map(caseObj.towers.map(t=>[t.cell,t]));
  for (const row of rows) {
    try {
      if (row.values.length!==header.values.length) throw new Error('Column count differs from header.');
      const get=key=>safeText(row.values[fields.get(key)]);
      const record=parseRow(get,type,offset),ref={fileId,line:row.line,raw:row.raw};
      const index=type==='TOWER'?cellIndex:existing, key=type==='TOWER'?record.cell:fingerprint(record), previous=index.get(key);
      if(previous) {
        if(type==='TOWER' && (previous.lat!==record.lat || previous.lon!==record.lon)) throw new Error('Conflicting coordinates for cell ' + record.cell + '.');
        previous.refs.push(ref);qa.duplicate++;continue;
      }
      record.refs=[ref];index.set(key,record);
      if(type==='TOWER') caseObj.towers.push(record);
      else {record.id='R'+String(101+caseObj.records.length);caseObj.records.push(record);}
      if(type==='IPDR' && !record.port) qa.issues.push({line:row.line,message:'Source port missing. Attribution is ambiguous.'});
      qa.accepted++;
    } catch(error) {qa.rejected++;qa.issues.push({line:row.line,message:error.message});}
  }
  caseObj.files.push({id:fileId,name:String(filename),sha256,type,raw,qa});
  return qa;
}

function sharedContacts(records,a,b) {
  const byPeer=new Map();
  for(const r of records) {
    if(r.kind!=='CDR') continue;
    for(const subject of [a,b]) {
      if(r.from!==subject && r.to!==subject) continue;
      const peer=r.from===subject?r.to:r.from;
      if(peer===a || peer===b) continue;
      if(!byPeer.has(peer)) byPeer.set(peer,{id:peer,parties:new Set(),ids:[]});
      const entry=byPeer.get(peer);entry.parties.add(subject);entry.ids.push(r.id);
    }
  }
  return [...byPeer.values()].filter(p=>p.parties.size===2).sort((x,y)=>y.ids.length-x.ids.length || order(x.id,y.id));
}

function deviceChanges(records) {
  const previous=new Map(),changes=[];
  for (const r of records) {
    const subject=r.observer || r.from;
    for (const field of ['imei','imsi']) {
      if(!r[field]) continue;
      const key=JSON.stringify([subject,field]), last=previous.get(key);
      if(last && last[field]!==r[field]) changes.push({subject,field,before:last[field],after:r[field],time:r.time,ids:[last.id,r.id]});
      previous.set(key,r);
    }
  }
  return changes;
}

export function analyze(c) {
  const records=[...c.records].sort(timestampOrder), nodesById=new Map(),edgesById=new Map();
  const towersById=new Map(c.towers.map(t=>[t.cell,t])), timeline=[],devices=[];
  let cdrCount=0;
  for (const r of records) {
    const subject=r.observer || r.from;
    if(r.cell) {
      const tower=towersById.get(r.cell);
      timeline.push({time:r.time,cell:r.cell,name:tower?.name || r.cell,lat:tower?.lat ?? null,lon:tower?.lon ?? null,subject,recordId:r.id});
    }
    if(r.imei || r.imsi) devices.push({subject,imei:r.imei,imsi:r.imsi,time:r.time,recordId:r.id});
    if(r.kind!=='CDR') continue;
    cdrCount++;
    for(const id of new Set([r.from,r.to])) {
      if(!nodesById.has(id)) nodesById.set(id,{id,count:0,ids:[]});
      const n=nodesById.get(id);n.count++;n.ids.push(r.id);
    }
    const [source,target]=[r.from,r.to].sort(order), key=JSON.stringify([source,target]);
    if(!edgesById.has(key)) edgesById.set(key,{source,target,count:0,ids:[]});
    const edge=edgesById.get(key);edge.count++;edge.ids.push(r.id);
  }
  const nodes=[...nodesById.values()].sort((a,b)=>b.count-a.count || order(a.id,b.id));
  const edges=[...edgesById.values()].sort((a,b)=>b.count-a.count || order(a.source,b.source) || order(a.target,b.target));
  const subjects=c.subjects?.length>=2?c.subjects:unique(records.filter(r=>r.kind==='CDR').map(r=>r.observer || r.from));
  const leads=[];
  if(subjects.length>=2) {
    const [a,b]=subjects;
    for(const peer of sharedContacts(records,a,b)) leads.push({id:'shared-'+encodeURIComponent(JSON.stringify([a,b,peer.id])),title:'Shared contact '+peer.id,
      detail:a+' and '+b+' both communicated with '+peer.id+'. '+peer.ids.length+' call records support this link.',
      type:'Shared contact',ids:peer.ids});
  }
  const changes=deviceChanges(records);
  for(const d of changes) leads.push({id:'device-'+d.field+'-'+d.ids.join('-'),title:(d.field==='imei'?'Device':'SIM')+' change on '+d.subject,
    detail:d.field.toUpperCase()+' changed from '+d.before+' to '+d.after+' across two observations.',type:d.field==='imei'?'Device change':'SIM change',ids:d.ids});
  const byIp=new Map();
  for(const r of records.filter(r=>r.kind==='IPDR')) {
    if(!byIp.has(r.ip)) byIp.set(r.ip,[]);
    byIp.get(r.ip).push(r);
  }
  for(const [ip,sessions] of byIp) {
    if(unique(sessions.map(s=>s.from)).length<2) continue;
    leads.push({id:'ip-'+ip,title:'Shared IP address',detail:ip+' appears in sessions for multiple subscribers. A public address alone cannot identify the user.',
      type:'IPDR ambiguity',ids:refIds(sessions)});
  }
  return {total:records.length,contacts:nodes.length,cdrCount,ipdrCount:records.length-cdrCount,nodes,edges,leads,timeline,devices,changes,topContacts:nodes};
}

const fail = text => ({text,supported:false,ids:[]});
const success = (text,ids) => ({text,supported:true,ids:unique(ids)});
const istParts = iso => new Date(new Date(iso).getTime()+IST*60000).toISOString();
const istTime = iso => istParts(iso).slice(11,16);
const templateHelp='I can check shared contacts, direct calls, top contacts, tower visits, device changes, IP sessions or a call time window. Choose a suggested question.';

function resolveEntity(c,input) {
  const norm=normEntity(input);
  return c.records.some(r=>r.from===norm || r.to===norm || r.observer===norm)?norm:null;
}

function commonAnswer(c,left,right,direct,hindi) {
  const a=resolveEntity(c,left),b=resolveEntity(c,right);
  if(!a || !b || a===b) return fail(hindi?'दो अलग और उपलब्ध नंबर चुनें।':'Choose two different identifiers present in this case.');
  if(direct) {
    const calls=c.records.filter(r=>r.kind==='CDR' && ((r.from===a && r.to===b) || (r.from===b && r.to===a)));
    if(!calls.length) return fail(hindi?'इन रिकॉर्ड में '+a+' और '+b+' के बीच सीधे कॉल का प्रमाण नहीं मिला।':'The imported records do not establish a direct call between '+a+' and '+b+'.');
    return success(hindi?a+' और '+b+' के बीच '+calls.length+' सीधे कॉल रिकॉर्ड हैं।':calls.length+' direct call record(s) connect '+a+' and '+b+' in this case.',refIds(calls));
  }
  const people=sharedContacts(c.records,a,b);
  if(!people.length) return fail(hindi?'उपलब्ध रिकॉर्ड में साझा संपर्क नहीं मिला।':'No shared contact is established by the imported records for '+a+' and '+b+'.');
  return success(hindi?a+' और '+b+' के साझा संपर्क: '+people.map(p=>p.id).join(', ')+'।':
    a+' and '+b+' share '+(people.length===1?'contact ':'contacts ')+people.map(p=>p.id).join(', ')+'. Each cited record connects one of the two parties to a shared contact.',
    people.flatMap(p=>p.ids));
}

export function ask(c,question) {
  const q=safeText(question).replace(/[?!.।]+$/,'').replace(/\s+/g,' ').trim(), hindi=/[\u0900-\u097f]/.test(q);
  if(!c.records.length) return fail('Import a CDR or IPDR file to ask a question about this case.');
  let m;
  const ident='([\\p{L}\\d_+.-]{1,70})';
  const re=pattern=>new RegExp('^'+pattern+'$','iu');
  if((m=re('(?:which|what)(?: contacts?| numbers?)? (?:do|are) '+ident+' and '+ident+' (?:share|sharing)').exec(q))
    ||(m=re('(?:show |find |list |what are |which are )?(?:the )?(?:shared|common) (?:contacts?|numbers?) (?:between|for|of) '+ident+' and '+ident).exec(q))
    ||(m=re(ident+' और '+ident+' के (?:साझा|कॉमन) संपर्क(?: कौन हैं| बताओ| दिखाओ)?').exec(q))) return commonAnswer(c,m[1],m[2],false,hindi);
  if((m=re('(?:did|does|has) '+ident+' (?:call|contact|called|contacted) '+ident+'(?: directly)?').exec(q))
    ||(m=re('(?:show |find |any |are there )?direct calls? between '+ident+' and '+ident).exec(q))
    ||(m=re('क्या '+ident+' (?:ने )?'+ident+' (?:को |से )?(?:सीधे )?कॉल (?:किया|की)').exec(q))) {
    // A directional verb must never count calls in the reverse direction.
    if(/^(did|does|has|क्या) /iu.test(q)) {
      const a=resolveEntity(c,m[1]),b=resolveEntity(c,m[2]);
      if(!a || !b || a===b) return fail(hindi?'दो अलग और उपलब्ध नंबर चुनें।':'Choose two different identifiers present in this case.');
      const calls=c.records.filter(r=>r.kind==='CDR' && r.from===a && r.to===b);
      if(!calls.length) return fail(hindi?'उपलब्ध रिकॉर्ड में '+a+' से '+b+' को सीधे कॉल का प्रमाण नहीं है।':'The imported rows do not establish that '+a+' called '+b+' directly.');
      return success(hindi?a+' से '+b+' को '+calls.length+' कॉल दर्ज हैं।':calls.length+' outgoing call record(s) from '+a+' to '+b+'.',refIds(calls));
    }
    return commonAnswer(c,m[1],m[2],true,hindi);
  }
  if((m=re('(?:show |list |what is |what are )?(?:the )?(tower timeline|tower visits|tower locations|repeated tower locations|device changes|imei changes|sim changes|device history|imei/sim changes)(?: for| of) '+ident).exec(q))
    ||(m=re(ident+' (?:की|का|के) (टावर टाइमलाइन|टावर लोकेशन|डिवाइस बदलाव|सिम बदलाव)(?: दिखाओ| बताओ)?').exec(q))) {
    const category=(hindi?m[2]:m[1]).toLowerCase(), entity=resolveEntity(c,hindi?m[1]:m[2]);
    if(!entity) return fail('That identifier is absent from this case.');
    const summary=analyze(c);
    if(/tower|टावर/.test(category)) {
      let visits=summary.timeline.filter(v=>v.subject===entity);
      if(category.includes('repeated')) {const count=new Map();for(const v of visits) count.set(v.cell,(count.get(v.cell)||0)+1);visits=visits.filter(v=>count.get(v.cell)>1);}
      if(!visits.length) return fail(hindi?'मेल खाते टावर रिकॉर्ड उपलब्ध नहीं हैं।':'No matching tower observations for '+entity+' in the imported rows.');
      const labels=visits.slice(0,8).map(v=>istParts(v.time).slice(5,10)+' '+istTime(v.time)+' IST · '+v.name);
      return success((hindi?entity+' के '+visits.length+' टावर रिकॉर्ड। ':visits.length+' tower observation(s) for '+entity+'. ')+labels.join('; ')+(visits.length>8?' (first 8 shown).':'.'),visits.map(v=>v.recordId));
    }
    const changes=summary.changes.filter(d=>d.subject===entity && (!/sim changes|सिम बदलाव/.test(category)||d.field==='imsi') && (category!=='imei changes'||d.field==='imei'));
    if(!changes.length) return fail(hindi?'उपलब्ध रिकॉर्ड से बदलाव की पुष्टि नहीं होती।':'The available identifiers do not establish a change for '+entity+'.');
    return success((hindi?entity+' के बदलाव। ':'Recorded changes for '+entity+'. ')+changes.slice(0,5).map(d=>d.field.toUpperCase()+' '+d.before+' → '+d.after).join('; '),changes.flatMap(d=>d.ids));
  }
  if((m=re('(?:show |list |who (?:are|is) |what are )?(?:the )?(?:most frequent|top|frequent) contacts?(?: (?:of|for) '+ident+')?').exec(q))
    || /^(?:सबसे अधिक संपर्क|प्रमुख संपर्क)(?: दिखाओ| बताओ)?$/u.test(q)) {
    const entity=m?.[1]?resolveEntity(c,m[1]):null;
    if(m?.[1] && !entity) return fail('That identifier is absent from this case.');
    const counts=new Map(), calls=c.records.filter(r=>r.kind==='CDR' && (!entity || r.from===entity || r.to===entity));
    for(const r of calls) for(const id of (entity?[r.from===entity?r.to:r.from]:new Set([r.from,r.to]))) {
      if(!counts.has(id)) counts.set(id,[]);counts.get(id).push(r.id);
    }
    const top=[...counts].sort((a,b)=>b[1].length-a[1].length||order(a[0],b[0])).slice(0,5);
    if(!top.length) return fail('No matching call records in this case.');
    return success((hindi?'कॉल रिकॉर्ड के अनुसार प्रमुख संपर्क। ':'Most frequent contacts by call-record count'+(entity?' for '+entity:'')+'. ')+top.map(([id,ids])=>id+' ('+ids.length+')').join(', ')+'.',top.flatMap(([,ids])=>ids));
  }
  if((m=/^(?:show |find |list )?(?:ipdr |ip )?sessions? (?:for|on|with) ([0-9a-f:.]+)(?: (?:port|source port) (\d+))?(?: (?:at|on) (\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?(?:Z| IST)?))?(?: (tcp|udp))?$/i.exec(q))) {
    const [,ip,port,when,protocol]=m;
    let time; try {time=when?parseTime(when):null;} catch {return fail('Enter a valid timestamp.');}
    const sessions=c.records.filter(r=>r.kind==='IPDR'&&r.ip.toLowerCase()===ip.toLowerCase()&&(!port||!r.port||r.port===port)&&(!time||(r.time<=time && (r.end||r.time)>=time))&&(!protocol||!r.protocol||r.protocol===protocol.toUpperCase()));
    if(!sessions.length) return fail('No matching session is present in the supplied IPDR rows.');
    const ambiguous=!port||!time||!protocol||sessions.length!==1||sessions.some(r=>!r.port||!r.protocol);
    return success((ambiguous?'Attribution is inconclusive. ':'One recorded session matches the supplied IP, port, protocol and time. ')+sessions.length+' candidate session(s) for '+ip+'.',refIds(sessions));
  }
  if((m=/^(?:show |list |find )?calls? (?:between|from) (\d{2}:\d{2}) (?:and|to) (\d{2}:\d{2})(?: (?:on) (\d{4}-\d{2}-\d{2}))?(?: ist)?$/i.exec(q))) {
    if(![m[1],m[2]].every(t=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t))) return fail('Enter a valid IST time window.');
    const calls=c.records.filter(r=>{const t=istTime(r.time);return r.kind==='CDR' && (!m[3]||istParts(r.time).slice(0,10)===m[3]) && (m[1]<=m[2]?t>=m[1]&&t<=m[2]:t>=m[1]||t<=m[2]);});
    if(!calls.length)return fail('No call rows match this IST time window.');
    return success(calls.length+' call record(s) fall in the requested IST window.',refIds(calls));
  }
  return fail(hindi?'साझा संपर्क, सीधे कॉल, टावर टाइमलाइन या डिवाइस बदलाव के बारे में पूछें।':templateHelp);
}

export async function createDemo() {
  const c=createCase('Jaipur Relay'); c.id='CASE-RJ-001';c.subjects=['A','B'];
  await importFile(c,'north-operator-cdr.csv',[
    'Calling Number,Called Number,Timestamp,Duration,Cell ID,IMEI,IMSI',
    'A,C,2026-11-18 09:42,42,JP11,DEV-A01,SIM-A01',
    'A,X,2026-11-18 10:14,84,JP11,DEV-A01,SIM-A01',
    'C,D,2026-11-18 10:19,31,JP12,DEV-C01,SIM-C01',
    'X,E,2026-11-18 10:24,102,JP13,DEV-X01,SIM-X01',
    'A,X,2026-11-18 11:03,58,JP12,DEV-A02,SIM-A01',
    'D,E,2026-11-18 11:09,90,JP14,DEV-D01,SIM-D01',
    'A,C,2026-11-18 12:35,46,JP13,DEV-A02,SIM-A01',
    'E,F,2026-11-18 13:20,160,JP15,DEV-E01,SIM-E01'
  ].join('\n'));
  await importFile(c,'west-operator-cdr.tsv',[
    'MSISDN\tOther Party\tDirection\tCall Date\tCall Time\tDuration Sec\tTower ID\tDevice ID\tSIM ID',
    'B\tX\tOutgoing\t18/11/2026\t10:41\t65\tJP14\tDEV-B01\tSIM-B01',
    'B\tF\tIncoming\t18/11/2026\t10:48\t58\tJP14\tDEV-B01\tSIM-B01',
    'B\tX\tOutgoing\t18/11/2026\t11:30\t112\tJP15\tDEV-B01\tSIM-B01',
    'B\tG\tOutgoing\t18/11/2026\t12:10\t48\tJP16\tDEV-B01\tSIM-B01',
    'G\tF\tIncoming\t18/11/2026\t13:40\t87\tJP16\tDEV-G01\tSIM-G01',
    'G\tD\tOutgoing\t18/11/2026\t14:12\t33\tJP16\tDEV-G01\tSIM-G01'
  ].join('\n'));
  await importFile(c,'sample-ip-sessions.csv',[
    'Subscriber,Public IP,Source Port,Protocol,Session Start,Session End',
    'A,203.0.113.18,4051,TCP,2026-11-18 10:10,2026-11-18 10:32',
    'B,203.0.113.18,,TCP,2026-11-18 10:21,2026-11-18 10:46',
    'F,198.51.100.22,6120,UDP,2026-11-18 13:04,2026-11-18 13:11'
  ].join('\n'));
  await importFile(c,'jaipur-tower-sample.csv',[
    'Cell ID,Tower Name,Latitude,Longitude',
    'JP11,Civil Lines,26.9095,75.7818','JP12,Ajmer Road,26.9015,75.7673',
    'JP13,Sodala,26.8965,75.7708','JP14,C-Scheme,26.9075,75.8001',
    'JP15,Ashok Nagar,26.9074,75.8081','JP16,Rambagh,26.8946,75.8107'
  ].join('\n'));
  return c;
}
