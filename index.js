const fs = require('fs')
const path = require('path')
const pino = require('pino')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys')
const config = require('./config')
const { handleCommand } = require('./main')

const SESSION_DIR = path.join(__dirname, 'session')

// Restore the login from the SESSION_ID environment variable on first start
function restoreSession() {
  const id = process.env.SESSION_ID
  if (!id) return
  const file = path.join(SESSION_DIR, 'creds.json')
  if (fs.existsSync(file)) return

  const raw = id.replace(/^[^_]+_/, '')
  fs.mkdirSync(SESSION_DIR, { recursive: true })
  fs.writeFileSync(file, Buffer.from(raw, 'base64').toString('utf8'))
  console.log('Session restored from SESSION_ID')
}

async function start() {
  restoreSession()

  if (!fs.existsSync(path.join(SESSION_DIR, 'creds.json'))) {
    console.log('No session found. Set SESSION_ID or open the pairing page (npm run pair).')
    return
  }

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)
  const sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }) })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code !== DisconnectReason.loggedOut) start()
      else console.log('Logged out. Generate a new SESSION_ID from the pairing page.')
    } else if (connection === 'open') {
      console.log(`${config.botName} connected`)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return
    await handleCommand(sock, msg)
  })
}

start()
