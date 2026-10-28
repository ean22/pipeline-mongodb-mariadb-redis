import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractPacket } from '../src/pipeline/extractor.js';
import { validateAndNormalize, formatDateForMySQL } from '../src/pipeline/validator.js';
import { Deduplicator } from '../src/pipeline/deduplicator.js';
import { MongoDatabase } from '../src/database/mongodb.js';
import { RedisDatabase } from '../src/database/redis.js';

describe('1. Testes de Extração e Normalização', () => {
  test('Deve decodificar payload híbrido (payload_data)', () => {
    const rawDoc = {
      _id: 'mongo_123',
      data: new Date('2026-10-22T12:00:00Z'),
      payload_data: {
        channel: 0,
        from: 2410095848,
        hop_start: 3,
        hops_away: 1,
        id: 998877,
        payload: { t: 22, u: 15 },
        sender: '!8fa724e8',
        timestamp: 1792675000,
        type: 'text'
      }
    };

    const extracted = extractPacket(rawDoc);
    assert.equal(extracted.success, true);
    assert.equal(extracted.noId, '!8fa724e8');
    assert.equal(extracted.pacoteId, '998877');
    assert.deepEqual(extracted.innerPayload, { t: 22, u: 15 });
  });

  test('Deve decodificar payload_base64 corretamente', () => {
    const jsonStr = JSON.stringify({
      channel: 0,
      from: 2410095848,
      id: 554433,
      payload: { t: 25, u: 16 },
      sender: '!8fa724e8',
      timestamp: 1792675100,
      type: 'text'
    });
    const rawDoc = {
      _id: 'mongo_b64',
      data: new Date('2026-10-22T12:05:00Z'),
      payload_base64: Buffer.from(jsonStr).toString('base64')
    };

    const extracted = extractPacket(rawDoc);
    assert.equal(extracted.success, true);
    assert.equal(extracted.pacoteId, '554433');
    assert.equal(extracted.innerPayload.t, 25);
  });

  test('Deve rejeitar payload de texto puro inválido para JSON', () => {
    const rawDoc = {
      _id: 'mongo_ping',
      data: new Date('2026-10-22T13:00:00Z'),
      payload: 'mensagem para validar se o cliente ainda está ativo'
    };

    const extracted = extractPacket(rawDoc);
    assert.equal(extracted.success, false);
    assert.equal(extracted.motivo, 'PAYLOAD_INVALID_FORMAT');
  });
});

