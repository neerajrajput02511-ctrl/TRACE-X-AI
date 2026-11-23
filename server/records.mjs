const text = value => String(value ?? '');
const lookupKey = value => text(value).toUpperCase();

export function syncEvidenceIndex(db,unit,item) {
  db.prepare('DELETE FROM record_index WHERE unit=? AND case_id=?').run(unit,item.id);
  const insertRecord = db.prepare(`INSERT INTO record_index
    (unit,case_id,id,kind,party,peer,observed,session_end,imei,tower,ip,dest_ip,protocol,session,port,data)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertSource = db.prepare('INSERT OR IGNORE INTO record_sources VALUES(?,?,?,?,?)');
  const files = new Map(item.files.map(f=>[f.id,f]));
  for (const r of item.records) {
    insertRecord.run(unit,item.id,r.id,r.kind,lookupKey(r.from),lookupKey(r.to),r.time,text(r.end || r.time),
      lookupKey(r.imei),lookupKey(r.cell),lookupKey(r.ip),lookupKey(r.destIp ?? r.destinationIp),
      lookupKey(r.protocol),lookupKey(r.session || r.sessionId || (r.kind==='IPDR'?r.id:'')),text(r.port),JSON.stringify(r));
    for (const ref of r.refs ?? []) {
      const f=files.get(ref.fileId);
      if (f) insertSource.run(unit,item.id,r.id,ref.fileId,lookupKey(f.operator || f.name));
    }
  }
}

export function syncForensicIndex(db,unit,item,evidenceChanged) {
  if(evidenceChanged){
    db.prepare('DELETE FROM record_provenance WHERE unit=? AND case_id=?').run(unit,item.id);
    db.prepare('DELETE FROM source_manifests WHERE unit=? AND case_id=?').run(unit,item.id);
    db.prepare('DELETE FROM tower_index WHERE unit=? AND case_id=?').run(unit,item.id);
    const manifest=db.prepare('INSERT INTO source_manifests VALUES(?,?,?,?,?,?,?)');
    const provenance=db.prepare('INSERT OR IGNORE INTO record_provenance VALUES(?,?,?,?,?,?)');
    const tower=db.prepare('INSERT INTO tower_index VALUES(?,?,?,?,?,?)');
    const fileInfo=new Map();
    for(const file of item.files) {
      const length=file.originalBase64?Buffer.byteLength(file.originalBase64,'base64'):Buffer.byteLength(file.raw);
      manifest.run(unit,item.id,file.id,file.name,file.type,file.sha256,length);
      fileInfo.set(file.id,file);
    }
    for(const observation of item.towers ?? [])tower.run(unit,item.id,observation.cell,observation.lat,observation.lon,JSON.stringify(observation));
    for(const record of item.records) for(const row of record.refs) {
      const source=fileInfo.get(row.fileId);
      if(source)provenance.run(unit,item.id,record.id,row.fileId,row.line,source.sheet||'');
    }
  }
  db.prepare('DELETE FROM findings_index WHERE unit=? AND case_id=?').run(unit,item.id);
  const findingInsert=db.prepare('INSERT INTO findings_index VALUES(?,?,?,?)');
  const citation=db.prepare('INSERT OR IGNORE INTO finding_citations VALUES(?,?,?,?)');
  for(const finding of item.findings ?? []) {
    findingInsert.run(unit,item.id,finding.id,JSON.stringify(finding));
    for(const id of finding.ids)citation.run(unit,item.id,finding.id,id);
  }
}

export function timeBoundary(raw,end=false) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const check = new Date(raw+'T00:00:00Z');
    if (!Number.isFinite(+check) || check.toISOString().slice(0,10)!==raw) throw new Error('Use a valid calendar date.');
    return new Date(raw+(end?'T23:59:59.999+05:30':'T00:00:00+05:30')).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) && Number.isFinite(Date.parse(raw))) {
    timeBoundary(raw.slice(0,10));
    return new Date(raw).toISOString();
  }
  throw new Error('Use a calendar date or ISO time with an explicit UTC offset.');
}

export function searchCaseRecords(db,unit,caseId,params,validate) {
  const where=['r.unit=?','r.case_id=?'], values=[unit,caseId];
  for (const [key,clause] of Object.entries({number:'(r.party=? OR r.peer=?)',imei:'r.imei=?',tower:'r.tower=?',ip:'(r.ip=? OR r.dest_ip=?)',protocol:'r.protocol=?',session:'r.session=?',kind:'r.kind=?',port:'r.port=?',operator:'EXISTS (SELECT 1 FROM record_sources s WHERE s.unit=r.unit AND s.case_id=r.case_id AND s.record_id=r.id AND s.operator=?)'})) {
    const v=params.get(key)?.trim();
    if (!v) continue;
    validate(v.length <= 254,'Search filter is too long.');
    const normal=lookupKey(key==='number'&&/^\+?[\d() -]+$/.test(v)?
      v.replace(/[ ()-]/g,'').replace(/^\+91(?=\d{10}$)/,'').replace(/^0091(?=\d{10}$)/,''):v);
    where.push(clause);
    values.push(normal);
    if (key==='number'||key==='ip') values.push(normal);
  }
  let from,to;
  try {
    if (params.get('from')) from=timeBoundary(params.get('from'));
    if (params.get('to')) to=timeBoundary(params.get('to'),true);
  } catch (error) { validate(false,error.message); }
  validate(!from||!to||from<=to,'Start must precede end.');
  if (from) {where.push('r.observed>=?');values.push(from);}
  if (to) {where.push('r.observed<=?');values.push(to);}
  const q=lookupKey(params.get('q')).trim();
  if (q) {
    validate(q.length<=120,'Search text is too long.');
    where.push('(instr(r.id||char(0)||r.kind||char(0)||r.party||char(0)||r.peer||char(0)||r.imei||char(0)||r.tower||char(0)||r.ip||char(0)||r.dest_ip||char(0)||r.protocol||char(0)||r.session,?)>0)');
    values.push(q);
  }
  const limit=Number(params.get('limit')??50),offset=Number(params.get('offset')??0);
  validate(Number.isSafeInteger(limit)&&limit>0&&limit<=200&&Number.isSafeInteger(offset)&&offset>=0,'Use limit 1–200 and non-negative offset.');
  const direction=['oldest','asc'].includes(params.get('sort'))?'ASC':'DESC';
  const conditions=' FROM record_index r WHERE '+where.join(' AND ');
  const total=db.prepare('SELECT count(*) AS total'+conditions).get(...values).total;
  const rows=db.prepare('SELECT data'+conditions+' ORDER BY r.observed '+direction+',r.id '+direction+' LIMIT ? OFFSET ?').all(...values,limit,offset).map(row=>JSON.parse(row.data));
  return {rows,total,limit,offset};
}
