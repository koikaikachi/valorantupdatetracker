export class D1StateStore {
  constructor(db) { this.db = db; }

  async acquire(now) {
    const owner = crypto.randomUUID();
    const row = await this.db.prepare(
      'UPDATE monitor_state SET lease_owner = ?, lease_until = ? WHERE id = 1 AND lease_until <= ? RETURNING payload'
    ).bind(owner, now + 55_000, now).first();
    if (!row) return null;
    return { owner, state: JSON.parse(row.payload) };
  }

  async save(owner, state) {
    const result = await this.db.prepare(
      'UPDATE monitor_state SET payload = ? WHERE id = 1 AND lease_owner = ?'
    ).bind(JSON.stringify(state), owner).run();
    if (result.meta.changes !== 1) throw new Error('Monitor lease was lost; refusing to overwrite another check.');
  }

  async release(owner) {
    await this.db.prepare('UPDATE monitor_state SET lease_owner = NULL, lease_until = 0 WHERE id = 1 AND lease_owner = ?').bind(owner).run();
  }

  async read() {
    const row = await this.db.prepare('SELECT payload FROM monitor_state WHERE id = 1').first();
    if (!row) throw new Error('Database has not been initialized. Run the setup wizard.');
    return JSON.parse(row.payload);
  }
}
