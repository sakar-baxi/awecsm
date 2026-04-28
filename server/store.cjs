const fs = require('fs');
const path = require('path');

let DATA_DIR = path.join(__dirname, 'data');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

try {
  // First attempt: use local dir (works locally)
  ensureDir(DATA_DIR);
} catch (err) {
  // Second attempt: use /tmp (required for Vercel)
  console.warn('Local data dir failed, falling back to /tmp/data');
  DATA_DIR = path.join('/tmp', 'data');
  try {
    ensureDir(DATA_DIR);
  } catch (err2) {
    console.error('CRITICAL: Failed to create ANY data directory:', err2);
  }
}

function getFilePath(name) {
  return path.join(DATA_DIR, name + '.json');
}

function read(name) {
  const file = getFilePath(name);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function write(name, data) {
  fs.writeFileSync(getFilePath(name), JSON.stringify(data, null, 2));
}

function append(name, item) {
  const data = read(name);
  data.push(item);
  write(name, data);
}

module.exports = { read, write, append };
