const intents=['common','direct','tower','device','top','unknown'];
export async function classify(redacted) {
  const model=process.env.TRACEX_OLLAMA_MODEL;
  if(!model || typeof redacted!=='string' || redacted.length>400 || !redacted.trim())return {intent:null};
  try {
    const res=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(60000),
      body:JSON.stringify({model,stream:false,format:{type:'object',properties:{intent:{type:'string',enum:intents}},required:['intent']},options:{temperature:0,num_predict:32,num_ctx:1024},messages:[
        {role:'system',content:'Classify the investigator question. common = common contacts, direct = calls between two subjects, tower = historical tower sequence, device = device or SIM changes, top = frequency ranking. Choose unknown when unsupported. Reply with a JSON intent. You receive question keywords only.'},
        {role:'user',content:redacted}
      ]})});
    if(!res.ok)return {intent:null};
    const label=JSON.parse((await res.json()).message.content).intent;
    return {intent:intents.includes(label)&&label!=='unknown'?label:null};
  }catch{return {intent:null};}
}
