import fs from 'node:fs/promises';
import path from 'node:path';

const COLLECTIONS = ['topics','scripts','reviews','inspirations','knowledge_inbox','creators','performance','calibration_events','preference_rules'];

export class JsonStore {
  constructor(dataDir, seedDir) { this.dataDir = dataDir; this.seedDir = seedDir; this.queue = Promise.resolve(); }
  file(name) { if (!COLLECTIONS.includes(name)) throw new Error(`未知集合: ${name}`); return path.join(this.dataDir, `${name}.json`); }
  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'knowledge_files'), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'inspiration_files'), { recursive: true });
    for (const name of COLLECTIONS) {
      const target = this.file(name);
      try { await fs.access(target); }
      catch {
        const seed = path.join(this.seedDir, `${name}.json`);
        try { await fs.copyFile(seed, target); }
        catch { await fs.writeFile(target, '[]\n', 'utf8'); }
      }
    }
  }
  async read(name) { return JSON.parse(await fs.readFile(this.file(name), 'utf8')); }
  async write(name, value) {
    const target = this.file(name), temp = `${target}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temp, target);
    return value;
  }
  async update(name, fn) {
    const work = async () => this.write(name, await fn(await this.read(name)));
    this.queue = this.queue.then(work, work);
    return this.queue;
  }
}
