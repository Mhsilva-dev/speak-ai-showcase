// Migrações: roda em ordem os arquivos .sql de migrations/ que ainda não foram aplicados (registrados em schema_migrations).
const fs = require('fs');
const path = require('path');
const db = require('./pool');
const { LANGUAGES } = require('../languages');

async function migrate() {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);
  const dir = path.join(__dirname, 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const { rowCount } = await db.query('SELECT 1 FROM schema_migrations WHERE name=$1', [file]);
    if (rowCount) continue;
    await db.tx(async (c) => {
      await c.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
    });
  }
  await seedLanguages();
}

// Sincroniza idiomas e habilidades a partir dos arquivos de conteúdo (idempotente)
async function seedLanguages() {
  for (const lang of LANGUAGES) {
    const { rows } = await db.query(
      `INSERT INTO languages(code, slug, name, explanation_language) VALUES ($1,$2,$3,$4)
       ON CONFLICT (code) DO UPDATE SET slug=EXCLUDED.slug, name=EXCLUDED.name, explanation_language=EXCLUDED.explanation_language
       RETURNING id`,
      [lang.code, lang.slug, lang.name, lang.explanationLanguage]
    );
    const languageId = rows[0].id;
    for (const [i, s] of lang.skills.entries()) {
      await db.query(
        `INSERT INTO skills(language_id, code, name, category, cefr_level, description, order_index)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (language_id, code) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category,
           cefr_level=EXCLUDED.cefr_level, description=EXCLUDED.description, order_index=EXCLUDED.order_index`,
        [languageId, s.code, s.name, s.category, s.cefr, s.description, i]
      );
    }
  }
}

module.exports = { migrate };

if (require.main === module) {
  migrate().then(() => { console.log('Migrações aplicadas'); return db.pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
