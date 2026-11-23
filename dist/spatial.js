import {analyze} from './engine.js';
let dispose=[], generation=0;
const onPoint=(action,value)=>{
  const trigger=document.createElement('button');
  trigger.hidden=true;trigger.dataset.action=action;trigger.dataset.value=value;
  document.body.append(trigger);trigger.click();trigger.remove();
};
const layerCss=document.createElement('link');
layerCss.rel='stylesheet';
layerCss.href='./vendor/leaflet.css';

function enhance(stage,label) {
  const diagram=stage.querySelector('svg');
  if(!diagram)return null;
  const container=document.createElement('div');
  container.className='spatial-canvas';
  container.setAttribute('aria-label',label);
  container.style.cssText='width:100%;height:320px;isolation:isolate';
  diagram.after(container);
  diagram.hidden=true;
  diagram.style.display='none';
  const controls=document.createElement('button');
  controls.type='button';controls.className='button small';
  controls.textContent='Switch to keyboard diagram';
  controls.style.margin='8px';
  container.after(controls);
  controls.addEventListener('click',()=>{
    const keyboard=controls.textContent==='Switch to keyboard diagram';
    diagram.style.display=keyboard?'':'none';diagram.hidden=!keyboard;
    container.hidden=keyboard;
    controls.textContent=keyboard?'Switch to interactive chart':'Switch to keyboard diagram';
    if(!keyboard)window.dispatchEvent(new Event('resize'));
  });
  return {container,restore(){container.remove();controls.remove();diagram.hidden=false;diagram.style.display='';}};
}
export function releaseSpatial() {
  generation++;
  for(const clean of dispose.splice(0))clean();
}

