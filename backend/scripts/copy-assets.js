const fs = require('fs');
const path = require('path');

const assets = [
  {
    src: path.join(__dirname, '..', 'src', 'modules', 'matching', 'knowledge-base.json'),
    dest: path.join(__dirname, '..', 'dist', 'modules', 'matching', 'knowledge-base.json'),
    label: 'knowledge-base.json',
  },
  {
    src: path.join(__dirname, '..', 'src', 'modules', 'sources', 'source-configs.json'),
    dest: path.join(__dirname, '..', 'dist', 'modules', 'sources', 'source-configs.json'),
    label: 'source-configs.json',
  },
  {
    src: path.join(__dirname, '..', 'src', 'modules', 'sources', 'categories', 'category-taxonomy.json'),
    dest: path.join(__dirname, '..', 'dist', 'modules', 'sources', 'categories', 'category-taxonomy.json'),
    label: 'categories/category-taxonomy.json',
  },
  {
    src: path.join(__dirname, '..', 'src', 'modules', 'sources', 'categories', 'source-categories.json'),
    dest: path.join(__dirname, '..', 'dist', 'modules', 'sources', 'categories', 'source-categories.json'),
    label: 'categories/source-categories.json',
  },
];

let ok = 0;
for (const asset of assets) {
  try {
    fs.mkdirSync(path.dirname(asset.dest), { recursive: true });
    fs.copyFileSync(asset.src, asset.dest);
    console.log(`✓ Copied ${asset.label} to dist`);
    ok++;
  } catch (e) {
    console.error(`⚠ Could not copy ${asset.label}:`, e.message);
    process.exit(1);
  }
}
console.log(`\n${ok}/${assets.length} assets copied.`);
