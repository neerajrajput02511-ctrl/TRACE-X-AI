// Case data, original input and analytics stay in this JavaScript environment.
import {sha256 as hashBytes, uuid} from './crypto.js';
const IST = 330;
const HEADER = {
  from: ['callingnumber','callingpartynumber','aparty','caller','from','originatingnumber','sourcephone','callingno','fromnumber'],
  to: ['callednumber','calledpartynumber','bparty','callee','to','terminatingnumber','destinationphone','calledno','tonumber'],
  subscriber: ['subscriber','subscriberid','msisdn','mobilenumber','subscribernumber','subject','subjectnumber'],
  peer: ['peer','otherparty','otherpartynumber','counterparty','contactnumber'],
  direction: ['direction','calldirection','calltype'],
  time: ['startts','timestamp','starttime','datetime','calldatetime','sessionstart','startdatetime','callstart','sessionstarttime','eventtime','timefirst','flowstart'],
  date: ['date','calldate','sessiondate','startdate'],
  clock: ['time','calltime','localtime'],
  duration: ['duration','durationsec','durationseconds','callduration','durationsecs'],
  cell: ['cell','cellid','tower','towerid','firstcellid','startcellid','servingcellid'],
  imei: ['imei','deviceid','handsetid','deviceimei'],
  imsi: ['imsi','simid','subscriberimsi'],
  ip: ['ip','srcip','sourceip','publicip','externalip','publicipv4','publicipaddress','translatedsourceip','publicsourceip'],
  port: ['port','srcport','sourceport','publicport','externalport','translatedsourceport','publicsourceport'],
  destinationIp: ['destinationip','dstip','remoteip','destinationaddress'],
  destinationPort: ['destinationport','dstport','remoteport'],
  protocol: ['protocol','transportprotocol','transport','proto'],
  service: ['service','servicename','application','applicationname','app','appname','trafficlabel'],
  end: ['endts','endtime','sessionend','enddatetime','sessionendtime','timelast','flowend'],
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
  return {id:'TX-' + uuid().slice(0,8).toUpperCase(), name:safeText(name) || 'Untitled case',
    createdAt:new Date().toISOString(), files:[], records:[], towers:[], subjects:[]};
}

function headerDelimiter(text) {
  const delimiters=[',','\t',';'], counts=new Map(delimiters.map(value=>[value,0]));
  let quoted=false, content=false;
  for(let i=0;i<text.length;i++) {
    const char=text[i];
    if(char==='"') {
      if(quoted&&text[i+1]==='"') {i++;continue;}
      quoted=!quoted;content=true;
    } else if(!quoted) {
      if(char==='\r'||char==='\n') {
        if(content)break;
        for(const delimiter of delimiters)counts.set(delimiter,0);
      } else if(counts.has(char)) counts.set(char,counts.get(char)+1);
      else if(char.trim())content=true;
    }
  }
  return delimiters.sort((a,b)=>counts.get(b)-counts.get(a))[0];
}

// Keep each record's original physical starting line, including multiline CSV fields.
function parseDelimited(input) {
  const text = input.replace(/^\uFEFF/, '');
  const delimiter = headerDelimiter(text);
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

const fingerprint = record => JSON.stringify([record.kind, record.from,record.to,record.time,record.duration,record.cell,record.imei,record.imsi,record.ip,record.port,record.protocol,record.end,record.observer,record.destinationIp||'',record.destinationPort||'',record.service||'']);
function validateAddress(address) {
  if (address.includes(':')) {try {new URL('http://['+address+']/');} catch {throw new Error('Invalid IPv6 address.');}}
  else if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) || address.split('.').some(x=>+x>255)) throw new Error('Invalid IPv4 address.');
}
function portValue(port) {
  if (port && (!/^\d{1,5}$/.test(port) || +port>65535)) throw new Error('Invalid port.');
  return port?String(+port):'';
}
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
    validateAddress(ip);
    const destination=get('destinationIp');
    if(destination)validateAddress(destination);
  }
  const end=get('end') ? parseTime(get('end'),offset) : '';
  if (end && end<time) throw new Error('Session ends before its start.');
  const destinationIp=get('destinationIp'), destinationPort=type==='IPDR'?portValue(get('destinationPort')):'';
  const service=type==='IPDR'?get('service'):'';
  return {kind:type,from,to:type==='CDR'?to:'',time,duration,cell:get('cell'),imei:get('imei'),imsi:get('imsi'),ip,port:portValue(port),protocol,end,observer:subscriber || from,...(destinationIp?{destinationIp}:{}),...(destinationPort?{destinationPort}:{}),...(service?{service}:{})};
}

