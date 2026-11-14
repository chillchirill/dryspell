export class ByteLRU {
  constructor(maxBytes = 32 * 1024 * 1024) { this.maxBytes = maxBytes; this.bytes = 0; this.items = new Map(); this.hits = 0; this.misses = 0; }
  get(key) {
    const value = this.items.get(key);
    if (!value) { this.misses++; return undefined; }
    this.items.delete(key); this.items.set(key, value); this.hits++; return value;
  }
  set(key, value) {
    if (value.byteLength > this.maxBytes) return;
    const previous = this.items.get(key);
    if (previous) { this.bytes -= previous.byteLength; this.items.delete(key); }
    while (this.bytes + value.byteLength > this.maxBytes && this.items.size) {
      const oldest = this.items.keys().next().value;
      this.bytes -= this.items.get(oldest).byteLength; this.items.delete(oldest);
    }
    this.items.set(key, value); this.bytes += value.byteLength;
  }
  stats() { return { entries: this.items.size, bytes: this.bytes, maxBytes: this.maxBytes, hits: this.hits, misses: this.misses }; }
}
