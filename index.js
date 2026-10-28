import { PipelineProcessor } from './src/pipeline/processor.js';

async function main() {
  console.log('=====================================================');
  console.log('🚀 INICIANDO PIPELINE DE PROCESSAMENTO E MODELAGEM');
  console.log('=====================================================');

  const startTime = Date.now();
  const processor = new PipelineProcessor();

  try {
    console.log('📡 Conectando aos bancos (MongoDB, MariaDB, Redis)...');
    await processor.init();
    console.log('✅ Conexões estabelecidas e tabelas prontas.');

    console.log('🔄 Executando leitura, deduplicação, validação e persistência...');
    const stats = await processor.run();

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n=====================================================');
    console.log('📊 INDICADORES FINAIS DO PIPELINE (CONCLUÍDO)');
    console.log('=====================================================');
    console.log(`⏱️ Tempo total de execução: ${elapsedSec}s`);
    console.log(`📥 Total de documentos lidos do MongoDB: ${stats.processadas}`);
    console.log(`🔁 Duplicatas detectadas e descartadas:  ${stats.duplicadas}`);
    console.log(`🚫 Mensagens rejeitadas (Quarentena):    ${stats.rejeitadas}`);
    console.log(`⏰ Timestamps inválidos c/ fallback:    ${stats.timestampsFallback}`);
    console.log(`📈 Séries temporais válidas persistidas: ${stats.metricasInseridas}`);

    console.log('\n📋 Motivos de Envio para Quarentena:');
    for (const [motivo, count] of Object.entries(stats.quarentenaPorMotivo)) {
      console.log(`   - ${motivo}: ${count}`);
    }

    console.log('=====================================================\n');
  } catch (err) {
    console.error('❌ Erro durante a execução do pipeline:', err);
    process.exitCode = 1;
  } finally {
    await processor.close();
    console.log('🔌 Conexões finalizadas com sucesso.');
  }
}

main();
