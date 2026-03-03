const fs = require('fs');
const os = require('os');
const path = require('path');

const home = os.homedir();
const candidates = [
  path.join(home, 'Library', 'Application Support', 'studia-manager', 'studia.sqlite'),
  path.join(home, 'Library', 'Application Support', 'Studia', 'studia.sqlite'),
  path.join(home, 'Library', 'Application Support', 'Electron', 'studia.sqlite')
];

let removed = 0;
for (const file of candidates) {
  try {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      removed += 1;
      console.log(`Removed: ${file}`);
    }
  } catch (error) {
    console.log(`Skip: ${file} (${error.message})`);
  }
}

if (!removed) {
  console.log('No existing database file found in known userData paths.');
}
