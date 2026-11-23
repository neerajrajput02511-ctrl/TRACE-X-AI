import * as local from './case-store.js';
const shared = window.TRACEX_TEAM === true;
async function api(path, options) {
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
  if(response.status===401) {
    window.location.replace('./login.html');
    throw new Error('Sign in to the shared workspace.');
  }
  const result=await response.json();
  if(!response.ok) throw new Error(result.error || 'The team server could not save this request.');
  return result;
}
export async function listCases() {
  if(!shared) return local.listCases();
  window.traceSession=await api('./api/session');
  return api('./api/cases');
}
export async function saveCase(item) {
  if(!shared) return local.saveCase(item);
  const updated=await api('./api/cases/'+encodeURIComponent(item.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)});
  Object.assign(item,updated);
  return item;
}