async function getDelimitedInput(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input)
    : input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input)
    : (typeof Blob !== 'undefined' && input instanceof Blob) ? new Uint8Array(await input.arrayBuffer()) : null;
  if (!bytes) throw new Error('Choose a UTF-8 CSV or TSV file.');
  if (bytes.length>10*1024*1024) throw new Error('Choose a file under 10 MB.');
  let raw;
  try {raw = new TextDecoder('utf-8',{fatal:true, ignoreBOM:true}).decode(bytes);} catch {throw new Error('Export the file as UTF-8 CSV or TSV.');}
  return {bytes,raw};
}

function delimitedRows(raw) {
  const parsed=parseDelimited(raw);
  if (parsed.length<2) throw new Error('The file needs a header and at least one data row.');
  return {header:parsed[0].values,rows:parsed.slice(1)};
}

function recordType(fields) {
  if(fields.has('lat') && fields.has('lon') && fields.has('cell')) return 'TOWER';
  if(fields.has('ip')) return 'IPDR';
  if((fields.has('from') && fields.has('to')) || (fields.has('subscriber') && fields.has('peer'))) return 'CDR';
  return null;
}

function mapping(header,columnMap) {
  const fields=new Map(), used=new Set();
  if(columnMap!==undefined) {
    if(!columnMap || typeof columnMap!=='object' || Array.isArray(columnMap)) throw new Error('Use a column map with evidence fields and matching headers.');
    for(const [field,label] of Object.entries(columnMap)) {
      if(!Object.hasOwn(HEADER,field) || typeof label!=='string') throw new Error('The column map has an unknown evidence field.');
      const index=header.indexOf(label);
      if(index<0 || header.lastIndexOf(label)!==index || used.has(index)) throw new Error('Each mapped header must name a unique source column.');
      fields.set(field,index);used.add(index);
    }
  } else for(const [index,label] of header.entries()) {
    const field=pairs.get(normalizeHeader(label));
    if(!field)continue;
    if(fields.has(field))throw new Error('Two columns map to '+field+'. Choose one in the field mapping.');
    fields.set(field,index);
  }
  return fields;
}

export async function previewImport(input) {
  const {raw}=await getDelimitedInput(input);
  const {header,rows}=delimitedRows(raw);
  let fields;
  try {fields=mapping(header);} catch {fields=new Map();}
  return {
    columns:header.map(label=>({header:label,suggestedField:pairs.get(normalizeHeader(label))||null})),
    fields:Object.keys(HEADER),
    rows:rows.slice(0,3).map(row=>({line:row.line,values:row.values})),
    type:recordType(fields),
    total:rows.length
  };
}

