export class Deduplicator {
  constructor() {
    this.seenKeys = new Set();
  }

  /**
   * Verifica se a combinação (no_id, pacote_id) já foi vista.
   * Se for nova, registra no conjunto e retorna false (não é duplicata).
   * Se já existir, retorna true (é duplicata).
   */
  isDuplicate(noId, pacoteId) {
    if (!noId || !pacoteId) return false;
    const key = `${noId}::${pacoteId}`;
    if (this.seenKeys.has(key)) {
      return true;
    }
    this.seenKeys.add(key);
    return false;
  }

  size() {
    return this.seenKeys.size;
  }

  clear() {
    this.seenKeys.clear();
  }
}
