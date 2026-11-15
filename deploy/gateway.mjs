// One public HTTP/WS port; Python remains private. Render terminates HTTPS/WSS.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {WebSocket,WebSocketServer} from 'ws';

const port=Number(process.env.PORT||10000), backendPort=Number(process.env.BACKEND_PORT||9000);
const upstream=process.env.TELEMETRY_UPSTREAM||'ws://51.68.199.185:2500/ws';
const parsed=new URL(upstream);
if(!['ws:','wss:'].includes(parsed.protocol))throw new Error('Invalid telemetry upstream protocol');
const child=spawn(process.env.PYTHON_BIN||'python',[fileURLToPath(new URL('./serve.py',import.meta.url))],
  {env:{...process.env,BACKEND_PORT:String(backendPort)},stdio:'inherit',windowsHide:true});
const server=http.createServer((req,res)=>{
  if(!req.url.startsWith('/')||req.url.startsWith('//')){res.writeHead(400);res.end();return;}
  const proxy=http.request({hostname:'127.0.0.1',port:backendPort,path:req.url,method:req.method,
    headers:{...req.headers,host:'127.0.0.1:'+backendPort}},reply=>{
      res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);
    });
  proxy.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Server is starting; retry shortly"}');});
  proxy.setTimeout(100000,()=>proxy.destroy());
  res.on('close',()=>proxy.destroy());req.pipe(proxy);
});
const sockets=new WebSocketServer({noServer:true,maxPayload:262144});
const upstreams=new Set();
server.on('upgrade',(req,socket,head)=>{
  let allowed=req.url==='/ws/telemetry';
  try{if(req.headers.origin)allowed&&=new URL(req.headers.origin).host===req.headers.host;}catch{allowed=false;}
  if(!allowed){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  if(sockets.clients.size>=30){socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');return;}
  sockets.handleUpgrade(req,socket,head,client=>{
    const feed=new WebSocket(upstream,{handshakeTimeout:10000,maxPayload:262144});upstreams.add(feed);
    feed.on('message',(message,binary)=>{
      if(client.readyState===WebSocket.OPEN&&!binary){
        if(client.bufferedAmount>1048576){client.close(1013,'Slow connection');return;}
        client.send(message.toString());
      }
    });
    feed.on('error',()=>client.close(1011,'Controller receiver unavailable'));
    feed.on('close',()=>{upstreams.delete(feed);client.close(1012,'Controller receiver disconnected');});
    client.on('close',()=>feed.terminate());client.on('error',()=>feed.terminate());
    // Deliberately do not forward browser messages to the hardware receiver.
  });
});
let stopping=false;
function stop(code=0){
  if(stopping)return;stopping=true;
  for(const feed of upstreams)feed.terminate();for(const client of sockets.clients)client.terminate();
  child.kill();server.close(()=>process.exit(code));setTimeout(()=>process.exit(code),5000).unref();
}
child.on('error',()=>{console.error('Python backend could not start');stop(1);});
child.on('exit',code=>{if(!stopping)stop(code||1);});
server.on('error',()=>{console.error('Public HTTP port unavailable');stop(1);});
process.on('SIGTERM',()=>stop());process.on('SIGINT',()=>stop());
server.listen(port,'0.0.0.0',()=>console.log('DrySpell gateway listening on port '+port));
export {stop as shutdown};
