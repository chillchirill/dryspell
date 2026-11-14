import {createServer} from 'node:http';
import {createApp} from './app.ts';
import {attachSockets} from './socket.ts';
import {pool} from './db.ts';
const server=createServer(createApp());const sockets=attachSockets(server);const port=Number(process.env.PORT||4000);server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(JSON.stringify({service:'dryspell-web',port,node:process.version})));
let closing=false;async function close(){if(closing)return;closing=true;for(const client of sockets.clients)client.close(1001,'Server restarting');sockets.close();server.close(async()=>{await pool.end();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}process.on('SIGTERM',close);process.on('SIGINT',close);
