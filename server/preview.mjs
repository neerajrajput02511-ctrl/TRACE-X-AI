import http from 'node:http';
import {serveStatic} from './static.mjs';
const port=Number(process.env.PORT||4317);
http.createServer((req,res)=>serveStatic(req,res)).listen(port,'127.0.0.1',()=>console.log('TRACE-X preview running at http://127.0.0.1:'+port));

