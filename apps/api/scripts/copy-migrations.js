// tsc does not emit .sql files; copy them next to the compiled migrate.js so
// `node dist/db/migrate.js` (and the Docker image, which ships only dist/) can find them.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'db', 'migrations');
const dest = path.join(__dirname, '..', 'dist', 'db', 'migrations');

fs.mkdirSync(dest, { recursive: true });
let count = 0;
for (const file of fs.readdirSync(src)) {
  if (file.endsWith('.sql')) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
    count++;
  }
}
console.log(`Copied ${count} migration file(s) to ${path.relative(process.cwd(), dest)}`);
