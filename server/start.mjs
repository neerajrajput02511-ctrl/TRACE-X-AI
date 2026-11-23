import {createTeamServer,openDatabase} from './team.mjs';

const host=process.env.TRACEX_HOST||'127.0.0.1';
const port=Number(process.env.TRACEX_PORT||process.env.PORT||4318);
if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('Provide a port between 1 and 65535.');
const db=openDatabase();
const server=createTeamServer(db);
server.listen(port,host,()=>console.log('TRACE-X team workspace listening on http://'+host+':'+port+'/console.html'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>db.close()));

