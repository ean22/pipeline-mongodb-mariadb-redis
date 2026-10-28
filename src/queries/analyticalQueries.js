import { MariaDatabase } from '../database/mariadb.js';

export async function runAnalyticalQueries() {
  const maria = new MariaDatabase();
  await maria.connect();
  const prefix = maria.prefix;

  try {
    console.log('\n========================================================================');
    console.log('📊 CONSULTA 1: Últimas 10 Leituras da Série Temporal por Nó e Métrica');
    console.log('========================================================================');
    const q1Sql = `
      SELECT
        no_id,
        pacote_id,
        metrica,
        valor,
        timestamp_medicao,
        CASE WHEN timestamp_fallback = 1 THEN 'SIM (Doc.Data)' ELSE 'NÃO (Nó)' END AS fallback_aplicado,
        recebido_em
      FROM \`${prefix}serie_temporal\`
      ORDER BY timestamp_medicao DESC
      LIMIT 10;
    `;
    const q1Rows = await maria.query(q1Sql);
    console.table(q1Rows);

    console.log('\n========================================================================');
    console.log('📊 CONSULTA 2: Agregação Estatística Diária (Média, Mín, Máx e Contagem)');
    console.log('========================================================================');
    const q2Sql = `
      SELECT
        no_id,
        metrica,
        janela_dia,
        media_valor,
        min_valor,
        max_valor,
        contagem_leituras
      FROM \`${prefix}agg_dia\`
      ORDER BY janela_dia DESC, no_id, metrica;
    `;
    const q2Rows = await maria.query(q2Sql);
    console.table(q2Rows);

    console.log('\n========================================================================');
    console.log('📊 CONSULTA 3: Auditoria da Quarentena por Motivo de Rejeição');
    console.log('========================================================================');
    const q3Sql = `
      SELECT
        motivo_rejeicao,
        tipo_mensagem,
        COUNT(*) AS total_mensagens,
        MIN(recebido_em) AS primeiro_registro,
        MAX(recebido_em) AS ultimo_registro
      FROM \`${prefix}quarentena\`
      GROUP BY motivo_rejeicao, tipo_mensagem
      ORDER BY total_mensagens DESC;
    `;
    const q3Rows = await maria.query(q3Sql);
    console.table(q3Rows);

    console.log('\n========================================================================');
    console.log('📊 INDICADORES GERAIS PERSISTIDOS NO MARIADB');
    console.log('========================================================================');
    const q4Sql = `
      SELECT nome, valor, descricao, atualizado_em
      FROM \`${prefix}indicadores\`
      ORDER BY valor DESC;
    `;
    const q4Rows = await maria.query(q4Sql);
    console.table(q4Rows);

    return { q1Rows, q2Rows, q3Rows, q4Rows };
  } finally {
    await maria.disconnect();
  }
}

if (process.argv[1] && process.argv[1].endsWith('analyticalQueries.js')) {
  runAnalyticalQueries().catch(err => {
    console.error('Erro ao executar consultas analíticas:', err);
    process.exitCode = 1;
  });
}