describe('2. Testes de Validação e Regras de Negócio', () => {
  test('Deve aceitar medições válidas de temperatura e umidade', () => {
    const extracted = {
      success: true,
      mongoId: 'doc_1',
      noId: '!8fa724e8',
      pacoteId: '1001',
      tipo: 'text',
      timestampOriginal: 1792675000,
      innerPayload: { t: 23.5, u: 16 },
      receiptDate: new Date('2026-10-22T12:00:00Z'),
      rawPacket: {}
    };

    const result = validateAndNormalize(extracted);
    assert.equal(result.isValid, true);
    assert.equal(result.timestampFallback, false);
    assert.equal(result.seriesRecords.length, 2);
    assert.equal(result.seriesRecords[0].metrica, 'temperatura');
    assert.equal(result.seriesRecords[0].valor, 23.5);
    assert.equal(result.seriesRecords[1].metrica, 'umidade');
    assert.equal(result.seriesRecords[1].valor, 16);
  });

  test('Deve acionar fallback para timestamp inválido (timestamp = 0)', () => {
    const receiptDate = new Date('2026-10-22T13:22:27.505Z');
    const extracted = {
      success: true,
      mongoId: 'doc_ts0',
      noId: '!8fa724e8',
      pacoteId: '1002',
      tipo: 'text',
      timestampOriginal: 0,
      innerPayload: { t: 24, u: 15 },
      receiptDate: receiptDate,
      rawPacket: {}
    };

    const result = validateAndNormalize(extracted);
    assert.equal(result.isValid, true);
    assert.equal(result.timestampFallback, true);
    assert.equal(result.seriesRecords[0].timestamp_fallback, true);
    assert.equal(result.seriesRecords[0].timestamp_medicao, formatDateForMySQL(receiptDate));
  });

  test('Deve rejeitar mensagens de texto (chat/teste) para quarentena', () => {
    const extracted = {
      success: true,
      mongoId: 'doc_chat',
      noId: '!8fa724e8',
      pacoteId: '1003',
      tipo: 'text',
      timestampOriginal: 1792675000,
      innerPayload: { text: 'teste de conexao' },
      receiptDate: new Date(),
      payloadBruto: '{"text":"teste de conexao"}'
    };

    const result = validateAndNormalize(extracted);
    assert.equal(result.isValid, false);
    assert.equal(result.rejection.motivo_rejeicao, 'MENSAGEM_TEXTO_SEM_METRICA');
  });

  test('Deve rejeitar mensagem nodeinfo para quarentena', () => {
    const extracted = {
      success: true,
      mongoId: 'doc_nodeinfo',
      noId: '!8fa724e8',
      pacoteId: '1004',
      tipo: 'nodeinfo',
      timestampOriginal: 1792675000,
      innerPayload: { hardware: 110, id: '!8fa724e8', longname: 'Node Teste' },
      receiptDate: new Date(),
      payloadBruto: '{}'
    };

    const result = validateAndNormalize(extracted);
    assert.equal(result.isValid, false);
    assert.equal(result.rejection.motivo_rejeicao, 'NODEINFO_SEM_TELEMETRIA');
  });

  test('Deve rejeitar valores fora de limites físicos (temperatura > 85°C)', () => {
    const extracted = {
      success: true,
      mongoId: 'doc_out_of_range',
      noId: '!8fa724e8',
      pacoteId: '1005',
      tipo: 'text',
      timestampOriginal: 1792675000,
      innerPayload: { t: 150, u: 16 },
      receiptDate: new Date(),
      payloadBruto: '{}'
    };

    const result = validateAndNormalize(extracted);
    assert.equal(result.isValid, false);
    assert.equal(result.rejection.motivo_rejeicao, 'VALOR_METRICA_FORA_DE_FAIXA');
  });
});

describe('3. Testes de Deduplicação', () => {
  test('Deve detectar pacotes repetidos pelo par (noId, pacoteId)', () => {
    const deduplicator = new Deduplicator();
    const noId = '!8fa724e8';
    const pacoteId = '858540992';

    // Primeiro envio
    assert.equal(deduplicator.isDuplicate(noId, pacoteId), false, 'Primeiro pacote deve ser aceito');

    // Segundo envio (repetição)
    assert.equal(deduplicator.isDuplicate(noId, pacoteId), true, 'Segundo pacote idêntico deve ser duplicata');

    // Terceiro envio (outra repetição)
    assert.equal(deduplicator.isDuplicate(noId, pacoteId), true, 'Terceiro pacote idêntico deve ser duplicata');

    // Pacote diferente do mesmo nó
    assert.equal(deduplicator.isDuplicate(noId, '858540993'), false, 'Novo pacoteId do mesmo nó deve ser aceito');

    // Mesmo pacoteId de outro nó
    assert.equal(deduplicator.isDuplicate('!outrono', pacoteId), false, 'Mesmo pacoteId em outro nó deve ser aceito');
  });
});

describe('4. Testes de Falhas de Conexão e Resiliência', () => {
  test('Deve capturar erro ao tentar conectar em host Mongo inacessível', async () => {
    const badMongo = new MongoDatabase({
      uri: 'mongodb://usuario:senha@127.0.0.1:27099/iot?connectTimeoutMS=200&serverSelectionTimeoutMS=200'
    });

    await assert.rejects(
      async () => {
        await badMongo.connect();
      },
      /ECONNREFUSED|Server selection timed out|ETIMEDOUT/i,
      'Deve lançar erro de recusa de conexão ou timeout'
    );
  });

  test('Deve capturar erro ao tentar conectar em host Redis inacessível', async () => {
    const badRedis = new RedisDatabase({
      host: '127.0.0.1',
      port: 63799,
      connectTimeout: 200,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null
    });

    await assert.rejects(
      async () => {
        await badRedis.connect();
      },
      /Connection is closed|ECONNREFUSED|ETIMEDOUT/i,
      'Deve lançar erro de recusa de conexão ou conexão fechada'
    );
  });
});
