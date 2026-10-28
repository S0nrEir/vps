// mihomo RESTful API over Windows named pipe (Clash Party -ext-ctl-pipe)
const net = require('net');
const PIPE = process.env.MI_PIPE || '\\\\.\\pipe\\MihomoParty\\mihomo-user-Console-12188';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const s = net.connect(PIPE);
    let buf = Buffer.alloc(0);
    let idle;
    const done = () => { try { s.destroy(); } catch (e) {} resolve(buf.toString('utf8')); };
    s.on('connect', () => {
      const b = body ? JSON.stringify(body) : '';
      const head = `${method} ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(b)}\r\nConnection: close\r\n\r\n`;
      s.write(head + b);
    });
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      clearTimeout(idle);
      idle = setTimeout(done, 800);
    });
    s.on('end', done);
    s.on('error', (e) => { clearTimeout(idle); try { s.destroy(); } catch (e2) {} reject(e); });
    setTimeout(() => { clearTimeout(idle); try { s.destroy(); } catch (e) {} reject(new Error('pipe timeout')); }, 30000);
  });
}

function bodyOf(raw) {
  const i = raw.indexOf('\r\n\r\n');
  let b = raw.slice(i + 4);
  // de-chunk if needed
  if (/Transfer-Encoding:\s*chunked/i.test(raw.slice(0, i))) {
    let out = '', pos = 0;
    while (pos < b.length) {
      const j = b.indexOf('\r\n', pos);
      if (j < 0) break;
      const len = parseInt(b.slice(pos, j), 16);
      if (!len || isNaN(len)) break;
      out += b.slice(j + 2, j + 2 + len);
      pos = j + 2 + len + 2;
    }
    b = out;
  }
  return b;
}

(async () => {
  const cmd = process.argv[2] || 'info';
  if (cmd === 'raw') {
    const p = await req('GET', '/proxies/' + encodeURIComponent(process.argv[3]));
    console.log(JSON.stringify(p.slice(0, 600)));
    return;
  }
  if (cmd === 'vspscan') {
    const group = process.argv[3];
    const names = process.argv.slice(4);
    for (const n of names) {
      await req('PUT', '/proxies/' + encodeURIComponent(group), { name: n });
      const url = encodeURIComponent('https://www.gstatic.com/generate_204');
      const r = await req('GET', `/proxies/VPS-ChatGPT/delay?url=${url}&timeout=6000`);
      const st = r.split('\r\n')[0].replace('HTTP/1.1 ', '');
      console.log(st.replace(' ', ''), '\t', n);
    }
    return;
  }
  if (cmd === 'now') {
    const raw = await req('GET', '/proxies/' + encodeURIComponent(process.argv[3]));
    const m = bodyOf(raw).match(/"now"\s*:\s*"([^"]*)"/);
    console.log(process.argv[3], 'now =', m && m[1]);
    return;
  }
  if (cmd === 'info') {
    const v = await req('GET', '/version');
    console.log('VERSION:', bodyOf(v));
    const c = JSON.parse(bodyOf(await req('GET', '/configs')));
    console.log('mode =', c.mode, ' log-level =', c['log-level']);
  } else if (cmd === 'delay') {
    const url = encodeURIComponent('https://www.gstatic.com/generate_204');
    const g = JSON.parse(bodyOf(await req('GET', `/group/BoostNet/delay?url=${url}&timeout=5000`)));
    const rows = Object.entries(g).sort((a, b) => a[1] - b[1]);
    for (const [n, d] of rows) console.log(String(d).padStart(6), n);
  } else if (cmd === 'node') {
    const name = process.argv[3];
    const url = encodeURIComponent('https://www.gstatic.com/generate_204');
    const r = await req('GET', `/proxies/${encodeURIComponent(name)}/delay?url=${url}&timeout=8000`);
    console.log(name, '->', r.split('\r\n')[0], bodyOf(r));
  } else if (cmd === 'switch') {
    const name = process.argv[3];
    const group = process.argv[4] || 'BoostNet';
    const r = await req('PUT', '/proxies/' + encodeURIComponent(group), { name });
    console.log(group, '->', name, ':', r.split('\r\n')[0]);
  }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