export async function importFile(caseObj, filename, input, options={}) {
  const {bytes,raw}=await getDelimitedInput(input);
  const sha256=await hashBytes(bytes);
  const original=caseObj.files.find(file => file.sha256===sha256);
  if (original) return {...original.qa,accepted:0,duplicate:original.qa.accepted+original.qa.duplicate,fileId:original.id,alreadyImported:true};
  const {header,rows}=delimitedRows(raw);
  const fields=mapping(header,options.columnMap);
  const type=recordType(fields);
  if (!type) throw new Error('Unknown headers. Use caller/callee, subscriber and public_ip, or cell_id and coordinates.');
  const offset=options.timezoneOffsetMinutes ?? IST;
  if (!Number.isInteger(offset) || Math.abs(offset)>840) throw new Error('Invalid timezone offset.');
  const fileId='F'+String(caseObj.files.length+1).padStart(3,'0');
  const qa={fileId,type,total:rows.length,accepted:0,duplicate:0,rejected:0,issues:[],defaultTimezoneOffsetMinutes:offset};
  if(options.columnMap!==undefined)qa.columnMap=Object.fromEntries(Array.from(fields.keys(),field=>[field,options.columnMap[field]]));
  const existing=new Map(caseObj.records.map(r=>[fingerprint(r),r]));
  const cellIndex=new Map(caseObj.towers.map(t=>[t.cell,t]));
  for (const row of rows) {
    try {
      if (row.values.length!==header.length) throw new Error('Column count differs from header.');
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

function callTotals() {
  return {count:0,incoming:0,outgoing:0,self:0,seconds:0,knownDurations:0,nightCount:0,first:null,last:null,ids:[]};
}

function observeCall(stats,call,party,hour=Number(istTime(call.time).slice(0,2))) {
  const ref={time:call.time,id:call.id};
  stats.count++;stats.ids.push(call.id);
  stats.first??=ref;stats.last=ref;
  if(call.from===party&&call.to===party)stats.self++;
  else if(call.from===party)stats.outgoing++;
  else if(call.to===party)stats.incoming++;
  if(Number.isFinite(call.duration)) {stats.seconds+=call.duration;stats.knownDurations++;}
  if(hour>=22||hour<6)stats.nightCount++;
}

function recordedServices(records,party) {
  const groups=new Map();
  for(const row of records) {
    if(row.kind!=='IPDR'||!row.service||(party&&row.from!==party))continue;
    if(!groups.has(row.service))groups.set(row.service,{name:row.service,count:0,ids:[]});
    const group=groups.get(row.service);
    group.count++;group.ids.push(row.id);
  }
  return [...groups.values()].sort((a,b)=>b.count-a.count||order(a.name,b.name));
}

export function analyze(c) {
  const records=[...c.records].sort(timestampOrder), nodesById=new Map(),edgesById=new Map();
  const towersById=new Map(c.towers.map(t=>[t.cell,t])), timeline=[],devices=[];
  let cdrCount=0, duration=0;
  const days=new Map(), nightIds=[], durationIds=[];
  const hours=Array.from({length:24},(_,hour)=>({hour,count:0,ids:[]}));
  for (const r of records) {
    const subject=r.observer || r.from;
    if(r.cell) {
      const tower=towersById.get(r.cell);
      timeline.push({time:r.time,cell:r.cell,name:tower?.name || r.cell,lat:tower?.lat ?? null,lon:tower?.lon ?? null,subject,recordId:r.id});
    }
    if(r.imei || r.imsi) devices.push({subject,imei:r.imei,imsi:r.imsi,time:r.time,recordId:r.id});
    if(r.kind!=='CDR') continue;
    cdrCount++;
    const localTime=istParts(r.time),day=localTime.slice(0,10);
    if(!days.has(day))days.set(day,{date:day,count:0,duration:0,ids:[]});
    const bucket=days.get(day);
    bucket.ids.push(r.id);bucket.count++;
    if(Number.isFinite(r.duration)){duration+=r.duration;bucket.duration+=r.duration;durationIds.push(r.id);}
    const hour=Number(localTime.slice(11,13));
    if(hour>=22||hour<6)nightIds.push(r.id);
    hours[hour].count++;hours[hour].ids.push(r.id);
    for(const id of new Set([r.from,r.to])) {
      if(!nodesById.has(id)) nodesById.set(id,{id,...callTotals()});
      observeCall(nodesById.get(id),r,id,hour);
    }
    const [source,target]=[r.from,r.to].sort(order), key=JSON.stringify([source,target]);
    if(!edgesById.has(key)) edgesById.set(key,{source,target,count:0,forward:0,reverse:0,seconds:0,knownDurations:0,ids:[]});
    const edge=edgesById.get(key);edge.count++;edge.ids.push(r.id);
    if(Number.isFinite(r.duration)){edge.seconds+=r.duration;edge.knownDurations++;}
    if(r.from===source)edge.forward++;else edge.reverse++;
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
    const latest=new Map(), seenCells=new Set();
    for(const v of timeline) {
      if(v.subject!==a&&v.subject!==b)continue;
      const other=latest.get(JSON.stringify([v.cell,v.subject===a?b:a]));
      if(other && Date.parse(v.time)-Date.parse(other.time)<=15*60*1000 && !seenCells.has(v.cell)){
        seenCells.add(v.cell);
        leads.push({id:'tower-'+encodeURIComponent(v.cell),title:'Tower overlap at '+v.name,
          detail:a+' and '+b+' were recorded at the same cell within 15 minutes. This shows network observations in a coverage area.',
          type:'Tower overlap',ids:[other.recordId,v.recordId]});
      }
      latest.set(JSON.stringify([v.cell,v.subject]),v);
    }
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
  const deviceParties=new Map();
  for(const d of devices) {
    if(!d.imei)continue;
    if(!deviceParties.has(d.imei))deviceParties.set(d.imei,new Map());
    deviceParties.get(d.imei).set(d.subject,d.recordId);
  }
  const sharedDevices=[...deviceParties].filter(([,parties])=>parties.size>1).map(([imei,parties])=>({imei,subjects:[...parties.keys()],ids:[...parties.values()]}));
  const peakHour=cdrCount?hours.reduce((peak,bucket)=>bucket.count>peak.count?bucket:peak):null;
  return {total:records.length,contacts:nodes.length,cdrCount,ipdrCount:records.length-cdrCount,nodes,edges,leads,timeline,devices,changes,topContacts:nodes,ipServices:recordedServices(records),
    callStats:{duration,durationIds,nightIds,days:[...days.values()],parties:nodes,peakHour,repeatedPairs:edges.filter(e=>e.count>1)},sharedDevices};
}

const fail = text => ({text,supported:false,ids:[]});
const success = (text,ids) => ({text,supported:true,ids:unique(ids)});
const istParts = iso => new Date(new Date(iso).getTime()+IST*60000).toISOString();
const istTime = iso => istParts(iso).slice(11,16);
const displayTime = iso => istParts(iso).slice(0,16).replace('T',' ')+' IST';
const templateHelp='I can check shared contacts, call activity, tower observations, identifier changes or IP sessions. Choose a suggested question.';
const ident='([\\p{L}\\d_+.-]{1,70})';
const re=pattern=>new RegExp('^'+pattern+'$','iu');
const dateToken='(\\d{4}-\\d{2}-\\d{2})';
const clockWindow=re('(?:show |list |find )?calls?(?: (?:for|of) '+ident+')? (?:between|from) (\\d{2}:\\d{2}) (?:and|to) (\\d{2}:\\d{2})(?: on '+dateToken+')?(?: ist)?');
const dateSuffix = re('(.+?) (?:on '+dateToken+'|(?:between|from) '+dateToken+' (?:and|to|through) '+dateToken+')(?: ist)?');
const insightsQuestion=re('(?:show |list |summarize |summarise |analyze |analyse )?(?:the )?(call activity|call summary|call patterns|call history|call duration|first and last calls|incoming calls|outgoing calls|incoming and outgoing calls|repeated contacts|repeat contacts|night calls|late[- ]night calls|calls) (?:for|of|involving) '+ident);
const sessionQuestion=/^(?:show |find |list )?(?:ipdr |ip )?sessions? (?:for|on|with) ([0-9a-f:.]+)(?: (?:port|source port) (\d+))?(?: (?:at|on) (\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?: ?(?:Z|UTC|IST|[+-]\d{2}:?\d{2}))?))?(?: (tcp|udp))?$/i;

function resolveEntity(c,input) {
  const norm=normEntity(input);
  return c.records.some(r=>r.from===norm || r.to===norm || r.observer===norm)?norm:null;
}

function callWindow(c, identifier, from, to, date) {
  const entity=identifier?resolveEntity(c,identifier):null;
  if(identifier&&!entity)return fail('That identifier is absent from this case.');
  if(![from,to].every(t=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)))return fail('Enter a valid IST time window.');
  let start,end;
  if(date) {
    try {
      start=Date.parse(parseTime(date+' '+from));
      end=Date.parse(parseTime(date+' '+to))+(from>to?86400000:0)+59999;
    } catch {return fail('Enter a valid IST calendar date.');}
  }
  const calls=c.records.filter(r=>{
    if(r.kind!=='CDR'||(entity&&r.from!==entity&&r.to!==entity))return false;
    if(date) {const at=Date.parse(r.time);return at>=start&&at<=end;}
    const t=istTime(r.time);
    return from<=to?t>=from&&t<=to:t>=from||t<=to;
  });
  if(!calls.length)return fail('No call rows match this IST time window.');
  const window=date?displayTime(new Date(start).toISOString())+' to '+displayTime(new Date(end).toISOString()):from+' to '+to+' IST';
  return success(calls.length+' call record(s)'+(entity?' for '+entity:'')+' fall in the requested window ('+window+').',refIds(calls));
}

function describeCalls(c,identifier,category) {
  const party=resolveEntity(c,identifier);
  if(!party)return fail('That identifier is absent from this case.');
  const calls=c.records.filter(r=>r.kind==='CDR'&&(r.from===party||r.to===party)).sort(timestampOrder);
  if(!calls.length)return fail('No matching call records for '+party+' in this case.');
  if(category==='first and last calls') {
    const first=calls[0],last=calls.at(-1);
    return success('First call for '+party+' at '+displayTime(first.time)+'. Last call at '+displayTime(last.time)+'.',[first.id,last.id]);
  }
  if(category==='incoming calls'||category==='outgoing calls') {
    const directional=calls.filter(r=>category==='incoming calls'?r.to===party&&r.from!==party:r.from===party&&r.to!==party);
    return directional.length?success(directional.length+' '+category+' for '+party+'.',refIds(directional)):fail('No '+category+' for '+party+' in the imported records.');
  }
  if(/night calls$/.test(category)) {
    const night=calls.filter(r=>{const hour=Number(istTime(r.time).slice(0,2));return hour>=22||hour<6;});
    return night.length?success(night.length+' call record(s) for '+party+' between 22:00 and 05:59 IST.',refIds(night)):fail('No rows for '+party+' match the 22:00–05:59 IST night window.');
  }
  if(category==='repeated contacts'||category==='repeat contacts') {
    const byContact=new Map();
    for(const r of calls) {
      const peer=r.from===party?r.to:r.from;
      if(peer===party)continue;
      if(!byContact.has(peer))byContact.set(peer,[]);
      byContact.get(peer).push(r.id);
    }
    const repeats=[...byContact].filter(([,ids])=>ids.length>1).sort((a,b)=>b[1].length-a[1].length||order(a[0],b[0])).slice(0,5);
    if(!repeats.length)return fail('The imported rows do not establish a repeat contact for '+party+'.');
    return success('Repeated contacts for '+party+' (up to five): '+repeats.map(([peer,ids])=>peer+' ('+ids.length+' calls)').join(', ')+'.',repeats.flatMap(([,ids])=>ids));
  }
  const stats=callTotals();
  for(const call of calls)observeCall(stats,call,party);
  const counted=stats.count+' call record(s) for '+party+' ('+stats.incoming+' incoming, '+stats.outgoing+' outgoing'+(stats.self?', '+stats.self+' self-addressed':'')+').';
  const duration=stats.knownDurations?' Recorded duration is '+stats.seconds.toLocaleString('en-IN',{maximumFractionDigits:3})+' seconds across '+stats.knownDurations+' of those rows.':' No duration is recorded in those rows.';
  return success(counted+duration+' First call at '+displayTime(stats.first.time)+'. Last call at '+displayTime(stats.last.time)+'.',stats.ids);
}

function addressKey(ip) {
  return ip.includes(':')?new URL('http://['+ip+']/').hostname.slice(1,-1):ip.split('.').map(Number).join('.');
}

const protocolKey=value=>value==='6'?'TCP':value==='17'?'UDP':value.toUpperCase();

function describeSessions(c,ip,inputPort,when,protocol) {
  try {validateAddress(ip);} catch {return fail('Enter a valid IPv4 or IPv6 source address.');}
  let port,time;
  try {port=portValue(inputPort);} catch {return fail('Enter a valid source port.');}
  try {time=when?parseTime(when):null;} catch {return fail('Enter a valid timestamp.');}
  const address=addressKey(ip), requestedProtocol=protocol?.toUpperCase();
  // A start with an unknown end cannot rule out an overlap after that start.
  const sessions=c.records.filter(r=>r.kind==='IPDR'&&addressKey(r.ip)===address
    &&(!port||!r.port||r.port===port)&&(!requestedProtocol||!r.protocol||protocolKey(r.protocol)===requestedProtocol)
    &&(!time||(r.time<=time&&(!r.end||r.end>=time))));
  if(!sessions.length)return fail('No matching session is present in the supplied IPDR rows.');
  const omitted=[!port&&'source port',!time&&'exact time',!requestedProtocol&&'transport protocol'].filter(Boolean);
  const gaps=[sessions.some(r=>!r.port)&&'source port',sessions.some(r=>!r.protocol)&&'protocol',sessions.some(r=>!r.end)&&'session end'].filter(Boolean);
  const ambiguous=omitted.length||gaps.length||sessions.length!==1;
  const result=ambiguous?'Attribution is inconclusive. ':'One recorded session matches the supplied IP, port, protocol and time. ';
  const count=sessions.length+' candidate session(s) for '+ip+'.';
  const why=(omitted.length?' Query did not specify '+omitted.join(', ')+'.':'')+(gaps.length?' Candidate records omit '+gaps.join(', ')+'.':'');
  return success(result+count+why,refIds(sessions));
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
  const q=safeText(question).replace(/[?!.।]+$/,'').replace(/\s+/g,' ').trim();
  if(!c.records.length) return fail('Import a CDR or IPDR file to ask a question about this case.');
  const date=dateSuffix.exec(q);
  if(!date)return askApproved(c,q);
  const [,text,day,from,to]=date,start=day||from,end=day||to;
  try {parseTime(start+' 00:00');parseTime(end+' 00:00');if(start>end)throw new Error();}
  catch {return fail('Enter a valid date range in YYYY-MM-DD order.');}
  const fullWindow=clockWindow.exec(q);
  if(fullWindow)return callWindow(c,...fullWindow.slice(1));
  const scoped={...c,records:c.records.filter(record=>{
    const day=istParts(record.time).slice(0,10);
    return day>=start&&day<=end;
  })};
  if(!scoped.records.length)return fail('No imported observations fall within this IST date range.');
  const answer=askApproved(scoped,text);
  if(answer.supported)answer.text+=' Records are scoped to '+(start===end?start:start+' through '+end)+' IST by start time.';
  return answer;
}

function askApproved(c,q) {
  const hindi=/[\u0900-\u097f]/.test(q);
  let m;
  if((m=clockWindow.exec(q)))return callWindow(c,...m.slice(1));
  if((m=insightsQuestion.exec(q)))return describeCalls(c,m[2],m[1].toLowerCase());
  if((m=re('how many calls (?:involve|involved|were recorded for) '+ident).exec(q)))return describeCalls(c,m[1],'calls');
  if((m=re('(?:show|list|find) (?:recorded |reported )?(?:apps?|applications?|services?|service labels)(?: for '+ident+')?').exec(q))) {
    const party=m[1]?resolveEntity(c,m[1]):null;
    if(m[1]&&!party)return fail('That identifier is absent from this case.');
    const labels=recordedServices(c.records,party).slice(0,5);
    if(!labels.length)return fail('The imported IPDR rows have no service labels for the requested scope. Service identification requires a named source field.');
    const summary=labels.map(s=>s.name+' ('+s.count+' sessions)').join(', ');
    return success('Recorded service labels'+(party?' for '+party:'')+' (up to five) include '+summary+'. Labels come from the cited source rows.',labels.flatMap(s=>s.ids));
  }
  if (/^(?:(?:show|list|find|what) )?(?:ipdr|ip) (?:matches|sessions|records) (?:that have |have |with )?(?:missing|no) (?:source )?ports?(?: information)?$/i.test(q)) {
    const rows=c.records.filter(r=>r.kind==='IPDR'&&!r.port);
    return rows.length?success(rows.length+' recorded session(s) have no source port. Identification from those sessions may be ambiguous.',refIds(rows)):fail('No imported IPDR rows with a missing source port match this query.');
  }
  if (/^(?:show |list |find )?(?:night calls|late[- ]night calls|unusual calling hours|night activity)$/i.test(q)) {
    const ids=analyze(c).callStats.nightIds;
    return ids.length?success(ids.length+' call(s) were recorded between 22:00 and 05:59 IST.',ids):fail('No rows match the 22:00–05:59 IST night window.');
  }
  if((m=re('(?:which|what)(?: contacts?| numbers?)? (?:do|are) '+ident+' and '+ident+' (?:share|sharing)').exec(q))
    ||(m=re('(?:which|what) (?:contacts?|numbers?) (?:are )?(?:shared by|common to) '+ident+' and '+ident).exec(q))
    ||(m=re('(?:show |find |list |what are |which are )?(?:the )?(?:shared|common) (?:contacts?|numbers?) (?:between|for|of) '+ident+' and '+ident).exec(q))
    ||(m=re(ident+' और '+ident+' के (?:साझा|कॉमन) संपर्क(?: कौन हैं| बताओ| दिखाओ)?').exec(q))) return commonAnswer(c,m[1],m[2],false,hindi);
  if((m=re('(?:how many times )?(?:did|does|has) '+ident+' (?:call|contact|called|contacted) '+ident+'(?: directly)?').exec(q))
    ||(m=re('(?:show |find |any |are there (?:any )?|were there (?:any )?)?(?:direct )?calls? between '+ident+' and '+ident).exec(q))
    ||(m=re('क्या '+ident+' (?:ने )?'+ident+' (?:को |से )?(?:सीधे )?कॉल (?:किया|की)').exec(q))) {
    // A directional verb must never count calls in the reverse direction.
    if(/^(?:(?:how many times )?(?:did|does|has)|क्या) /iu.test(q)) {
      const a=resolveEntity(c,m[1]),b=resolveEntity(c,m[2]);
      if(!a || !b || a===b) return fail(hindi?'दो अलग और उपलब्ध नंबर चुनें।':'Choose two different identifiers present in this case.');
      const calls=c.records.filter(r=>r.kind==='CDR' && r.from===a && r.to===b);
      if(!calls.length) return fail(hindi?'उपलब्ध रिकॉर्ड में '+a+' से '+b+' को सीधे कॉल का प्रमाण नहीं है।':'The imported rows do not establish that '+a+' called '+b+' directly.');
      return success(hindi?a+' से '+b+' को '+calls.length+' कॉल दर्ज हैं।':calls.length+' outgoing call record(s) from '+a+' to '+b+'.',refIds(calls));
    }
    return commonAnswer(c,m[1],m[2],true,hindi);
  }
  if((m=re('(?:show |list |what is |what are )?(?:the )?(tower timeline|tower activity|tower observations|tower visits|tower locations|repeated tower locations|device changes|imei changes|sim changes|device history|imei/sim changes)(?: for| of) '+ident).exec(q))
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
  if((m=sessionQuestion.exec(q)))return describeSessions(c,...m.slice(1));
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