const date=d=>d?Date.parse(d+'T00:00:00+05:30'):null;
function inRange(time,from,to) {
  const t=Date.parse(time);
  return (!from||t>=date(from))&&(!to||t<date(to)+86400000);
}
async function contactMap(stage,c,a,state,turn) {
  const {default:cytoscape}=await import('./vendor/cytoscape.js');
  if(turn!==generation||!stage.isConnected)return;
  const filtered=state.networkFrom||state.networkTo ? analyze({...c,records:c.records.filter(r=>inRange(r.time,state.networkFrom,state.networkTo))}):a;
  const focus=state.node||filtered.nodes[0]?.id;
  const neighbors=new Set(filtered.edges.filter(e=>e.source===focus||e.target===focus).flatMap(e=>[e.source,e.target]));
  const nodes=[...filtered.nodes].sort((x,y)=>Number(y.id===focus)-Number(x.id===focus)||Number(neighbors.has(y.id))-Number(neighbors.has(x.id))||y.count-x.count).slice(0,10);
  const ids=new Set(nodes.map(n=>n.id));
  if(!ids.size)return;
  const pane=enhance(stage,'Interactive contact graph. Select connections to open source citations.');
  if(!pane)return;
  const {container}=pane;
  const index=new Map(nodes.map((n,i)=>[n.id,'p'+i]));
  const directions=new Map(c.records.map(r=>[r.id,r.from]));
  const edges=[];
  for(const e of filtered.edges){
    if(!ids.has(e.source)||!ids.has(e.target))continue;
    if(e.forward)edges.push({data:{id:'forward'+edges.length,source:index.get(e.source),target:index.get(e.target),count:e.forward,refs:e.ids.filter(id=>directions.get(id)===e.source)}});
    if(e.reverse)edges.push({data:{id:'reverse'+edges.length,source:index.get(e.target),target:index.get(e.source),count:e.reverse,refs:e.ids.filter(id=>directions.get(id)===e.target)}});
  }
  function addDevices(){
    const seen=new Set();
    for(const d of filtered.devices){
      if(!ids.has(d.subject)||!d.imei||seen.size>=18)continue;
      const key=JSON.stringify([d.subject,d.imei]);
      if(seen.has(key))continue;
      seen.add(key);
      const n='d'+d.imei;
      if(!elements.some(item=>item.data.id===n))elements.push({data:{id:n,label:d.imei,refs:filtered.devices.filter(v=>v.imei===d.imei).map(v=>v.recordId)},classes:'device'});
      edges.push({data:{id:'device'+edges.length,source:index.get(d.subject),target:n,count:1,refs:[d.recordId]},classes:'device-edge'});
    }
  }
  const elements=nodes.map(n=>({data:{id:index.get(n.id),label:n.id,party:n.id},classes:n.id===focus?'focus':''}));
  if(state.view==='network')addDevices();
  let graph;
  try {
    graph=cytoscape({container,elements:[...elements,...edges],layout:{name:'circle',padding:43},minZoom:.35,maxZoom:3,wheelSensitivity:.3,
      style:[
        {selector:'node',style:{'label':'data(label)','color':'#eff7ff','background-color':'#81a7f8','border-width':2,'border-color':'#c4d9ff','font-size':11,'text-valign':'bottom','text-margin-y':4,'width':18,'height':18,'text-outline-color':'#11223f','text-outline-width':2}},
        {selector:'node.focus',style:{'background-color':'#ff9866','border-color':'#ffd3aa','width':24,'height':24}},
        {selector:'node.device',style:{'shape':'round-rectangle','background-color':'#81c1a2','border-color':'#b4e5ce','font-size':9,'width':13,'height':13}},
        {selector:'edge',style:{'curve-style':'bezier','line-color':'#638dcc','width':1.8,'target-arrow-shape':'triangle','target-arrow-color':'#638dcc','arrow-scale':.7}},
        {selector:'edge.device-edge',style:{'line-style':'dashed','target-arrow-shape':'none','line-color':'#81c1a2'}}
      ]});
  }catch{pane.restore();return;}
  graph.on('tap','node',e=>e.target.data('party')?onPoint('node',e.target.data('party')):onPoint('rows',JSON.stringify(e.target.data('refs'))));
  graph.on('tap','edge',e=>onPoint('rows',JSON.stringify(e.target.data('refs'))));
  dispose.push(()=>{graph.destroy();pane.restore()});
}
async function towerMap(stage,a,state,turn) {
  const L=await import('./vendor/leaflet.js');
  if(turn!==generation||!stage.isConnected)return;
  const rows=a.timeline.filter(v=>v.lat!=null&&v.lon!=null&&(!state.towerSubject||v.subject===state.towerSubject)&&inRange(v.time,state.towerFrom,state.towerTo));
  const groups=new Map();
  for(const v of rows){
    if(!groups.has(v.cell))groups.set(v.cell,{...v,ids:[]});
    groups.get(v.cell).ids.push(v.recordId);
  }
  if(!groups.size)return;
  if(!layerCss.isConnected)document.head.append(layerCss);
  const pane=enhance(stage,'Interactive cell tower coordinates. Relative to a geographic grid.');
  if(!pane)return;
  pane.container.style.backgroundImage='linear-gradient(#e6edf8 1px,transparent 1px),linear-gradient(90deg,#e6edf8 1px,transparent 1px)';
  pane.container.style.backgroundSize='30px 30px';
  const map=L.map(pane.container,{scrollWheelZoom:false});
  const positions=[];
  for(const v of [...groups.values()].slice(0,300)){
    positions.push([v.lat,v.lon]);
    const name=document.createElement('span');name.textContent=v.name+' · '+v.ids.length+' record(s)';
    L.circleMarker([v.lat,v.lon],{radius:7,color:'#254bb1',fillColor:'#6fa4ff',fillOpacity:.8})
      .addTo(map).bindTooltip(name).on('click',()=>onPoint('rows',JSON.stringify(v.ids)));
  }
  map.attributionControl.setPrefix('Offline coordinate grid');
  map.fitBounds(positions,{padding:[38,35],maxZoom:15});
  dispose.push(()=>{map.remove();pane.restore()});
}
export function mountSpatial(c,a,state) {
  const turn=generation;
  const network=document.querySelector('.graph-stage'), tower=document.querySelector('.tower-stage');
  if(network)contactMap(network,c,a,state,turn).catch(()=>{});
  if(tower)towerMap(tower,a,state,turn).catch(()=>{});
}
