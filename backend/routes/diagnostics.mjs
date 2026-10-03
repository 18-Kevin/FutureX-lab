import { Router } from 'express';
import net from 'net';
import tls from 'tls';
import dns from 'dns/promises';
import { emailConfigured } from '../config/email.mjs';

const router = Router();

const HOST = 'smtp.gmail.com';

function waitFor(emitter, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const onErr = (err) => { cleanup(); reject(err); };
    const onEvt = (...args) => { cleanup(); resolve(args); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout waiting for ${event}`)); }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      emitter.off('error', onErr);
      emitter.off(event, onEvt);
    }
    emitter.on('error', onErr);
    emitter.on(event, onEvt);
  });
}

function makeReader(sock) {
  let buf = '';
  const waiters = [];
  const onData = (d) => {
    buf += d.toString('utf8');
    while (waiters.length && findReply(buf)) {
      const w = waiters.shift();
      const { reply, consumed } = findReply(buf);
      buf = buf.slice(consumed);
      clearTimeout(w.timer);
      w.resolve(reply);
    }
  };
  const onErr = (e) => { while (waiters.length) { const w = waiters.shift(); clearTimeout(w.timer); w.reject(e); } };
  const onEnd = () => { const e = new Error('connection closed by server'); while (waiters.length) { const w = waiters.shift(); clearTimeout(w.timer); w.reject(e); } };
  sock.on('data', onData);
  sock.on('error', onErr);
  sock.on('end', onEnd);

  function findReply(b) {
    const lines = b.split('\r\n');
    for (let i = 0; i < lines.length; i++) {
      if (/^\d{3} /.test(lines[i])) {
        const consumed = lines.slice(0, i + 1).reduce((n, l) => n + l.length + 2, 0);
        return { reply: lines.slice(0, i + 1).join(' | '), consumed };
      }
    }
    return null;
  }

  return {
    readReply(timeoutMs = 8000) {
      return new Promise((resolve, reject) => {
        const found = findReply(buf);
        if (found) {
          buf = buf.slice(found.consumed);
          return resolve(found.reply);
        }
        const w = { resolve, reject, timer: null };
        w.timer = setTimeout(() => {
          const idx = waiters.indexOf(w);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error('timeout waiting for SMTP reply'));
        }, timeoutMs);
        waiters.push(w);
      });
    },
    send(line) { sock.write(line); },
    detach() {
      sock.off('data', onData);
      sock.off('error', onErr);
      sock.off('end', onEnd);
    }
  };
}

async function probePort(port) {
  const stages = [];
  let current = 'start';
  let sock = null;
  try {
    current = 'dns';
    const t0 = Date.now();
    await dns.lookup(HOST);
    stages.push({ stage: current, ok: true, ms: Date.now() - t0 });

    let reader;
    if (port === 465) {
      current = 'tls_connect';
      const t1 = Date.now();
      sock = tls.connect({ host: HOST, port, servername: HOST });
      await waitFor(sock, 'secureConnect', 8000);
      stages.push({ stage: current, ok: true, ms: Date.now() - t1 });
      reader = makeReader(sock);
    } else {
      current = 'tcp_connect';
      const t1 = Date.now();
      sock = net.connect({ host: HOST, port });
      await waitFor(sock, 'connect', 8000);
      stages.push({ stage: current, ok: true, ms: Date.now() - t1 });
      reader = makeReader(sock);

      current = 'greeting';
      let r = await reader.readReply();
      stages.push({ stage: current, ok: r.startsWith('220'), reply: r });

      current = 'ehlo';
      reader.send('EHLO futurex.local\r\n');
      r = await reader.readReply();
      stages.push({ stage: current, ok: r.startsWith('250'), reply: r.slice(0, 300) });

      current = 'starttls';
      reader.send('STARTTLS\r\n');
      r = await reader.readReply();
      if (!r.startsWith('220')) throw new Error(`STARTTLS rejected: ${r}`);
      stages.push({ stage: current, ok: true, reply: r });

      reader.detach();
      current = 'tls_upgrade';
      const t2 = Date.now();
      const plain = sock;
      sock = tls.connect({ socket: plain, servername: HOST });
      await waitFor(sock, 'secureConnect', 8000);
      stages.push({ stage: current, ok: true, ms: Date.now() - t2 });
      reader = makeReader(sock);

      current = 'ehlo_after_tls';
      reader.send('EHLO futurex.local\r\n');
      r = await reader.readReply();
      stages.push({ stage: current, ok: r.startsWith('250'), reply: r.slice(0, 300) });
    }

    if (port === 465) {
      current = 'greeting';
      const r = await reader.readReply();
      stages.push({ stage: current, ok: r.startsWith('220'), reply: r });

      current = 'ehlo';
      reader.send('EHLO futurex.local\r\n');
      const r2 = await reader.readReply();
      stages.push({ stage: current, ok: r2.startsWith('250'), reply: r2.slice(0, 300) });
    }

    current = 'auth';
    const user = (process.env.EMAIL_USER || '').trim();
    const pass = (process.env.EMAIL_PASSWORD || '').trim();
    reader.send('AUTH LOGIN\r\n');
    let r = await reader.readReply();
    if (!r.startsWith('334')) throw new Error(`AUTH LOGIN rejected: ${r}`);
    reader.send(Buffer.from(user).toString('base64') + '\r\n');
    r = await reader.readReply();
    if (!r.startsWith('334')) throw new Error(`username rejected: ${r}`);
    reader.send(Buffer.from(pass).toString('base64') + '\r\n');
    r = await reader.readReply();
    const authOk = r.startsWith('235');
    stages.push({ stage: 'auth', ok: authOk, reply: r });
    if (!authOk) throw new Error(`auth failed: ${r}`);

    try { reader.send('QUIT\r\n'); } catch { /* ignore */ }
    return { port, ok: true, stages };
  } catch (err) {
    stages.push({ stage: current, ok: false, error: err.code || err.message });
    return { port, ok: false, stages };
  } finally {
    if (sock) { try { sock.destroy(); } catch { /* ignore */ } }
  }
}

async function brevoCheck() {
  const apiKey = (process.env.BREVO_API_KEY || '').trim();
  if (!apiKey || apiKey.includes('PASTE_') || apiKey.includes('your_brevo')) {
    return { present: false };
  }
  const shape = { present: true, len: apiKey.length, hasPrefix: apiKey.startsWith('xkeysib-') };
  try {
    const res = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': apiKey },
      signal: AbortSignal.timeout(10000)
    });
    const body = await res.text();
    return { ...shape, ok: res.ok, status: res.status, body: body.slice(0, 400) };
  } catch (err) {
    return { ...shape, ok: false, error: err.code || err.message };
  }
}

router.get('/email', async (req, res) => {
  try {
    const result = {
      configured: emailConfigured(),
      host: HOST,
      brevo: await brevoCheck(),
      probes: {}
    };
    if (result.configured) {
      const [p465, p587] = await Promise.all([probePort(465), probePort(587)]);
      result.probes.port465 = p465;
      result.probes.port587 = p587;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
