const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const override = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'clash-party-override.js'), 'utf8'), override);
const config = override.main({ rules: ['MATCH,DIRECT'], proxies: [] });
assert.equal(config['find-process-mode'], 'always');
assert.equal(config.rules[0], 'DOMAIN-SUFFIX,cyou-inc.com,DIRECT');
const processIndex = config.rules.indexOf('PROCESS-NAME,ChatGPT.exe,VPS-ChatGPT');
for (const rule of [
  'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
  'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
  'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
  'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
  'IP-CIDR6,fc00::/7,DIRECT,no-resolve',
  'IP-CIDR6,fe80::/10,DIRECT,no-resolve',
  'IP-CIDR6,::1/128,DIRECT,no-resolve'
]) {
  assert.ok(config.rules.indexOf(rule) > 0 && config.rules.indexOf(rule) < processIndex);
}
assert.ok(processIndex < config.rules.indexOf('DOMAIN-SUFFIX,chatgpt.com,VPS-ChatGPT'));
assert.equal(config.rules.at(-1), 'MATCH,DIRECT');

const attempts = [];
const server = new EventEmitter();
server.listen = () => {};
const context = vm.createContext({
  require: name => ({
    net: { connect: dest => {
      attempts.push(dest);
      const socket = new EventEmitter();
      socket.destroy = () => {};
      socket.pipe = () => {};
      socket.write = () => {};
      queueMicrotask(() => socket.emit('error', new Error('simulated upstream loss')));
      return socket;
    } },
    http: { createServer: () => server, request: () => { throw new Error('Unexpected HTTP connection'); } },
    fs: { appendFileSync: () => {} }, path
  }[name]),
  __dirname, URL, setTimeout, clearTimeout, console
});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'proxy-fallback.js'), 'utf8'), context);
const domains = config.rules.filter(x => x.startsWith('DOMAIN-SUFFIX,') && x.endsWith(',VPS-ChatGPT'))
  .map(x => x.split(',')[1]);
for (const host of domains) {
  assert.equal(context.requiresVps(host), true);
  assert.equal(context.requiresVps('SUB.' + host.toUpperCase() + '.'), true);
}
assert.equal(context.requiresVps('chatgpt.com.evil.example'), false);
assert.equal(context.requiresVps('notchatgpt.com'), false);
assert.equal(context.requiresVps('example.com'), false);

async function connect(upstreamHealthy) {
  context.upstreamAlive = () => Promise.resolve(upstreamHealthy);
  attempts.length = 0;
  const client = new EventEmitter();
  let response = '';
  client.end = text => { response += text; };
  client.destroy = () => {};
  context.handleConnect({ url: 'chatgpt.com:443', headers: {} }, client, Buffer.alloc(0));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(response, /502/);
  assert.equal(attempts.length, upstreamHealthy ? 1 : 0);
  assert.ok(attempts.every(x => x.host === '127.0.0.1' && x.port === 7890));
}
(async () => {
  await connect(false);
  await connect(true); // Health probe passed, but the next upstream connection fails.
  context.upstreamAlive = () => Promise.resolve(false);
  let status;
  let body;
  context.handleHttp({ url: 'http://api.openai.com/test' }, {
    writeHead: value => { status = value; }, end: value => { body = value; }
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(status, 502);
  assert.match(body, /direct fallback blocked/);
  console.log('PASS: intranet before process rules, protected-domain parity, HTTPS outage/race, HTTP outage; no direct dial.');
})().catch(error => { console.error(error); process.exitCode = 1; });
