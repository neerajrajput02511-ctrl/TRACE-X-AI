import {button,count,empty,esc,head} from './case-ui.js';

export const statusNames={open:'Open',in_review:'In review',closed:'Closed',archived:'Archived'};
const roleNames={investigator:'Investigator',reviewer:'Reviewer',admin:'Admin'};
const opts=(source,current)=>Object.entries(source).map(([id,label])=>`<option value="${esc(id)}" ${id===current?'selected':''}>${esc(label)}</option>`).join('');
const safeDate=(value)=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value:'';
const fields={
  from:'Calling party',to:'Called party',subscriber:'Subscriber',peer:'Other party',
  time:'Timestamp',date:'Date',clock:'Clock time',direction:'Direction',duration:'Duration (seconds)',
  cell:'Cell ID',imei:'IMEI / device ID',imsi:'IMSI / SIM ID',ip:'Public source IP',port:'Source port',
  destinationIp:'Destination IP',destinationPort:'Destination port',protocol:'Transport protocol',end:'Session end',
  session:'Session identifier',service:'Service label from source',name:'Tower name',lat:'Latitude',lon:'Longitude'
};
const offsets={'330':'IST (UTC+05:30)','0':'UTC','345':'UTC+05:45','60':'UTC+01:00','-300':'UTC−05:00'};

export function caseProfile(c,manage) {
  const meta=c.metadata||{}, assignments=c.assignments||[];
  return `<section class="panel gap case-profile">${head('Case details',meta.status==='archived'?'Archived case':'Status, assessment period and access.',manage?`<div class="section-actions">${button(meta.status==='archived'?'Reopen case':'Edit details',meta.status==='archived'?'reopen-case':'edit-case','','button small')}${meta.status==='archived'?'':button('Manage access','assign-case','','button small')}</div>`:'')}
    <dl class="compact-details"><div><dt>Status</dt><dd>${esc(statusNames[meta.status]||'Open')}</dd></div><div><dt>Scoped period (IST)</dt><dd>${esc([safeDate(meta.scopeStart),safeDate(meta.scopeEnd)].filter(Boolean).join(' – ')||'Any time')}</dd></div><div><dt>Investigator</dt><dd>${esc(c.owner||'Device workspace')}</dd></div><div><dt>Assigned accounts</dt><dd>${assignments.length?assignments.map(a=>esc(a.username)+' ('+esc(roleNames[a.role]||a.role)+')').join(', '):'No additional assignees'}</dd></div></dl>
    ${meta.summary?`<div class="case-copy"><h3>Investigation summary</h3><p>${esc(meta.summary)}</p></div>`:''}${meta.notes?`<div class="case-copy"><h3>Case notes</h3><p>${esc(meta.notes)}</p></div>`:''}
  </section>`;
}

export function caseDetailsForm(c) {
  const meta=c.metadata||{};
  return `<form data-form="case-details" class="dialog-form"><p>Update the case summary, investigation status or time scope.</p>
    <label>Status<select name="status" aria-label="Status">${opts(statusNames,meta.status||'open')}</select></label>
    <div class="case-date-grid"><label>Scope start (IST)<input type="date" name="scopeStart" value="${safeDate(meta.scopeStart)}"></label><label>Scope end (IST)<input type="date" name="scopeEnd" value="${safeDate(meta.scopeEnd)}"></label></div>
    <label>Summary<textarea name="summary" rows="3" maxlength="1000">${esc(meta.summary||'')}</textarea></label>
    <label>Notes<textarea name="notes" rows="4" maxlength="12000">${esc(meta.notes||'')}</textarea></label>
    <div class="form-actions">${button('Cancel','close')}<button class="button primary">Save details</button></div>
  </form>`;
}

export function assignmentForm(c, users) {
  const assigned=new Set((c.assignments||[]).map(a=>a.username));
  return `<form data-form="case-assignment" class="dialog-form"><p>Choose the investigators and reviewers who may open this case. The owner and unit admins retain access.</p>
    ${users.filter(u=>u.active!==false && u.username!==c.owner && u.role!=='admin').map(u=>`<label class="assignment-row"><input type="checkbox" name="usernames" value="${esc(u.username)}" ${assigned.has(u.username)?'checked':''}><span><strong>${esc(u.username)}</strong><small>${esc(roleNames[u.role]||u.role)}</small></span></label>`).join('')||'<p>No eligible accounts in this unit.</p>'}
    <div class="form-actions">${button('Cancel','close')}<button class="button primary">Save assignments</button></div>
  </form>`;
}

