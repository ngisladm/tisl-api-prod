const pool = require("../db");

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const duplicateGroups = await client.query(`SELECT COUNT(*)::integer AS quantity FROM (
      SELECT 1 FROM funcionarios WHERE matricula_normalizada IS NOT NULL AND coligada_normalizada IS NOT NULL
      GROUP BY matricula_normalizada,coligada_normalizada HAVING COUNT(*)>1
    ) duplicated`);
    const uniqueIndex = await client.query(`SELECT indexname,indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename='funcionarios' AND indexname='funcionarios_normalized_unique'`);
    const andre = await client.query(`SELECT * FROM funcionarios
      WHERE nome='ANDRE BASTOS MORAIS' AND matricula_normalizada='120'
        AND coligada_normalizada='S.L. ADMINISTRACAO E PARTICIPACOES LTDA'`);
    if (andre.rowCount !== 1) throw new Error(`Esperado 1 cadastro do André; encontrados ${andre.rowCount}.`);
    const employee = andre.rows[0];
    const simulatedUpsert = await client.query(`INSERT INTO funcionarios
      (nome,matricula,coligada,matricula_normalizada,coligada_normalizada,situacao,updated_at)
      VALUES ($1,'120',$2,'120',$3,'Ativo',NOW())
      ON CONFLICT (matricula_normalizada,coligada_normalizada)
        WHERE matricula_normalizada IS NOT NULL AND coligada_normalizada IS NOT NULL
      DO UPDATE SET nome=EXCLUDED.nome,updated_at=EXCLUDED.updated_at RETURNING id`,
      [employee.nome,employee.coligada,employee.coligada_normalizada]);
    if (simulatedUpsert.rows[0].id !== employee.id) throw new Error("O upsert não reutilizou o cadastro existente do André.");

    const renan = await client.query(`SELECT f.id,f.nome,f.matricula,f.centro_custo,
      (SELECT COUNT(*)::integer FROM manutencao_itens mi WHERE mi.funcionario_id=f.id) AS manutencoes
      FROM funcionarios f WHERE f.nome='RENAN CHAVES AGUIAR' AND f.matricula_normalizada='42'
        AND f.coligada_normalizada='S.L. ADMINISTRACAO E PARTICIPACOES LTDA'`);
    if (renan.rowCount !== 1 || renan.rows[0].manutencoes !== 1) {
      throw new Error("A validação do cadastro/vínculo de manutenção do Renan falhou.");
    }
    await client.query("ROLLBACK");
    console.log(JSON.stringify({
      ok: true, databaseMutation: false,
      duplicateGroups: duplicateGroups.rows[0].quantity,
      normalizedUniqueIndex: uniqueIndex.rowCount === 1,
      andre: { id:employee.id,nome:employee.nome,matricula:employee.matricula,centroCusto:employee.centro_custo,
        simulatedUpsertReturnedSameId:true },
      renan: renan.rows[0],
    },null,2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode=1; }).finally(() => pool.end());
