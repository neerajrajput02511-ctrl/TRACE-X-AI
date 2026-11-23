// A small nearest-neighbour intent classifier runs on device. Its outputs are
// suggested query templates. Only the investigator's confirmed template runs.
const examples = {
  common: ['who did both parties call','who did personone and persontwo both call','who is in touch with both','who appears on both call lists','which numbers overlap between two phone lists','common callers for personone and persontwo','contacts in common','dono ke common numbers batao','dono ne kisko phone kiya','same contact on both phones'],
  direct: ['is there a call between personone and persontwo','did these two ever speak on the phone','any direct communication between the two','any calls connecting personone and persontwo','did they speak to each other','aapas mein call hua kya','dono ke beech call'],
  top: ['which numbers appear most often','who called most frequently','rank contacts by number of calls','list the busiest callers','who spoke the most','most active numbers','sabse zyada call kisko kiya','top contact batao'],
  tower: ['which towers were recorded for personone','tower locations in order','show the cell sites for personone','where was the phone seen by a tower','list tower observations over time','tower sequence for personone','tower ki list dikhao','kin towers par record mila'],
  device: ['did the handset identifier change','did the phone change sims','find sim swaps','any handset switches for personone','show changes in imei and imsi','when did personone switch devices','phone ka imei badla kya','sim badla ya nahi']
};
const blocked=/\b(?:guilty|criminal|culprit|address|arrest|intercept|track live|murder|crime|intent|content of|recording|password)\b/i;
const normalize=s=>s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').trim().split(/\s+/).filter(Boolean);
const stops=new Set('the a an is are did do was were of for and to in on me these this they any show personone persontwo'.split(' '));
function vector(text) { const set=new Set(normalize(text).filter(t=>!stops.has(t)));return set; }
const corpus=Object.entries(examples).flatMap(([intent,items])=>items.map(item=>({intent,v:vector(item)})));
const allowedWords=new Set(Object.values(examples).flat().flatMap(normalize).concat('contacts asked frequent common subscribers possible please get phone direct shared network phone log chronological duration records logged link shared number mobile towers device timeline changed with who which daily what how whether caller incoming outgoing ka kya kya hai mein aur dono mujhe'.split(' ')));
function nearest(masked) {
  const query=vector(masked),scores={};
  if(!query.size)return null;
  for(const {intent,v} of corpus) {
    const intersection=[...v].filter(t=>query.has(t)).length;
    const score=intersection/Math.sqrt(query.size*v.size);
    scores[intent]=Math.max(scores[intent]||0,score);
  }
  const sorted=Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  return sorted[0][1]>=.45 && sorted[0][1]-sorted[1][1]>.09 ? sorted[0][0]:null;
}
function template(intent,ids) {
  const [a,b]=ids;
  if(intent==='common'&&ids.length===2)return 'Which contacts do '+a+' and '+b+' share?';
  if(intent==='direct'&&ids.length===2)return 'Find direct calls between '+a+' and '+b;
  if(intent==='top'&&ids.length<2)return 'Show top contacts'+(a?' for '+a:'');
  if(intent==='tower'&&ids.length===1)return 'Show tower timeline for '+a;
  if(intent==='device'&&ids.length===1)return 'Show device changes for '+a;
  return null;
}
export async function routeQuestion(c,question){
  if(typeof question!=='string'||!c.records?.length||question.length>400||blocked.test(question))return null;
  const known=new Map(c.records.flatMap(r=>[r.from,r.to,r.observer]).filter(Boolean).map(id=>[id.toUpperCase(),id]));
  const ids=[];
  const masked=question.replace(/[\p{L}\p{N}_+.-]+/gu,word=>{
    const id=known.get(word.toUpperCase().replace(/[.]+$/,''));
    if(!id) return word;
    // A lower-case article is common English. Single-letter aliases are upper-case in the case.
    if(id==='A' && word==='a')return word;
    if(!ids.includes(id))ids.push(id);
    return ['personone','persontwo'][ids.indexOf(id)]||'party';
  });
  if(ids.length>2)return null;
  const filtered=normalize(masked).filter(word=>allowedWords.has(word)).join(' ');
  const local=template(nearest(masked),ids);
  if(local)return local;
  if(!globalThis.TRACEX_TEAM||!filtered)return null;
  try{
    const result=await fetch('./api/intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maskedQuestion:filtered}),signal:AbortSignal.timeout(65000)});
    if(!result.ok)return null;
    return template((await result.json()).intent,ids);
  }catch{return null;}
}
