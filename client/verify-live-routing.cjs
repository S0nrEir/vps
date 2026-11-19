// Read-only check of the running Mihomo API plus real CONNECT routing decisions.
// Usage: node client/verify-live-routing.cjs <current Windows named pipe>
const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');
const assert = require('node:assert/strict');
const pipe = process.argv[2] || process.env.MI_PIPE;
const vpsAddress = process.argv[3] || '104.129.181.52';
const vpsPort = Number(process.argv[4] || 8443);
if (!pipe) throw new Error('Pass the current Mihomo control pipe');
function api(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({socketPath:pipe,path}, res => {
      let data='';
      res.setEncoding('utf8');
      res.on('data', chunk => data+=chunk);
      res.on('end', () => {
        try { assert.equal(res.statusCode,200); resolve(JSON.parse(data)); }
        catch(error) { reject(error); }
      });
    });
    req.setTimeout(8000,()=>req.destroy(new Error('API timeout')));
    req.on('error',reject);
  });
}
async function route(host, expected, proxies) {
  const socket=net.createConnection({host:'127.0.0.1',port:7890});
  try {
    await new Promise((resolve,reject)=>{
      let header='';
      socket.setTimeout(15000,()=>socket.destroy(new Error('CONNECT timeout')));
      socket.on('error',reject);
      socket.once('close',()=>reject(new Error(`${host}: closed before CONNECT response`)));
      socket.on('connect',()=>socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`));
      socket.on('data',chunk=>{
        header+=chunk.toString();
        if(header.includes('\r\n\r\n')) {
          if(!/^HTTP\/1\.[01] 200/.test(header)) reject(new Error(`${host}: ${header.split('\r\n')[0]}`));
          else resolve();
        }
      });
    });
    // Send a real TLS ClientHello so sniffing/proxy dialing finishes. Certificate
    // validation stays enabled; no authenticated application data is sent.
    const sourcePort=socket.localPort;
    const secure=tls.connect({socket,servername:host});
    secure.on('error',()=>{});
    let entry, hop;
    const deadline=Date.now()+15000;
    while(Date.now()<deadline) {
      const {connections}=await api('/connections');
      entry=connections.find(c=>Number(c.metadata.sourcePort)===sourcePort && c.metadata.host===host);
      hop=connections.find(c=>c.metadata.destinationIP===vpsAddress &&
        Number(c.metadata.destinationPort)===vpsPort && c.chains?.includes('VPS-Hop') &&
        isAirport(c.chains,proxies));
      if(entry && (expected!=='VPS-ChatGPT' || hop)) break;
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    assert.ok(entry,`No live connection for ${host}`);
    const chains=entry.chains||[];
    if(expected==='VPS-ChatGPT') {
      assert.ok(chains.includes('VPS-ChatGPT'),`${host}: bypassed VPS`);
      assert.ok(hop,`No live VPS-Hop connection to ${vpsAddress}:${vpsPort}`);
    }
    else if(expected==='DIRECT') assert.deepEqual(chains,['DIRECT']);
    else assert.ok(isAirport(chains,proxies),`${host}: expected airport, saw ${chains.join(' / ')}`);
    return {host,rule:entry.rule,rulePayload:entry.rulePayload,chains,
      ...(expected==='VPS-ChatGPT' && {vpsEndpoint:`${vpsAddress}:${vpsPort}`,hopChains:hop.chains})};
  } finally {socket.destroy();}
}
function isAirport(chains,proxies) {
  const outbound=proxies[chains?.[0]];
  return outbound && !outbound.all && !chains.includes('VPS-ChatGPT') &&
    !['Direct','Reject','RejectDrop','Pass','Compatible','Dns'].includes(outbound.type);
}
(async()=>{
  const [config,proxies,rules]=await Promise.all([api('/configs'),api('/proxies'),api('/rules')]);
  assert.equal(config.mode,'rule');
  const hop=proxies.proxies['VPS-Hop'];
  assert.equal(proxies.proxies['VPS-ChatGPT']?.['dialer-proxy'],'VPS-Hop');
  assert.ok(hop?.now && hop.now!=='DIRECT');
  const allRules=rules.rules;
  const company=allRules.findIndex(r=>r.type==='DomainSuffix'&&r.payload==='cyou-inc.com'&&r.proxy==='DIRECT');
  const process=allRules.findIndex(r=>r.type==='ProcessName'&&r.payload==='Codex.exe'&&r.proxy==='VPS-ChatGPT');
  assert.ok(company>=0&&process>company,'Intranet must precede process rules');
  console.log(JSON.stringify({mode:config.mode,tun:config.tun?.enable,hop:hop.now,intranetRuleIndex:company,codexRuleIndex:process}));
  for(const [host,expected] of [
    ['chatgpt.com','VPS-ChatGPT'],['api.openai.com','VPS-ChatGPT'],
    ['www.cloudflare.com','AIRPORT'],['mail.cyou-inc.com','DIRECT'],['www.baidu.com','DIRECT']
  ]) console.log(JSON.stringify(await route(host,expected,proxies.proxies)));
  const {connections}=await api('/connections');
  const protectedDomains=allRules.filter(r=>r.type==='DomainSuffix'&&r.proxy==='VPS-ChatGPT').map(r=>r.payload);
  const protectedConnections=connections.filter(c=>protectedDomains.some(d=>c.metadata.host===d||c.metadata.host?.endsWith('.'+d)));
  const bypass=protectedConnections.filter(c=>!c.chains?.includes('VPS-ChatGPT'));
  const appConnections=protectedConnections.filter(c=>/^(chatgpt|codex)\.exe$/i.test(c.metadata.process));
  assert.equal(bypass.length,0,'Active protected connection bypasses VPS');
  console.log(JSON.stringify({protectedActive:protectedConnections.length,bypass:bypass.length,
    desktopProtectedActive:appConnections.length,apps:[...new Set(appConnections.map(c=>c.metadata.process))]}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
