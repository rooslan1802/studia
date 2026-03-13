const path = require('path');
const fs = require('fs');
const os = require('os');

function resolveAuthFolder() {
  try {
    const electron = require('electron');
    const app = electron?.app;
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'auth_info_baileys');
    }
  } catch {
    // fall through to non-electron fallback
  }

  const cwd = process.cwd();
  if (cwd && cwd !== path.parse(cwd).root) {
    return path.join(cwd, 'auth_info_baileys');
  }
  return path.join(os.homedir(), '.studia', 'auth_info_baileys');
}

const AUTH_FOLDER = resolveAuthFolder();

let sock = null;
let connected = false;
let connecting = false;
let qrCodeBase64 = '';
let lastError = '';
let startPromise = null;
let reconnectTimer = null;
let depsPromise = null;

async function loadDeps() {
  if (depsPromise) return depsPromise;

  depsPromise = (async () => {
    try {
      const baileys = await import('@whiskeysockets/baileys');
      const qrcode = await import('qrcode');
      return {
        makeWASocket: baileys.default,
        useMultiFileAuthState: baileys.useMultiFileAuthState,
        fetchLatestBaileysVersion: baileys.fetchLatestBaileysVersion,
        toDataURL: qrcode.toDataURL
      };
    } catch (error) {
      throw new Error('Не найдены пакеты Baileys/Qrcode. Выполните npm install @whiskeysockets/baileys qrcode');
    }
  })();

  return depsPromise;
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) {
    return `7${digits.slice(1)}`;
  }
  if (digits.length === 10) {
    return `7${digits}`;
  }
  return digits;
}

function toJid(phone) {
  const digits = normalizePhone(phone);
  if (!digits) throw new Error('Укажите номер телефона');
  return `${digits}@s.whatsapp.net`;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    start().catch((error) => {
      lastError = error?.message || 'Не удалось переподключиться';
      scheduleReconnect();
    });
  }, 2500);
}

function clearSessionFiles() {
  try {
    fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
  } catch (error) {
    // ignore cleanup errors; next start will attempt to continue
  }
}

async function createSocket() {
  const {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    toDataURL
  } = await loadDeps();

  connecting = true;
  connected = false;
  lastError = '';
  fs.mkdirSync(AUTH_FOLDER, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const latest = await fetchLatestBaileysVersion().catch(() => null);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    browser: ['Studia', 'Electron', '1.0.0'],
    version: latest?.version
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      try {
        qrCodeBase64 = await toDataURL(qr);
      } catch (error) {
        qrCodeBase64 = '';
        lastError = 'Не удалось сгенерировать QR код';
      }
    }

    if (connection === 'open') {
      connected = true;
      connecting = false;
      qrCodeBase64 = '';
      lastError = '';
      return;
    }

    if (connection === 'close') {
      connected = false;
      connecting = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== 401;
      if (statusCode === 401) {
        // Logged out from phone side: reset local auth so next connect generates a fresh QR.
        qrCodeBase64 = '';
        sock = null;
        clearSessionFiles();
      }
      if (shouldReconnect) {
        scheduleReconnect();
      }
    }
  });
}

async function start() {
  if (startPromise) return startPromise;
  if (sock && (connected || connecting)) return;

  startPromise = createSocket()
    .catch((error) => {
      lastError = error?.message || 'Ошибка запуска WhatsApp';
      throw error;
    })
    .finally(() => {
      startPromise = null;
    });

  return startPromise;
}

async function getQr() {
  if (!sock && !connecting) {
    await start();
  }

  if (!connected && !connecting && !qrCodeBase64) {
    await start();
  }

  return qrCodeBase64 || null;
}

function getStatus() {
  return {
    connected,
    connecting,
    error: lastError || null
  };
}

function dataUrlToBuffer(value) {
  const text = String(value || '').trim();
  const m = /^data:image\/[a-zA-Z+]+;base64,(.+)$/.exec(text);
  if (!m) return null;
  return Buffer.from(m[1], 'base64');
}

async function sendMessage(phone, text, imageDataUrl) {
  if (!sock || !connected) {
    throw new Error('WhatsApp не подключен');
  }

  const jid = toJid(phone);
  const bodyText = String(text || '').trim();
  const imageBuffer = dataUrlToBuffer(imageDataUrl);

  if (imageBuffer) {
    return sock.sendMessage(jid, {
      image: imageBuffer,
      caption: bodyText || undefined
    });
  }

  if (!bodyText) throw new Error('Текст сообщения пустой');
  return sock.sendMessage(jid, { text: bodyText });
}

module.exports = {
  start,
  getQr,
  getStatus,
  sendMessage
};
