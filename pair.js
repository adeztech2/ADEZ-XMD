const fs = require('fs')
const path = require('path')
const readline = require('readline')
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

const DIR = path.join(__dirname, 'tmp', 'pair-cli')

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, answer => {
    rl.close()
    resolve(answer)
  }))
}

async function connect(number) {
  const { state, saveCreds } = await useMultiFileAuthState(DIR)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu(config.botName)
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      await saveCreds()
      await delay(1000)

      const creds = fs.readFileSync(path.join(DIR, 'creds.json'), 'utf8')
      const sessionId = config.botName.replace(/\s+/g, '-') + '_' + Buffer.from(creds).toString('base64')

      console.log('\nConnected! Your SESSION_ID is:\n')
      console.log(sessionId)
      console.log('\nKeep it private. Anyone with it can access this WhatsApp account.')

      sock.end()
      fs.rmSync(path.join(__dirname, 'tmp'), { recursive: true, force: true })
      process.exit(0)
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      // WhatsApp asks for a restart right after linking. Reconnect with the saved credentials.
      if (code === DisconnectReason.restartRequired) return connect(number)
      console.log('Connection closed. Run the script again.')
      process.exit(1)
    }
  })

  if (!state.creds.registered) {
    await delay(3000)
    const pairingCode = await sock.requestPairingCode(number)
    console.log(`\nPairing code: ${pairingCode}`)
    console.log('In WhatsApp: Settings > Linked devices > Link a device > Link with phone number instead\n')
  }
}

async function main() {
  const number = (await ask('WhatsApp number with country code (digits only): ')).replace(/\D/g, '')
  if (number.length < 8) {
    console.log('Invalid number. Example: 2348012345678')
    process.exit(1)
  }

  fs.rmSync(path.join(__dirname, 'tmp'), { recursive: true, force: true })
  await connect(number)
}

main()
