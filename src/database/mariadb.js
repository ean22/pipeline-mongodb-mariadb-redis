import mysql from 'mysql2/promise';
import { config } from '../config.js';

export class MariaDatabase {
  constructor(customConfig = {}) {
    this.cfg = { ...config.mariadb, ...customConfig };
    this.prefix = this.cfg.prefix || 'eduardo_';
    this.pool = null;
  }

  async connect() {
    if (this.pool) return;
    this.pool = mysql.createPool({
      host: this.cfg.host,
      port: this.cfg.port,
      user: this.cfg.user,
      password: this.cfg.password,
      database: this.cfg.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      dateStrings: true
    });

    // Testa a conexão
    const conn = await this.pool.getConnection();
    conn.release();
  }

  async createTables() {
    const conn = await this.pool.getConnection();
    try {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS \`${this.prefix}serie_temporal\` (
          \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
          \`no_id\` VARCHAR(64) NOT NULL,
          \`pacote_id\` VARCHAR(64) NOT NULL,
          \`metrica\` VARCHAR(32) NOT NULL,
          \`valor\` DOUBLE NOT NULL,
          \`timestamp_medicao\` DATETIME(3) NOT NULL,
          \`timestamp_no\` BIGINT DEFAULT NULL,
          \`timestamp_fallback\` TINYINT(1) NOT NULL DEFAULT 0,
          \`recebido_em\` DATETIME(3) NOT NULL,
          \`hop_start\` TINYINT DEFAULT NULL,
          \`hops_away\` TINYINT DEFAULT NULL,
          \`channel\` INT DEFAULT NULL,
          \`criado_em\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY \`uq_no_pacote_metrica\` (\`no_id\`, \`pacote_id\`, \`metrica\`),
          KEY \`idx_no_metrica_tempo\` (\`no_id\`, \`metrica\`, \`timestamp_medicao\`),
          KEY \`idx_tempo\` (\`timestamp_medicao\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS \`${this.prefix}agg_hora\` (
          \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
          \`no_id\` VARCHAR(64) NOT NULL,
          \`metrica\` VARCHAR(32) NOT NULL,
          \`janela_hora\` DATETIME NOT NULL,
          \`media_valor\` DOUBLE NOT NULL,
          \`min_valor\` DOUBLE NOT NULL,
          \`max_valor\` DOUBLE NOT NULL,
          \`contagem_leituras\` INT NOT NULL,
          \`atualizado_em\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY \`uq_agg_hora\` (\`no_id\`, \`metrica\`, \`janela_hora\`),
          KEY \`idx_agg_hora_tempo\` (\`janela_hora\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS \`${this.prefix}agg_dia\` (
          \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
          \`no_id\` VARCHAR(64) NOT NULL,
          \`metrica\` VARCHAR(32) NOT NULL,
          \`janela_dia\` DATE NOT NULL,
          \`media_valor\` DOUBLE NOT NULL,
          \`min_valor\` DOUBLE NOT NULL,
          \`max_valor\` DOUBLE NOT NULL,
          \`contagem_leituras\` INT NOT NULL,
          \`atualizado_em\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY \`uq_agg_dia\` (\`no_id\`, \`metrica\`, \`janela_dia\`),
          KEY \`idx_agg_dia_tempo\` (\`janela_dia\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS \`${this.prefix}quarentena\` (
          \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
          \`mongo_id\` VARCHAR(64) NOT NULL,
          \`no_id\` VARCHAR(64) DEFAULT NULL,
          \`pacote_id\` VARCHAR(64) DEFAULT NULL,
          \`tipo_mensagem\` VARCHAR(64) DEFAULT NULL,
          \`motivo_rejeicao\` VARCHAR(128) NOT NULL,
          \`detalhes\` TEXT DEFAULT NULL,
          \`payload_bruto\` LONGTEXT DEFAULT NULL,
          \`recebido_em\` DATETIME(3) DEFAULT NULL,
          \`criado_em\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          KEY \`idx_motivo\` (\`motivo_rejeicao\`),
          KEY \`idx_no\` (\`no_id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS \`${this.prefix}indicadores\` (
          \`nome\` VARCHAR(64) NOT NULL PRIMARY KEY,
          \`valor\` BIGINT NOT NULL DEFAULT 0,
          \`descricao\` VARCHAR(255) DEFAULT NULL,
          \`atualizado_em\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    } finally {
      conn.release();
    }
  }

  async insertBatchSerie(records) {
    if (!records || records.length === 0) return 0;
    const sql = `
      INSERT IGNORE INTO \`${this.prefix}serie_temporal\`
      (no_id, pacote_id, metrica, valor, timestamp_medicao, timestamp_no, timestamp_fallback, recebido_em, hop_start, hops_away, channel)
      VALUES ?
    `;
    const values = records.map(r => [
      r.no_id,
      r.pacote_id,
      r.metrica,
      r.valor,
      r.timestamp_medicao,
      r.timestamp_no ?? null,
      r.timestamp_fallback ? 1 : 0,
      r.recebido_em,
      r.hop_start ?? null,
      r.hops_away ?? null,
      r.channel ?? null
    ]);

    const [result] = await this.pool.query(sql, [values]);
    return result.affectedRows;
  }

  async insertBatchQuarentena(records) {
    if (!records || records.length === 0) return 0;
    const sql = `
      INSERT INTO \`${this.prefix}quarentena\`
      (mongo_id, no_id, pacote_id, tipo_mensagem, motivo_rejeicao, detalhes, payload_bruto, recebido_em)
      VALUES ?
    `;
    const values = records.map(r => [
      r.mongo_id,
      r.no_id ?? null,
      r.pacote_id ?? null,
      r.tipo_mensagem ?? null,
      r.motivo_rejeicao,
      r.detalhes ?? null,
      r.payload_bruto ?? null,
      r.recebido_em ?? null
    ]);

    const [result] = await this.pool.query(sql, [values]);
    return result.affectedRows;
  }

  async recalculateAggregations() {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      // Agregação Horária
      await conn.query(`
        INSERT INTO \`${this.prefix}agg_hora\`
          (no_id, metrica, janela_hora, media_valor, min_valor, max_valor, contagem_leituras)
        SELECT
          no_id,
          metrica,
          DATE_FORMAT(timestamp_medicao, '%Y-%m-%d %H:00:00') AS janela_hora,
          ROUND(AVG(valor), 2) AS media_valor,
          ROUND(MIN(valor), 2) AS min_valor,
          ROUND(MAX(valor), 2) AS max_valor,
          COUNT(*) AS contagem_leituras
        FROM \`${this.prefix}serie_temporal\`
        GROUP BY no_id, metrica, DATE_FORMAT(timestamp_medicao, '%Y-%m-%d %H:00:00')
        ON DUPLICATE KEY UPDATE
          media_valor = VALUES(media_valor),
          min_valor = VALUES(min_valor),
          max_valor = VALUES(max_valor),
          contagem_leituras = VALUES(contagem_leituras);
      `);

      // Agregação Diária
      await conn.query(`
        INSERT INTO \`${this.prefix}agg_dia\`
          (no_id, metrica, janela_dia, media_valor, min_valor, max_valor, contagem_leituras)
        SELECT
          no_id,
          metrica,
          DATE(timestamp_medicao) AS janela_dia,
          ROUND(AVG(valor), 2) AS media_valor,
          ROUND(MIN(valor), 2) AS min_valor,
          ROUND(MAX(valor), 2) AS max_valor,
          COUNT(*) AS contagem_leituras
        FROM \`${this.prefix}serie_temporal\`
        GROUP BY no_id, metrica, DATE(timestamp_medicao)
        ON DUPLICATE KEY UPDATE
          media_valor = VALUES(media_valor),
          min_valor = VALUES(min_valor),
          max_valor = VALUES(max_valor),
          contagem_leituras = VALUES(contagem_leituras);
      `);

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async updateIndicadores(stats) {
    const entries = [
      ['mensagens_processadas', stats.processadas, 'Total de documentos lidos e avaliados do MongoDB'],
      ['metricas_inseridas', stats.metricasInseridas, 'Total de séries temporais válidas persistidas'],
      ['duplicatas_descartadas', stats.duplicadas, 'Total de mensagens repetidas identificadas e descartadas'],
      ['quarentena_total', stats.rejeitadas, 'Total de mensagens enviadas para a quarentena'],
      ['timestamps_invalidos_fallback', stats.timestampsFallback, 'Total de timestamps inválidos corrigidos com horário de recebimento']
    ];

    const sql = `
      INSERT INTO \`${this.prefix}indicadores\` (nome, valor, descricao)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        valor = VALUES(valor),
        descricao = VALUES(descricao);
    `;

    await this.pool.query(sql, [entries]);
  }

  async query(sql, params = []) {
    const [rows] = await this.pool.query(sql, params);
    return rows;
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
