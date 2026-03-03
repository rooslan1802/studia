const http = require('http');
const { URL } = require('url');
const whatsappBaileys = require('../backend/services/whatsappBaileys');

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.end(JSON.stringify(payload));
}

function startWhatsAppCallbackServer() {
  const backendUrl = String(process.env.BACKEND_URL || '').trim();
  const parsedBackend = backendUrl ? new URL(backendUrl) : null;
  const port = parsedBackend?.port ? Number(parsedBackend.port) : Number(process.env.WHATSAPP_CALLBACK_PORT || 47831);

  const server = http.createServer(async (req, res) => {
    const origin = `http://localhost:${port}`;
    const url = new URL(req.url, origin);

    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/whatsapp/qr') {
      try {
        const qr = await whatsappBaileys.getQr();
        sendJson(res, 200, { qr });
      } catch (error) {
        sendJson(res, 500, { qr: null, error: error?.message || 'qr_error' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/whatsapp/status') {
      try {
        const status = whatsappBaileys.getStatus();
        sendJson(res, 200, { connected: !!status.connected, connecting: !!status.connecting, error: status.error || null });
      } catch (error) {
        sendJson(res, 500, { connected: false, error: error?.message || 'status_error' });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/whatsapp/send') {
      try {
        const body = await parseJsonBody(req);
        const phone = body?.phone;
        const text = body?.text || body?.message;
        const imageDataUrl = body?.imageDataUrl || '';
        const data = await whatsappBaileys.sendMessage(phone, text, imageDataUrl);
        sendJson(res, 200, { success: true, data });
      } catch (error) {
        sendJson(res, 400, { success: false, error: error?.message || 'Ошибка отправки' });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not Found' });
  });

  // Listen on all local interfaces to avoid localhost/127.0.0.1 mismatch in renderer fetch.
  server.listen(port);
  return server;
}

module.exports = { startWhatsAppCallbackServer };
