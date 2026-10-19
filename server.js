const express = require('express')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const pino = require('pino')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  delay
} = require('@whiskeysockets/baileys')
const config = require('./config')

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const TMP = path.join(__dirname, 'tmp')
const jobs = new Map()
const EXPIRE_MS = 5 * 60 * 1000

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pair.html')))

app.post('/api/pair', async (req, res) => {
  const number = String(req.body.number || '').replace(/\D/g, '')
  if (number.length < 8) {
    return res.status(400).json({ error: 'Enter your number with country code, e.g. 2348012345678' })
  }

  const id = crypto.randomUUID()
  const job = {
    number,
    dir: path.join(TMP, id),
    status: 'starting',
    code: null,
    sessionId: null,
    error: null
  }
  jobs.set(id, job)

  openSocket(job).catch(err => {
    job.status = 'error'
    job.error = err.message
  })

  setTimeout(() => {
    if (job.status !== 'connected') {
      job.status = 'expired'
      job.error = 'Pairing expired. Please try again.'
    }
    fs.rmSync(job.dir, { recursive: true, force: true })
    jobs.delete(id)
  }, EXPIRE_MS)

  res.json({ id })
})

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job) return res.status(404).json({ status: 'error', error: 'Unknown or expired request.' })
  res.json({
    status: job.status,
    code: job.code,
    sessionId: job.sessionId,
    error: job.error
  })
})

async function openSocket(job) {
  const { state, saveCreds } = await useMultiFileAuthState(job.dir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu(config.botName)
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open' && job.status !== 'connected') {
      await saveCreds()
      const creds = fs.readFileSync(path.join(job.dir, 'creds.json'), 'utf8')
      job.sessionId = config.botName.replace(/\s+/g, '-') + '_' + Buffer.from(creds).toString('base64')
      job.status = 'connected'
      try { sock.end() } catch {}
      fs.rmSync(job.dir, { recursive: true, force: true })
    }

    if (connection === 'close' && job.status !== 'connected') {
      const code = lastDisconnect?.error?.output?.statusCode
      // WhatsApp asks for a restart right after a successful link. Reconnect with the same credentials.
      if (code === DisconnectReason.restartRequired) return openSocket(job)
      job.status = 'error'
      job.error = 'Connection closed. Please try again.'
    }
  })

  if (!state.creds.registered && !job.code) {
    await delay(3000)
    job.code = await sock.requestPairingCode(job.number)
    job.status = 'waiting'
  }
}

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Pairing page running on port ${PORT}`))
