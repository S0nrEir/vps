// proxy-fallback.js — 本地自适应转发代理
// 监听 127.0.0.1:7899；上游 127.0.0.1:7890 不可用时仅非保护域名可直连。
// ChatGPT/OpenAI 及其辅助域名禁止降级直连；其他应用保留原行为。
'use strict';
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');

const LISTEN_HOST = '127.0.0.1';
const LISTEN_PORT = 7899;
const UP_HOST = '127.0.0.1';
const UP_PORT = 7890;
const HEALTH_TTL_MS = 3000;   // 健康状态缓存
const UP_PROBE_TIMEOUT_MS = 600;
const VPS_ONLY_DOMAINS = [
  'chatgpt.com', 'chatgpt.site', 'chatgpt-team.site', 'openai.com',
  'oaistatic.com', 'oaistatsig.com', 'oaiusercontent.com', 'sora.com',
  'openaiapi-site.azureedge.net', 'auth0.com', 'livekit.cloud',
  'challenges.cloudflare.com', 'featuregates.org', 'statsig.com'
];
function requiresVps(host) {
  host = host.toLowerCase().replace(/\.+$/, '');
  return VPS_ONLY_DOMAINS.some(domain => host === domain || host.endsWith('.' + domain));
}

const LOG = path.join(__dirname, 'proxy-fallback.log');
function log(msg) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch (_) {}
}

// ---------- 上游健康检查 ----------
let upOk = false;
let upCheckedAt = 0;
let probing = null;

function upstreamAlive() {
  return new Promise((resolve) => {
    if (Date.now() - upCheckedAt < HEALTH_TTL_MS) return resolve(upOk);
    if (probing) return probing.then(() => resolve(upOk));
    probing = new Promise((done) => {
      let settled = false;
      const sock = net.connect({ host: UP_HOST, port: UP_PORT });
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.destroy();
        if (ok !== upOk) log(`upstream ${UP_HOST}:${UP_PORT} ${ok ? 'UP -> chained' : 'DOWN -> protected domains blocked; others direct'}`);
        upOk = ok;
        upCheckedAt = Date.now();
        probing = null;
        done();
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), UP_PROBE_TIMEOUT_MS);
      sock.once('connect', () => finish(true));
      sock.once('error', () => finish(false));
    });
  });
}

// ---------- HTTPS CONNECT 隧道 ----------
function handleConnect(req, client, head) {
  const target = req.url; // host:port
  const vpsOnly = requiresVps(parseHostPort(target, 443).host);
  let ended = false;
  const cleanup = () => { if (!ended) { ended = true; client.destroy(); } };

  function attempt(useUpstream, retryDirect) {
    const dest = useUpstream
      ? { host: UP_HOST, port: UP_PORT }
      : parseHostPort(target, 443);

    const sock = net.connect(dest);
    const timer = setTimeout(() => { sock.destroy(); }, 10000); // 建立连接超时

    sock.once('connect', () => {
      clearTimeout(timer);
      if (useUpstream) {
        // 原样向上游转发 CONNECT 请求,之后纯字节中继
        let headReq = `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n`;
        for (const [k, v] of Object.entries(req.headers)) {
          if (k.toLowerCase() === 'host') continue;
          headReq += `${k}: ${v}\r\n`;
        }
        headReq += '\r\n';
        sock.write(headReq);
      } else {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      }
      if (head && head.length) sock.write(head);
      sock.pipe(client);
      client.pipe(sock);
    });

    sock.once('error', (err) => {
      clearTimeout(timer);
      if (retryDirect && useUpstream) {
        sock.destroy();
        attempt(false, false); // 上游刚死掉:降级直连
      } else {
        if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        sock.destroy();
        cleanup();
      }
    });

    client.once('error', () => { clearTimeout(timer); sock.destroy(); cleanup(); });
    sock.once('close', cleanup);
  }

  upstreamAlive().then((ok) => {
    if (!ok && vpsOnly) {
      client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\nVPS proxy unavailable; direct fallback blocked.');
      return;
    }
    attempt(ok, !vpsOnly);
  });
}

function parseHostPort(s, defPort) {
  const i = s.lastIndexOf(':');
  if (i === -1) return { host: s, port: defPort };
  // IPv6 字面量 [::1]:443
  if (s.startsWith('[')) {
    const close = s.indexOf(']');
    return { host: s.slice(1, close), port: Number(s.slice(close + 2)) || defPort };
  }
  return { host: s.slice(0, i), port: Number(s.slice(i + 1)) || defPort };
}

// ---------- 普通 HTTP 代理请求(absolute-form) ----------
function handleHttp(req, res) {
  let u;
  try { u = new URL(req.url); } catch (_) { res.writeHead(400); return res.end('bad proxy target'); }
  upstreamAlive().then((ok) => {
    if (ok) {
      const upReq = http.request(
        { host: UP_HOST, port: UP_PORT, method: req.method, path: req.url, headers: req.headers },
        (upRes) => { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res); }
      );
      upReq.once('error', () => { try { res.writeHead(502); res.end('upstream error'); } catch (_) {} });
      req.pipe(upReq);
    } else {
      if (requiresVps(u.hostname)) {
        res.writeHead(502);
        return res.end('VPS proxy unavailable; direct fallback blocked.');
      }
      const headers = { ...req.headers, host: u.host };
      delete headers['proxy-connection'];
      const dirReq = http.request(
        { host: u.hostname, port: Number(u.port) || 80, method: req.method, path: u.pathname + u.search, headers },
        (dirRes) => { res.writeHead(dirRes.statusCode, dirRes.headers); dirRes.pipe(res); }
      );
      dirReq.once('error', () => { try { res.writeHead(502); res.end('direct error'); } catch (_) {} });
      req.pipe(dirReq);
    }
  });
}

const server = http.createServer(handleHttp);
server.on('connect', handleConnect);
server.on('clientError', (err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (_) {}
});

server.once('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // 已有实例占用端口,静默退出(由 supervisor 循环兜底)
    process.exit(0);
  }
  log(`fatal: ${err.message}`);
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log(`listening on ${LISTEN_HOST}:${LISTEN_PORT}, upstream ${UP_HOST}:${UP_PORT} (protected domains: no direct fallback)`);
});
