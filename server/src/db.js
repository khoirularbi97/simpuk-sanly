import pg from 'pg';

pg.types.setTypeParser(1082, (v) => v);          // DATE tetap 'YYYY-MM-DD'
pg.types.setTypeParser(1700, (v) => Number(v));  // NUMERIC jadi angka
pg.types.setTypeParser(20, (v) => Number(v));    // BIGINT (hasil COUNT/SUM) jadi angka

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL belum diisi.');
const lokal = /@(localhost|127\.0\.0\.1)|host=\/|@\//.test(url);

export const pool = new pg.Pool({ connectionString: url, ssl: lokal ? false : { rejectUnauthorized: true }, max: 5 });

export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const hasil = await fn(c);
    await c.query('COMMIT');
    return hasil;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
