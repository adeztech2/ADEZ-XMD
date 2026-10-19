module.exports = {
  name: 'ping',
  description: 'Check that the bot is alive',
  async run(sock, msg) {
    await sock.sendMessage(msg.key.remoteJid, { text: 'Pong!' }, { quoted: msg })
  }
}
