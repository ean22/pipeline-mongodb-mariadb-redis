import { MongoDatabase } from '../database/mongodb.js';
import { MariaDatabase } from '../database/mariadb.js';
import { RedisDatabase } from '../database/redis.js';
import { extractPacket } from './extractor.js';
import { validateAndNormalize } from './validator.js';
import { Deduplicator } from './deduplicator.js';

export class PipelineProcessor {
  constructor(options = {}) {
    this.mongo = options.mongo || new MongoDatabase();
    this.maria = options.maria || new MariaDatabase();
    this.redis = options.redis || new RedisDatabase();
    this.deduplicator = options.deduplicator || new Deduplicator();
    this.batchSize = options.batchSize || 500;
  }

  async init() {
    await Promise.all([
      this.mongo.connect(),
      this.maria.connect(),
      this.redis.connect()
    ]);
    await this.maria.createTables();
  }

  async run() {
    const stats = {
      processadas: 0,
      duplicadas: 0,
      rejeitadas: 0,
      timestampsFallback: 0,
      metricasInseridas: 0,
      quarentenaPorMotivo: {}
    };

    let serieBatch = [];
    let quarentenaBatch = [];
    let redisLatestBatch = [];

    const flushSerieBatch = async () => {
      if (serieBatch.length > 0) {
        await this.maria.insertBatchSerie(serieBatch);
        serieBatch = [];
      }
    };

    const flushQuarentenaBatch = async () => {
      if (quarentenaBatch.length > 0) {
        await this.maria.insertBatchQuarentena(quarentenaBatch);
        quarentenaBatch = [];
      }
    };

    const flushRedisBatch = async () => {
      if (redisLatestBatch.length > 0) {
        await this.redis.setBatchUltimosValores(redisLatestBatch);
        redisLatestBatch = [];
      }
    };

    for await (const doc of this.mongo.streamRawDocuments(this.batchSize)) {
      stats.processadas++;

      const extracted = extractPacket(doc);

      // Verificação de deduplicação
      if (extracted.noId && extracted.pacoteId) {
        const isDuplicated = this.deduplicator.isDuplicate(extracted.noId, extracted.pacoteId);
        if (isDuplicated) {
          stats.duplicadas++;
          continue; // Pula duplicatas para não inflacionar medições e quarentena
        }
      }

      // Validação das regras de negócio
      const validation = validateAndNormalize(extracted);

      if (!validation.isValid) {
        stats.rejeitadas++;
        const motivo = validation.rejection.motivo_rejeicao;
        stats.quarentenaPorMotivo[motivo] = (stats.quarentenaPorMotivo[motivo] || 0) + 1;
        quarentenaBatch.push(validation.rejection);

        if (quarentenaBatch.length >= this.batchSize) {
          await flushQuarentenaBatch();
        }
        continue;
      }

      // Mensagem válida
      if (validation.timestampFallback) {
        stats.timestampsFallback++;
      }

      for (const record of validation.seriesRecords) {
        serieBatch.push(record);
        redisLatestBatch.push(record);
        stats.metricasInseridas++;
      }

      if (serieBatch.length >= this.batchSize) {
        await flushSerieBatch();
      }

      if (redisLatestBatch.length >= this.batchSize) {
        await flushRedisBatch();
      }
    }

    // Flush dos lotes remanescentes
    await flushSerieBatch();
    await flushQuarentenaBatch();
    await flushRedisBatch();

    // Recalcular agregações horárias e diárias no MariaDB
    await this.maria.recalculateAggregations();

    // Atualizar indicadores no MariaDB e no Redis
    await this.maria.updateIndicadores(stats);
    await this.redis.updateStats(stats);

    return stats;
  }

  async close() {
    await Promise.allSettled([
      this.mongo.disconnect(),
      this.maria.disconnect(),
      this.redis.disconnect()
    ]);
  }
}
