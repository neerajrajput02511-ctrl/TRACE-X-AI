const intents=['common','direct','tower','device','top','unknown'];
const vocabulary=new Set(('personone persontwo who did both parties call and is in touch with appears on lists which numbers overlap between two phone common callers for contacts dono ke batao ne kisko kiya same contact phones there these ever speak the any direct communication calls connecting they to each other aapas mein hua kya beech appear most often called frequently rank by number list busiest spoke active sabse zyada top towers were recorded tower locations order show cell sites where was seen a observations over time sequence ki dikhao kin par record mila handset identifier change sims find sim swaps switches changes imei imsi when switch devices ka badla ya nahi asked frequent subscribers possible please get shared network log chronological duration records logged link mobile device timeline changed daily what how whether caller incoming outgoing hai aur mujhe').split(' '));
export function safeIntentText(input){
  return input.toLowerCase().split(/\s+/).filter(word=>vocabulary.has(word)).join(' ');
}
export async function classify(redacted) {
  const model=process.env.TRACEX_OLLAMA_MODEL;
  if(!model || typeof redacted!=='string' || redacted.length>400 || !redacted.trim())return {intent:null};
  const keywords=safeIntentText(redacted);
  if(!keywords)return {intent:null};
  try {
    const res=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(60000),
      body:JSON.stringify({model,stream:false,format:{type:'object',properties:{intent:{type:'string',enum:intents}},required:['intent']},options:{temperature:0,num_predict:32,num_ctx:1024},messages:[
        {role:'system',content:'Classify the investigator question. common = common contacts, direct = calls between two subjects, tower = historical tower sequence, device = device or SIM changes, top = frequency ranking. Choose unknown when unsupported. Reply with a JSON intent. You receive question keywords only.'},
        {role:'user',content:keywords}
      ]})});
    if(!res.ok)return {intent:null};
    const label=JSON.parse((await res.json()).message.content).intent;
    return {intent:intents.includes(label)&&label!=='unknown'?label:null};
  }catch{return {intent:null};}
}
