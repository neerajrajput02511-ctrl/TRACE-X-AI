import * as local from './case-store.js';
const shared = window.TRACEX_TEAM === true;
export async function api(path, options) {
  let response;
  try {
    response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(75000),...options});
  } catch {
    throw new Error('The workspace server could not be reached. Check your connection and retry.');
  }
  if(response.status===401) {
    window.location.replace('./login.html');
    throw new Error('Sign in to the shared workspace.');
  }
  let result;
  try{result=await response.json();}catch{throw new Error('The workspace server returned an unexpected response.');}
  if(!response.ok)throw new Error(result.error || 'The team server could not complete this request.');
  return result;
}
export const jsonRequest=(method,data)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
export const casePath=(id,suffix='')=>'./api/cases/'+encodeURIComponent(id)+suffix;
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

