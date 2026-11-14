import { fetchLandcoverTile } from './providers.js';
async function acquireTile(tile, options) {
  if (tile.layer === 'ecoregions') return (await import('./ecoregions.js')).renderEcoregionTile(tile,options);
  return fetchLandcoverTile(tile, options);
}
// Bounded async acquisition pool. No synthetic render workers are used.
export class TilePool {
  constructor(size = 2, maxQueue = 96, acquire = acquireTile) {
    this.size = size; this.maxQueue = maxQueue; this.acquire = acquire;
    this.queue = []; this.active = new Set(); this.closed = false;
  }
  run(tile, { signal } = {}) {
    if (this.closed) return Promise.reject(new Error('Acquisition pool closed'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.queue.length >= this.maxQueue) return Promise.reject(Object.assign(new Error('Tile queue full; retry shortly'), { statusCode: 503 }));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const task = { tile, controller, resolve, reject, signal, onAbort: null };
      task.onAbort = () => {
        const index = this.queue.indexOf(task);
        if (index !== -1) { this.queue.splice(index, 1); signal?.removeEventListener('abort', task.onAbort); reject(signal.reason); }
        controller.abort(signal?.reason || new DOMException('Acquisition cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', task.onAbort, { once: true });
      this.queue.push(task); this.drain();
    });
  }
  drain() {
    while (!this.closed && this.active.size < this.size && this.queue.length) {
      const task = this.queue.shift(); this.active.add(task);
      task.promise = Promise.resolve().then(() => this.acquire(task.tile, { signal: task.controller.signal }))
        .then(task.resolve, task.reject).finally(() => {
          task.signal?.removeEventListener('abort', task.onAbort);
          this.active.delete(task); this.drain();
        });
    }
  }
  stats() { return { workers: this.size, active: this.active.size, queued: this.queue.length, maxQueue: this.maxQueue, mode: 'real-source-acquisition' }; }
  async close() {
    this.closed = true;
    for (const task of this.queue.splice(0)) { task.signal?.removeEventListener('abort', task.onAbort); task.reject(new Error('Acquisition pool closed')); }
    for (const task of this.active) task.controller.abort();
    await Promise.all([...this.active].map(task => task.promise));
  }
}
