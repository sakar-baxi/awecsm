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

const getFilePath = (collection) => path.join(DATA_DIR, `${collection}.json`);

const store = {
  read: (collection) => {
    const filePath = getFilePath(collection);
    try {
      if (!fs.existsSync(filePath)) return [];
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.error(`Error reading ${collection}:`, err);
      return [];
    }
  },
  write: (collection, data) => {
    const filePath = getFilePath(collection);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`Error writing ${collection}:`, err);
    }
  },
  append: (collection, item) => {
    const data = store.read(collection);
    data.push(item);
    store.write(collection, data);
  }
};

module.exports = store;
