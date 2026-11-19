const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const yts = require('yt-search');
const youtubedl = require('youtube-dl-exec');
const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Music Bot is Running 24/7!'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

const DB_FILE = './library.json';
let library = { songs: [], playlists: { 'מועדפים': [] } };
if (fs.existsSync(DB_FILE)) {
    library = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(library, null, 2));

function generateLibraryHTML() {
    const songsJSON = JSON.stringify(library.songs);
    return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>הספרייה שלי - YouTube Music</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f0f0f; color: #fff; margin: 0; padding: 16px; }
  h1 { font-size: 22px; color: #ff0000; display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .song-list { list-style: none; padding: 0; margin: 0 0 80px 0; }
  .song-item { background: #1e1e1e; margin-bottom: 10px; padding: 12px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #333; }
  .song-info { display: flex; flex-direction: column; gap: 4px; max-width: 65%; }
  .song-title { font-weight: bold; font-size: 15px; }
  .song-num { color: #aaa; font-size: 12px; }
  .controls { display: flex; gap: 6px; }
  button { background: #333; color: #fff; border: none; padding: 8px 10px; border-radius: 6px; font-size: 14px; cursor: pointer; }
  button.del { background: #5c1919; color: #ff8a8a; }
  .footer-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #181818; padding: 14px; border-top: 1px solid #333; display: flex; justify-content: center; }
  .save-btn { background: #ff0000; color: #fff; font-weight: bold; font-size: 16px; width: 100%; max-width: 400px; padding: 12px; border-radius: 25px; }
</style>
</head>
<body>
  <h1>🎵 הספרייה האישית שלי</h1>
  <p style="color:#aaa; font-size:13px;">סדר את השירים עם החצים, מחק מה שלא צריך, ולחץ למטה להעתקת הסידור לוואטסאפ:</p>
  <ul class="song-list" id="list"></ul>
  <div class="footer-bar">
    <button class="save-btn" onclick="copyOrder()">📋 העתק סידור חדש לוואטסאפ</button>
  </div>
<script>
  let songs = ${songsJSON};
  function render() {
    const list = document.getElementById('list');
    list.innerHTML = '';
    songs.forEach((s, idx) => {
      const li = document.createElement('li');
      li.className = 'song-item';
      li.innerHTML = \`
        <div class="song-info">
          <span class="song-num">#\${idx + 1}</span>
          <span class="song-title">\${s.title}</span>
        </div>
        <div class="controls">
          <button onclick="move(\${idx}, -1)">⬆️</button>
          <button onclick="move(\${idx}, 1)">⬇️</button>
          <button class="del" onclick="remove(\${idx})">🗑️</button>
        </div>\`;
      list.appendChild(li);
    });
  }
  function move(idx, dir) {
    if (idx + dir < 0 || idx + dir >= songs.length) return;
    const temp = songs[idx];
    songs[idx] = songs[idx + dir];
    songs[idx + dir] = temp;
    render();
  }
  function remove(idx) {
    songs.splice(idx, 1);
    render();
  }
  function copyOrder() {
    const ids = songs.map(s => s.id).join(',');
    const cmd = '!עדכן_סדר ' + ids;
    navigator.clipboard.writeText(cmd).then(() => {
      alert('✅ הסידור הועתק!\\nעכשיו חזור לוואטסאפ, הדבק ושלח לבוט.');
    });
  }
  render();
</script>
</body>
</html>`;
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('\n=== SCAN THIS QR CODE WITH WHATSAPP ===\n');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ Bot connected successfully to WhatsApp!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || !msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        const myNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        if (remoteJid !== myNumber) return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        if (!text.startsWith('!')) return;

        if (text.startsWith('!שיר ')) {
            const query = text.replace('!שיר ', '').trim();
            if (!query) return;

            await sock.sendMessage(remoteJid, { text: `⏳ מחפש ומוריד: *${query}*...` });
            try {
                const search = await yts(query);
                const video = search.videos[0];
                if (!video) {
                    return await sock.sendMessage(remoteJid, { text: '❌ לא נמצא שיר כזה ביוטיוב.' });
                }

                const songId = Date.now().toString().slice(-5);
                const filePath = path.join(__dirname, `${songId}.mp3`);

                await youtubedl(video.url, {
                    extractAudio: true,
                    audioFormat: 'mp3',
                    output: filePath,
                    noPlaylist: true
                });

                await sock.sendMessage(remoteJid, {
                    audio: fs.readFileSync(filePath),
                    mimetype: 'audio/mp4',
                    fileName: `${video.title}.mp3`
                });

                library.songs.push({ id: songId, title: video.title, url: video.url });
                saveDB();
                fs.unlinkSync(filePath);

                await sock.sendMessage(remoteJid, {
                    text: `✅ *${video.title}* נשמר בספרייה שלך!\nלפתיחת הספרייה שלח: *!ספריה*`
                });
            } catch (err) {
                console.error(err);
                await sock.sendMessage(remoteJid, { text: '❌ אירעה שגיאה בהורדת השיר. נסה שוב.' });
            }
        }

        else if (text === '!ספריה') {
            const htmlContent = generateLibraryHTML();
            const htmlPath = path.join(__dirname, 'MyMusic.html');
            fs.writeFileSync(htmlPath, htmlContent);

            await sock.sendMessage(remoteJid, {
                document: fs.readFileSync(htmlPath),
                mimetype: 'text/html',
                fileName: 'MyMusic.html',
                caption: '🎵 הנה הספרייה שלך! לחץ על הקובץ כדי לפתוח, לסדר ולהעתיק סידור חדש.'
            });
            fs.unlinkSync(htmlPath);
        }

        else if (text.startsWith('!עדכן_סדר ')) {
            const ids = text.replace('!עדכן_סדר ', '').trim().split(',');
            const newOrder = [];
            ids.forEach(id => {
                const found = library.songs.find(s => s.id === id);
                if (found) newOrder.push(found);
            });
            library.songs = newOrder;
            saveDB();
            await sock.sendMessage(remoteJid, { text: '✅ הספרייה עודכנה לפי הסדר החדש שקבעת!' });
        }

        else if (text.startsWith('!נגן ')) {
            const num = parseInt(text.replace('!נגן ', '').trim()) - 1;
            const song = library.songs[num];
            if (!song) return await sock.sendMessage(remoteJid, { text: '❌ מספר שיר לא קיים בספרייה.' });

            await sock.sendMessage(remoteJid, { text: `▶️ מנגן מהספרייה: *${song.title}*...` });
            const filePath = path.join(__dirname, `${song.id}.mp3`);
            await youtubedl(song.url, { extractAudio: true, audioFormat: 'mp3', output: filePath });
            await sock.sendMessage(remoteJid, {
                audio: fs.readFileSync(filePath),
                mimetype: 'audio/mp4',
                fileName: `${song.title}.mp3`
            });
            fs.unlinkSync(filePath);
        }
    });
}
