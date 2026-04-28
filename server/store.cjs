const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.VERCEL === '1' 
  ? path.join('/tmp', 'data')
  : path.join(__dirname, 'data');

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (err) {
  console.error('Failed to create data directory:', err);
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
