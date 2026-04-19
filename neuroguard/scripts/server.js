/**
 * NeuroGuard — Node.js HTTP Server
 * Dashboard + API endpoint'leri
 * Admin yetkisi gerektirmez
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 8777;
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const ACTION_LOG = path.join(DATA_DIR, 'action_log.json');

// Data klasörünü oluştur
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(ACTION_LOG)) {
  fs.writeFileSync(ACTION_LOG, '[]', 'utf8');
}

// MIME types
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ─── Read JSON safely (strips BOM from PowerShell output) ───
function readJSON(filename) {
  const filepath = path.join(DATA_DIR, filename);
  try {
    if (fs.existsSync(filepath)) {
      let content = fs.readFileSync(filepath, 'utf8');
      // Strip UTF-8 BOM that PowerShell adds
      if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
      }
      return content.trim();
    }
  } catch (e) { }
  return filename.endsWith('.json') ? '[]' : '{}';
}

// ─── Write action log ───
function writeActionLog(action, target, result, success) {
  try {
    let log = [];
    if (fs.existsSync(ACTION_LOG)) {
      const content = fs.readFileSync(ACTION_LOG, 'utf8');
      log = JSON.parse(content || '[]');
    }
    log.unshift({
      timestamp: new Date().toLocaleString('tr-TR'),
      action,
      target,
      result,
      success
    });
    if (log.length > 100) log = log.slice(0, 100);
    fs.writeFileSync(ACTION_LOG, JSON.stringify(log), 'utf8');
  } catch (e) { }
}

// ─── Execute PowerShell action ───
function executeAction(actionData) {
  return new Promise((resolve) => {
    let psCommand = '';

    switch (actionData.type) {
      case 'kill':
        psCommand = `Stop-Process -Id ${actionData.pid} -Force -ErrorAction Stop; Write-Output "OK"`;
        break;
      case 'suspend':
        psCommand = `Stop-Process -Id ${actionData.pid} -Force -ErrorAction Stop; Write-Output "OK"`;
        break;
      case 'disable_startup':
        if (actionData.location === 'Registry (Current User)') {
          psCommand = `Remove-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "${actionData.name}" -ErrorAction Stop; Write-Output "OK"`;
        } else if (actionData.location === 'Registry (Local Machine)') {
          psCommand = `Remove-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "${actionData.name}" -ErrorAction Stop; Write-Output "OK"`;
        } else {
          resolve({ success: false, message: 'Desteklenmeyen konum: ' + actionData.location });
          return;
        }
        break;
      case 'clean_temp':
        psCommand = `$before = (Get-ChildItem $env:TEMP -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB; Get-ChildItem $env:TEMP -Recurse -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue; $after = (Get-ChildItem $env:TEMP -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB; $cleaned = [math]::Round($before - $after, 2); Write-Output "CLEANED:$cleaned"`;
        break;
      case 'open_location':
        if (actionData.filePath) {
          const safePath = actionData.filePath.replace(/"/g, '');
          exec(`explorer.exe /select,"${safePath}"`, { timeout: 5000 }, () => {});
          resolve({ success: true, message: `Dosya konumu acildi: ${path.basename(safePath)}` });
        } else if (actionData.directory) {
          const safeDir = actionData.directory.replace(/"/g, '');
          exec(`explorer.exe "${safeDir}"`, { timeout: 5000 }, () => {});
          resolve({ success: true, message: `Klasor acildi: ${safeDir}` });
        } else {
          resolve({ success: false, message: 'Dosya yolu belirtilmedi' });
        }
        return;
      case 'delete_file':
        if (actionData.filePath) {
          const delPath = actionData.filePath.replace(/"/g, '');
          try {
            if (fs.existsSync(delPath)) {
              const stats = fs.statSync(delPath);
              const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
              fs.unlinkSync(delPath);
              resolve({ success: true, message: `${path.basename(delPath)} silindi (${sizeMB} MB serbest)` });
            } else {
              resolve({ success: false, message: 'Dosya bulunamadi' });
            }
          } catch (e) {
            resolve({ success: false, message: 'Silme hatasi: ' + e.message });
          }
        } else {
          resolve({ success: false, message: 'Dosya yolu belirtilmedi' });
        }
        return;
      default:
        resolve({ success: false, message: 'Bilinmeyen islem: ' + actionData.type });
        return;
    }

    exec(`powershell -Command "${psCommand.replace(/"/g, '\\"')}"`, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        const msg = `Hata: ${stderr || error.message}`;
        resolve({ success: false, message: msg });
      } else {
        const out = stdout.trim();
        let msg = '';
        const typeLabels = {
          kill: 'Surecin sonlandirildi',
          suspend: 'Surec durduruldu',
          disable_startup: 'Baslangic programi devre disi birakildi',
          clean_temp: 'Gecici dosyalar temizlendi'
        };

        if (out.startsWith('CLEANED:')) {
          msg = `Gecici dosyalar temizlendi. ${out.split(':')[1]} MB serbest birakildi.`;
        } else {
          msg = `${actionData.name || ''} ${typeLabels[actionData.type] || 'islemi tamamlandi'}.`;
        }
        resolve({ success: true, message: msg });
      }
    });
  });
}

// ─── HTTP Server ───
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // ─── API Routes ───
  if (pathname === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(readJSON('stats.json'));
    return;
  }

  if (pathname === '/api/processes') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(readJSON('processes.json'));
    return;
  }

  if (pathname === '/api/threats') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(readJSON('threats.json'));
    return;
  }

  if (pathname === '/api/startup') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(readJSON('startup.json'));
    return;
  }

  if (pathname === '/api/sysinfo') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(readJSON('sysinfo.json'));
    return;
  }

  if (pathname === '/api/largefiles') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(readJSON('largefiles.json'));
    return;
  }

  if (pathname === '/api/connections') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(readJSON('connections.json'));
    return;
  }

  if (pathname === '/api/actionlog') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    let content = '[]';
    try {
      if (fs.existsSync(ACTION_LOG)) {
        content = fs.readFileSync(ACTION_LOG, 'utf8') || '[]';
      }
    } catch (e) { }
    res.end(content);
    return;
  }

  if (pathname === '/api/action' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const actionData = JSON.parse(body);
        const result = await executeAction(actionData);

        const actionLabels = {
          kill: 'Process Sonlandirma',
          suspend: 'Process Durdurma',
          disable_startup: 'Startup Devre Disi',
          clean_temp: 'Temp Temizleme'
        };

        writeActionLog(
          actionLabels[actionData.type] || actionData.type,
          actionData.name || actionData.type,
          result.message,
          result.success
        );

        console.log(`[ACTION] ${actionData.type} -> ${result.success ? 'OK' : 'FAIL'}: ${result.message}`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, message: 'Gecersiz istek' }));
      }
    });
    return;
  }

  // ─── Static Files ───
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(ROOT_DIR, filePath.replace(/^\//, ''));

  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME[ext] || 'application/octet-stream';

      if (['.html', '.css', '.js', '.json', '.svg'].includes(ext)) {
        const content = fs.readFileSync(filePath, 'utf8');
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      } else {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>404</h1><p>${pathname} bulunamadi</p>`);
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>500</h1><p>Sunucu hatasi</p>`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ╔═════════════════════════════════════════╗');
  console.log('  ║      NEUROGUARD HTTP SERVER             ║');
  console.log(`  ║      http://localhost:${PORT}           ║`);
  console.log('  ║      Ctrl+C ile durdurun                ║');
  console.log('  ╚═════════════════════════════════════════╝');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[ERROR] Port ${PORT} kullanimda! Farkli port deneyin.`);
  } else {
    console.error('[ERROR]', err.message);
  }
});
