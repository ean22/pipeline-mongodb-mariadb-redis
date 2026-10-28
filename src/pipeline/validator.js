export function formatDateForMySQL(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  const pad = (n, s = 2) => String(n).padStart(s, '0');
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const min = pad(d.getUTCMinutes());
  const sec = pad(d.getUTCSeconds());
  const ms = pad(d.getUTCMilliseconds(), 3);
  return `${y}-${m}-${day} ${h}:${min}:${sec}.${ms}`;
}

export function validateAndNormalize(extracted) {
  if (!extracted.success) {
    return {
      isValid: false,
      rejection: {
        mongo_id: extracted.mongoId,
        no_id: extracted.noId || null,
        pacote_id: extracted.pacoteId || null,
        tipo_mensagem: extracted.tipo || 'invalido',
        motivo_rejeicao: extracted.motivo,
        detalhes: extracted.detalhes,
        payload_bruto: extracted.payloadBruto,
        recebido_em: formatDateForMySQL(extracted.receiptDate)
      }
    };
  }

  const { noId, pacoteId, tipo, timestampOriginal, innerPayload, receiptDate, rawPacket, payloadBruto, mongoId } = extracted;

  // 1. Validação de identificador do nó e do pacote
  if (!noId) {
    return {
      isValid: false,
      rejection: {
        mongo_id: mongoId,
        no_id: null,
        pacote_id: pacoteId,
        tipo_mensagem: tipo,
        motivo_rejeicao: 'SEM_IDENTIFICADOR_NO',
        detalhes: 'Não foi possível identificar o nó transmissor da mensagem',
        payload_bruto: payloadBruto,
        recebido_em: formatDateForMySQL(receiptDate)
      }
    };
  }

  if (!pacoteId) {
    return {
      isValid: false,
      rejection: {
        mongo_id: mongoId,
        no_id: noId,
        pacote_id: null,
        tipo_mensagem: tipo,
        motivo_rejeicao: 'SEM_IDENTIFICADOR_PACOTE',
        detalhes: 'Não foi possível identificar o identificador do pacote (id)',
        payload_bruto: payloadBruto,
        recebido_em: formatDateForMySQL(receiptDate)
      }
    };
  }

  // 2. Validação por Tipo de Mensagem Administrativa
  if (tipo === 'nodeinfo' || (innerPayload && innerPayload.hardware !== undefined)) {
    return {
      isValid: false,
      rejection: {
        mongo_id: mongoId,
        no_id: noId,
        pacote_id: pacoteId,
        tipo_mensagem: 'nodeinfo',
        motivo_rejeicao: 'NODEINFO_SEM_TELEMETRIA',
        detalhes: 'Mensagem de identificação de hardware/nome de nó, sem métricas ambientais',
        payload_bruto: payloadBruto,
        recebido_em: formatDateForMySQL(receiptDate)
      }
    };
  }

  // 3. Validação de mensagens puramente textuais
  if (innerPayload && typeof innerPayload.text === 'string') {
    return {
      isValid: false,
      rejection: {
        mongo_id: mongoId,
        no_id: noId,
        pacote_id: pacoteId,
        tipo_mensagem: 'text',
        motivo_rejeicao: 'MENSAGEM_TEXTO_SEM_METRICA',
        detalhes: `Mensagem de chat/texto sem telemetria: "${innerPayload.text}"`,
        payload_bruto: payloadBruto,
        recebido_em: formatDateForMySQL(receiptDate)
      }
    };
  }

  // 4. Validação de existência de métricas úteis (t, u)
  if (!innerPayload || typeof innerPayload !== 'object') {
    return {
      isValid: false,
      rejection: {
        mongo_id: mongoId,
        no_id: noId,
        pacote_id: pacoteId,
        tipo_mensagem: tipo,
        motivo_rejeicao: 'PAYLOAD_INTERNO_INVALIDO',
        detalhes: 'Payload interno ausente ou em formato não reconhecido',
        payload_bruto: payloadBruto,
        recebido_em: formatDateForMySQL(receiptDate)
      }
    };
  }

  const metrics = [];

  // Métrica Temperatura (t)
  if (innerPayload.t !== undefined && innerPayload.t !== null) {
    const tVal = Number(innerPayload.t);
    if (isNaN(tVal) || tVal < -40 || tVal > 85) {
      return {
        isValid: false,
        rejection: {
          mongo_id: mongoId,
          no_id: noId,
          pacote_id: pacoteId,
          tipo_mensagem: tipo,
          motivo_rejeicao: 'VALOR_METRICA_FORA_DE_FAIXA',
          detalhes: `Temperatura fora dos limites físicos plausíveis: ${innerPayload.t}°C`,
          payload_bruto: payloadBruto,
          recebido_em: formatDateForMySQL(receiptDate)
        }
      };
    }
    metrics.push({ metrica: 'temperatura', valor: tVal });
  }

  // Métrica Umidade (u)
  if (innerPayload.u !== undefined && innerPayload.u !== null) {
    const uVal = Number(innerPayload.u);
    if (isNaN(uVal) || uVal < 0 || uVal > 100) {
      return {
        isValid: false,
        rejection: {
          mongo_id: mongoId,
          no_id: noId,
          pacote_id: pacoteId,
          tipo_mensagem: tipo,
          motivo_rejeicao: 'VALOR_METRICA_FORA_DE_FAIXA',
          detalhes: `Umidade fora dos limites percentuais (0-100%): ${innerPayload.u}%`,
          payload_bruto: payloadBruto,
          recebido_em: formatDateForMySQL(receiptDate)
        }
      };
    }
    metrics.push({ metrica: 'umidade', valor: uVal });
  }

  if (metrics.length === 0) {
    return {
      isValid: false,
      rejection: {
        mongo_id: mongoId,
        no_id: noId,
        pacote_id: pacoteId,
        tipo_mensagem: tipo,
        motivo_rejeicao: 'SEM_METRICAS_UTEIS',
        detalhes: 'Payload não contém campos de telemetria esperados (t, u)',
        payload_bruto: payloadBruto,
        recebido_em: formatDateForMySQL(receiptDate)
      }
    };
  }

  // 5. Validação de Timestamp e Fallback para horário de recebimento (doc.data do consumidor MQTT)
  let timestampMedicaoDate;
  let timestampFallback = false;
  const isInvalidTimestamp = (
    timestampOriginal === undefined ||
    timestampOriginal === null ||
    Number(timestampOriginal) <= 0 ||
    Number(timestampOriginal) < 1500000000 || // antes de 2017
    Number(timestampOriginal) > 2200000000    // além de 2039
  );

  if (isInvalidTimestamp) {
    timestampMedicaoDate = receiptDate;
    timestampFallback = true;
  } else {
    timestampMedicaoDate = new Date(Number(timestampOriginal) * 1000);
    if (isNaN(timestampMedicaoDate.getTime())) {
      timestampMedicaoDate = receiptDate;
      timestampFallback = true;
    }
  }

  const timestampMedicaoMySQL = formatDateForMySQL(timestampMedicaoDate);
  const recebidoEmMySQL = formatDateForMySQL(receiptDate);

  const seriesRecords = metrics.map(m => ({
    no_id: noId,
    pacote_id: pacoteId,
    metrica: m.metrica,
    valor: m.valor,
    timestamp_medicao: timestampMedicaoMySQL,
    timestamp_no: timestampOriginal ? Number(timestampOriginal) : null,
    timestamp_fallback: timestampFallback,
    recebido_em: recebidoEmMySQL,
    hop_start: extracted.hopStart ?? null,
    hops_away: extracted.hopsAway ?? null,
    channel: extracted.channel ?? null
  }));

  return {
    isValid: true,
    noId,
    pacoteId,
    timestampFallback,
    timestampMedicaoMySQL,
    recebidoEmMySQL,
    seriesRecords
  };
}
