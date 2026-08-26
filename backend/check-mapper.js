const { mapSourceCategories } = require('./src/modules/sources/categories/category-mapper');
const catalog = require('./src/modules/sources/categories/source-categories.json');
Object.entries(catalog).forEach(([sourceId, src]) => {
  src.categories.forEach((entry) => {
    const canonical = mapSourceCategories(sourceId, [entry.label, entry.id]);
    const hasHit = entry.canonical.some(c => canonical.includes(c));
    if (!hasHit) console.log(sourceId, '|', entry.id, '|', entry.label, '=> mapped:', JSON.stringify(canonical), 'expected:', JSON.stringify(entry.canonical));
  });
});
