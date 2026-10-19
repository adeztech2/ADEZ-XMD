const fs = require('fs')
const path = require('path')
const config = require('./config')

const commands = new Map()
const dir = path.join(__dirname, 'commands')
for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith('.js')) continue
  const cmd = require(path.join(dir, file))
  commands.set(cmd.name, cmd)
}

async function handleCommand(sock, msg) {
  const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
  if (!text.startsWith(config.prefix)) return

  const name = text.slice(config.prefix.length).trim().split(/\s+/)[0].toLowerCase()
  const cmd = commands.get(name)
  if (cmd) await cmd.run(sock, msg)
}

module.exports = { handleCommand }
