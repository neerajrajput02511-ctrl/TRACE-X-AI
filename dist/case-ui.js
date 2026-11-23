const paths = {
  overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  evidence:'<path d="M5 5h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M7 13h10m-10 3h6"/>',
  network:'<circle cx="5" cy="12" r="2.5"/><circle cx="17" cy="5" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m7.2 10.6 7.7-4.3M7.2 13.2l8.4 3.7m1.5-9.4.6 8"/>',
  towers:'<path d="m2.5 6 6-3 7 3 6-3v15l-6 3-7-3-6 3zM8.5 3v15m7-12v15"/>',
  devices:'<rect x="4" y="3" width="12" height="18" rx="2"/><path d="M9 18h2m8-11 2 2-2 2m0 2 2 2-2 2"/>',
  assistant:'<path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z"/>',
  reports:'<path d="M5 3h9l5 5v13H5z"/><path d="M14 3v6h5M8 13h8m-8 4h6"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  check:'<path d="m4.5 12 5 5L20 6.5"/>',
  case:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12c4 2 14 2 18 0"/>',
  chevron:'<path d="m8 10 4 4 4-4"/>',
  close:'<path d="m6 6 12 12m0-12L6 18"/>',
  pulse:'<path d="M2 13h4l3-8 5 14 3-6h5"/>',
  pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  file:'<path d="M5 3h9l5 5v13H5z"/><path d="M14 3v6h5M8 14h8"/>',
  database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 6v6l4 2"/>',
  plus:'<path d="M12 4v16M4 12h16"/>',
  print:'<path d="M7 8V3h10v5M7 17H4V9h16v8h-3"/><path d="M7 14h10v7H7z"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3-7 8-7s8 3 8 7"/>',
  logo:'<path stroke-width="3.7" d="m3 5 13 14m-6-1 10-14M3 18l3-4m11-4 4-5"/>',
  menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
  compass:'<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  book:'<path d="M2 5q5-2 10 1 5-3 10-1v14q-5-2-10 1-5-3-10-1zm10 1v14"/>',
  send:'<path d="m3 3 18 9-18 9 3-9Zm3 9h15"/>'
};
export function icon(name, size=20) {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
}
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const count = n => Number(n || 0).toLocaleString('en-IN');
export function stamp(date, compact=false) {
  if (!date || Number.isNaN(Date.parse(date))) return 'Unknown time';
  return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',...(compact?{}:{year:'numeric'}),hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(date));
}
export function button(label, action, value='', style='button', image='') {
  return `<button type="button" class="${style}" data-action="${action}" data-value="${esc(value)}">${image?icon(image,16):''}${esc(label)}</button>`;
}
export const empty = (title, body) => `<div class="empty"><strong>${esc(title)}</strong><p>${esc(body)}</p></div>`;
export const head = (title, description, aside='') => `<header class="section-head"><div><h2>${esc(title)}</h2>${description?`<p>${esc(description)}</p>`:''}</div>${aside}</header>`;
export const rowRefs = (ids=[]) => ids.length ? `<div class="citations">${ids.slice(0,5).map(id=>button(id,'row',id,'cite','file')).join('')}${ids.length>5?button('+'+(ids.length-5)+' more','rows',JSON.stringify(ids),'cite'):''}</div>`:'';
export function graph(analysis, focus='') {
  const {edges, nodes}=analysis;
  if (!nodes.length) return empty('No contact network yet','Import CDR evidence to plot the recorded relationships.');
  const order=[...nodes].sort((a,b)=>b.count-a.count || String(a.id).localeCompare(String(b.id)));
  const selected = order.find(n=>String(n.id)===focus);
  const center = selected || order[0];
  const near = new Set(edges.filter(e=>e.source===center.id || e.target===center.id).map(e=>e.source===center.id?e.target:e.source));
  const others=order.filter(n=>n.id!==center.id).sort((a,b)=>Number(near.has(b.id))-Number(near.has(a.id)) || b.count-a.count);
  const visible=[center,...others.slice(0,9)];
  const pos=new Map([[center.id,{x:285,y:148}]]);
  visible.slice(1).forEach((n,i)=>{
    const angle= -Math.PI/2+.19 + i*2*Math.PI/(visible.length-1);
    pos.set(n.id,{x:285+196*Math.cos(angle),y:148+98*Math.sin(angle)});
  });
  const lines = edges.filter(e=>pos.has(e.source)&&pos.has(e.target)).map(e=>{
    const a=pos.get(e.source), b=pos.get(e.target);
    return `<g><title>${esc(e.source)} · ${esc(e.target)} · ${count(e.count)} records</title><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${e.source===center.id||e.target===center.id?'#77a6fd':'#475e88'}" stroke-width="${Math.min(3,1+Math.log1p(e.count)*.5)}" opacity=".83"/></g>`;
  }).join('');
  const marks=visible.map((n,i)=>{
    const p=pos.get(n.id), color=!i?'#ff975b':near.has(n.id)?'#b6d6ff':'#748eba';
    const label=String(n.id), short=label.length>14?label.slice(0,5)+'…'+label.slice(-6):label;
    const labelWidth=Math.max(35,short.length*7.3+14);
    return `<g class="graph-node" tabindex="0" role="button" aria-label="Inspect contact ${esc(n.id)}" data-action="node" data-value="${esc(n.id)}" transform="translate(${p.x} ${p.y})"><title>${esc(n.id)} · ${count(n.count)} records</title><circle r="24" fill="transparent"/><circle r="${i?13:23}" fill="${i?'#2b4775':'#533b36'}" stroke="${color}" stroke-opacity=".55"/><circle r="${i?5:8}" fill="${color}"/><rect x="${-labelWidth/2}" y="${i?15:27}" width="${labelWidth}" height="18" rx="4" fill="#192f51"/><text y="${i?28:40}" text-anchor="middle" fill="#eef5ff" font-size="12" font-family="ui-monospace, monospace">${esc(short)}</text></g>`;
  }).join('');
  return `<div class="graph-stage"><div class="graph-caption"><i></i> CONTACT GRAPH</div><svg viewBox="0 0 570 293" aria-label="Contact network of up to ten parties">${lines}${marks}</svg><span class="graph-count">${visible.length} / ${nodes.length} PARTIES</span></div>`;
}
export function towerPlot(timeline) {
  const valid=timeline.filter(p=>p.lat!=null && p.lon!=null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)));
  if (!valid.length) return empty('No mapped observations','Import a tower list with matching cell IDs and coordinates to plot observations.');
  const unique=Array.from(new Map(valid.map(p=>[String(p.cell),p])).values());
  const lat=unique.map(p=>Number(p.lat)), lon=unique.map(p=>Number(p.lon)), minLat=Math.min(...lat), maxLat=Math.max(...lat), minLon=Math.min(...lon), maxLon=Math.max(...lon);
  const dx=(maxLon-minLon)*Math.max(.01,Math.cos((minLat+maxLat)/2*Math.PI/180)),dy=maxLat-minLat;
  const scale=Math.min(480/Math.max(dx,.00001),200/Math.max(dy,.00001));
  const point=p=>({x:300+(Number(p.lon)-(minLon+maxLon)/2)*Math.max(.01,Math.cos((minLat+maxLat)/2*Math.PI/180))*scale,y:146-(Number(p.lat)-(minLat+maxLat)/2)*scale});
  return `<div class="tower-stage"><span class="map-key">TOWER OBSERVATIONS</span><span class="north">↑ N</span><svg viewBox="0 0 600 290" aria-label="Coordinate plot of observed towers">${unique.map((p,i)=>{
    const {x,y}=point(p);
    return `<g class="graph-node" role="button" tabindex="0" aria-label="Inspect tower ${esc(p.name || p.cell)}" data-action="rows" data-value="${esc(JSON.stringify(valid.filter(r=>r.cell===p.cell).map(r=>r.recordId)))}"><title>${esc(p.name || p.cell)}</title><circle cx="${x}" cy="${y}" r="18" fill="#bad0fc" fill-opacity=".65"/><circle cx="${x}" cy="${y}" r="10" fill="#234eb7"/><text x="${x}" y="${y+4}" text-anchor="middle" font-size="11" fill="#fff">${i+1}</text></g>`;
  }).join('')}</svg><div class="map-legend">${unique.map((p,i)=>`<span><b>${i+1}</b>${esc(p.name || p.cell)}</span>`).join('')}</div></div>`;
}
