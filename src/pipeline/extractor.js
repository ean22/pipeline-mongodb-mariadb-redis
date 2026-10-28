export function extractPacket(doc) {
  const receiptDate = getReceiptDate(doc);
  const rawId = doc._id ? String(doc._id) : null;

  let packetObj = null;
  let rawContent = null;

  // 1. Caso payload_data seja objeto
  if (doc.payload_data && typeof doc.payload_data === 'object') {
    packetObj = doc.payload_data;
  }
  // 2. Caso data seja objeto e não Date
  else if (doc.data && typeof doc.data === 'object' && !(doc.data instanceof Date)) {
    packetObj = doc.data;
  }
  // 3. Caso payload_base64 esteja presente
  else if (doc.payload_base64 && typeof doc.payload_base64 === 'string') {
    rawContent = doc.payload_base64;
    try {
      const decoded = Buffer.from(doc.payload_base64, 'base64').toString('utf8');
      packetObj = JSON.parse(decoded);
    } catch (err) {
      return {
        success: false,
        mongoId: rawId,
        motivo: 'BASE64_DECODE_ERROR',
        detalhes: err.message,
        payloadBruto: rawContent,
        receiptDate
      };
    }
  }
  // 4. Caso payload seja string JSON
  else if (doc.payload && typeof doc.payload === 'string') {
    rawContent = doc.payload;
    try {
      packetObj = JSON.parse(doc.payload);
    } catch (err) {
      return {
        success: false,
        mongoId: rawId,
        motivo: 'PAYLOAD_INVALID_FORMAT',
        detalhes: 'Payload não é um JSON válido: ' + err.message,
        payloadBruto: doc.payload,
        receiptDate
      };
    }
  }

  if (!packetObj || typeof packetObj !== 'object') {
    return {
      success: false,
      mongoId: rawId,
      motivo: 'SEM_ESTRUTURA_RECONHECIVEL',
      detalhes: 'Documento não possui objeto de telemetria decodificável',
      payloadBruto: typeof doc.payload === 'string' ? doc.payload : JSON.stringify(doc),
      receiptDate
    };
  }

  // Normalização do identificador do nó (no_id)
  let noId = packetObj.sender || null;
  if (!noId && packetObj.from !== undefined && packetObj.from !== null) {
    try {
      const hex = BigInt(packetObj.from).toString(16);
      noId = `!${hex}`;
    } catch {
      noId = String(packetObj.from);
    }
  }
  if (!noId && doc.topic) {
    const topicParts = doc.topic.split('/');
    const lastPart = topicParts[topicParts.length - 1];
    if (lastPart && (lastPart.startsWith('!') || lastPart.startsWith('serial:'))) {
      noId = lastPart;
    }
  }

  // Normalização do ID do pacote
  let pacoteId = null;
  if (packetObj.id !== undefined && packetObj.id !== null) {
    pacoteId = String(packetObj.id);
  } else if (packetObj.type === 'serial' || (noId && noId.startsWith('serial:'))) {
    // Para pacotes seriais sem id nativo, utilizamos o id do mongo ou o receipt_time para identificação unívoca
    pacoteId = `serial_${rawId || receiptDate.getTime()}`;
  }

  return {
    success: true,
    mongoId: rawId,
    noId,
    pacoteId,
    tipo: packetObj.type || 'desconhecido',
    timestampOriginal: packetObj.timestamp,
    innerPayload: packetObj.payload,
    hopStart: packetObj.hop_start,
    hopsAway: packetObj.hops_away,
    channel: packetObj.channel,
    rawPacket: packetObj,
    payloadBruto: typeof doc.payload === 'string' ? doc.payload : JSON.stringify(packetObj),
    receiptDate
  };
}

export function getReceiptDate(doc) {
  if (doc.data instanceof Date && !isNaN(doc.data.getTime())) {
    return doc.data;
  }
  if (typeof doc.data === 'string' && !isNaN(Date.parse(doc.data))) {
    return new Date(doc.data);
  }
  if (doc.received_at instanceof Date && !isNaN(doc.received_at.getTime())) {
    return doc.received_at;
  }
  if (typeof doc.received_at === 'string' && !isNaN(Date.parse(doc.received_at))) {
    return new Date(doc.received_at);
  }
  return new Date();
}