export function adminPage(users,health,cases) {
  if(users===null)return empty('Opening admin workspace','Fetching unit account and service information.');
  return `<section class="panel"><div class="section-head"><div><h2>Service status</h2><p>Shared workspace and case database</p></div>${button('Refresh','admin-refresh','','button small')}</div>
    <dl class="compact-details"><div><dt>API</dt><dd>${health?.status==='ok'?'Online':'Unavailable'}</dd></div><div><dt>Database schema</dt><dd>${esc(health?.schemaVersion??'—')}</dd></div><div><dt>Active cases</dt><dd>${count(health?.counts?.cases??0)}</dd></div><div><dt>Active accounts</dt><dd>${count(health?.counts?.users??0)}</dd></div></dl></section>
    <section class="panel gap">${head('Unit accounts','Manage investigator, reviewer and admin access.',button('Add user','admin-add','','button primary','plus'))}
    ${users.length?`<div class="table-scroll"><table><thead><tr><th>Username</th><th>Role</th><th>Access</th><th></th></tr></thead><tbody>${users.map(u=>`<tr><td>${esc(u.username)}</td><td>${esc(roleNames[u.role]||u.role)}</td><td>${u.active===false?'Disabled':'Active'}</td><td>${button('Manage','admin-edit',u.username,'text-button')}</td></tr>`).join('')}</tbody></table></div>`:empty('No accounts','Add an investigator or reviewer to this unit.')}</section>
    <section class="panel gap">${head('Unit cases','Open a case to review its access list and activity history.')}${cases.length?`<div class="file-list">${cases.map(c=>`<button class="file-entry" data-action="open-case" data-value="${esc(c.id)}"><span class="file-entry-name"><strong>${esc(c.name)}</strong><small>${esc(c.id)} · ${esc(statusNames[c.metadata?.status]||'Open')}</small></span><span class="file-link">Open</span></button>`).join('')}</div>`:empty('No cases','Create a case to start investigating.')}</section>
    <section class="panel gap">${head('Account activity','Recent access changes in this unit.')}${health?.audit?.length?`<div class="table-scroll"><table><thead><tr><th>Action</th><th>Account</th><th>Performed by</th><th>Recorded (UTC)</th></tr></thead><tbody>${health.audit.map(e=>`<tr><td>${esc(e.action)}</td><td>${esc(e.subject)}</td><td>${esc(e.actor)}</td><td>${esc(e.time)}</td></tr>`).join('')}</tbody></table></div>`:empty('No access changes','Account activity appears here.')}</section>`;
}

export function adminUserForm(user) {
  return `<form data-form="admin-user" class="dialog-form"><label>Username<input name="username" required maxlength="64" value="${esc(user?.username||'')}" ${user?'readonly':'autocomplete="off" pattern="[a-zA-Z0-9_.-]+"'}></label>
    <label>Role<select name="role" aria-label="Role">${opts(roleNames,user?.role||'investigator')}</select></label>
    ${user?`<label class="check-field"><input type="checkbox" name="active" ${user.active===false?'':'checked'}> Account enabled</label>`:'<label>Initial password<input type="password" name="password" required minlength="12" maxlength="512" autocomplete="new-password"></label>'}
    <div class="form-actions">${button('Cancel','close')}<button class="button primary">${user?'Save account':'Create account'}</button></div>
  </form>`;
}

export function importPreview(entries) {
  const ready=entries.filter(e=>e.preview).length;
  return `<form data-form="confirm-import" class="dialog-form"><p>Confirm the mapping from the uploaded headers to TRACE-X fields. Rows shown are an original-data preview. Times with explicit offsets use the source offset.</p>
    ${entries.map((entry,index)=>{
      const {file,preview,error}=entry;
      if(!preview)return `<section class="mapping-file"><h3>${esc(file.name)}</h3><p class="field-error">${esc(error)}</p></section>`;
      const seen=new Set(), validHeaders=new Set(preview.columns.map(c=>c.header).filter((header,ix,arr)=>arr.indexOf(header)===arr.lastIndexOf(header)));
      const allFields=preview.fields||Object.keys(fields);
      return `<section class="mapping-file"><h3>${esc(file.name)}</h3><p>${count(preview.total)} source rows${preview.type?' · '+esc(preview.type):''}${preview.sheet?' · '+esc(preview.sheet):''}</p>
      <label class="time-zone">Default offset <select name="timezone:${index}" aria-label="Default offset for ${esc(file.name)}">${opts(offsets,'330')}</select></label>
      <div class="table-scroll mapping-table"><table><thead><tr><th>Source column</th><th>Normalized field</th><th>First values</th></tr></thead><tbody>${preview.columns.map((column,ix)=>{
          const enabled=validHeaders.has(column.header), selected=enabled&&!seen.has(column.suggestedField)?column.suggestedField:null;
          if(selected)seen.add(selected);
          return `<tr><th scope="row">${esc(column.header||'(blank header)')}</th><td><select ${enabled?'':'disabled'} aria-label="Field for ${esc(column.header||'column '+(ix+1))}" name="map:${index}:${ix}"><option value="">Ignore</option>${allFields.map(field=>`<option value="${esc(field)}" ${selected===field?'selected':''}>${esc(fields[field]||field)}</option>`).join('')}</select></td><td>${preview.rows.map(r=>esc(String(r.values[ix]??'').slice(0,90))).filter(Boolean).join(' · ')||'—'}</td></tr>`;
      }).join('')}</tbody></table></div></section>`;
    }).join('')}
    <div class="form-actions">${button('Choose different files','import')}<button class="button primary" ${ready?'':'disabled'}>Confirm and import</button></div>
  </form>`;
}

export function importOptions(data,entry,index,revision) {
  const columnMap={};
  entry.preview.columns.forEach((column,ix)=>{
    const field=data.get('map:'+index+':'+ix);
    if(!field)return;
    if(Object.hasOwn(columnMap,field))throw new Error(entry.file.name+': map only one column to '+(fields[field]||field)+'.');
    columnMap[field]=column.header;
  });
  return {columnMap,timezoneOffsetMinutes:Number(data.get('timezone:'+index)||330),revision};
}
