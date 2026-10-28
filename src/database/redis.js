import Redis from 'ioredis';
import { config } from '../config.js';

export class RedisDatabase {
  constructor(customConfig = {}) {
    this.cfg = { ...config.redis, ...customConfig };
    this.prefix = this.cfg.prefix || 'eduardo:';
    this.client = null;
  }

  async connect() {
    if (this.client) return;
    this.client = new Redis({
      host: this.cfg.host,
      port: this.cfg.port,
      password: this.cfg.password,
      connectTimeout: this.cfg.connectTimeout || 10000,
      lazyConnect: true,
      maxRetriesPerRequest: this.cfg.maxRetriesPerRequest ?? 3,
      retryStrategy: this.cfg.retryStrategy !== undefined ? this.cfg.retryStrategy : (times => (times > 3 ? null : Math.min(times * 100, 2000)))
    });
    // Trata erros de evento unhandled em conexões com falha proposital
    this.client.on('error', () => {});
    await this.client.connect();
  }

  async setUltimoValor(noId, metrica, data) {
    const key = `${this.prefix}ultimo:${noId}:${metrica}`;
    const payload = JSON.stringify({
      valor: data.valor,
      timestamp: data.timestamp,
      pacote_id: String(data.pacote_id)
    });
    await this.client.set(key, payload);

    // Atualiza também conjunto de nós ativos
    await this.client.sadd(`${this.prefix}nos`, noId);
    await this.client.set(`${this.prefix}no:${noId}:ultima_vista`, data.timestamp);
  }

  async setBatchUltimosValores(records) {
    if (!records || records.length === 0) return;
    const pipeline = this.client.pipeline();

    for (const r of records) {
      const key = `${this.prefix}ultimo:${r.no_id}:${r.metrica}`;
      const payload = JSON.stringify({
        valor: r.valor,
        timestamp: r.timestamp_medicao,
        pacote_id: String(r.pacote_id)
      });
      pipeline.set(key, payload);
      pipeline.sadd(`${this.prefix}nos`, r.no_id);
      pipeline.set(`${this.prefix}no:${r.no_id}:ultima_vista`, r.timestamp_medicao);
    }

    await pipeline.exec();
  }

  async updateStats(stats) {
    const key = `${this.prefix}stats`;
    const map = {
      lidos: String(stats.processadas || 0),
      metricas_inseridas: String(stats.metricasInseridas || 0),
      duplicatas_descartadas: String(stats.duplicadas || 0),
      timestamps_invalidos: String(stats.timestampsFallback || 0),
      quarentena_total: String(stats.rejeitadas || 0)
    };

    if (stats.quarentenaPorMotivo) {
      for (const [motivo, count] of Object.entries(stats.quarentenaPorMotivo)) {
        map[`quarentena:${motivo}`] = String(count);
      }
    }

    await this.client.hset(key, map);
  }

  async getUltimoValor(noId, metrica) {
    const key = `${this.prefix}ultimo:${noId}:${metrica}`;
    const raw = await this.client.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async getStats() {
    const key = `${this.prefix}stats`;
    return this.client.hgetall(key);
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}
