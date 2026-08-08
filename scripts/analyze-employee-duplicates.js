const fs = require("fs");
const path = require("path");
const pool = require("../db");

const outputDir = path.resolve(__dirname, "..", "reports", "employee-duplicates");

const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;
const csvValue = value => {
  if (value == null) return "";
  const content = typeof value === "string" ? value : JSON.stringify(value);
  return `"${content.replace(/"/g, '""')}"`;
};
const safeTimestamp = date => date.toISOString().replace(/[:.]/g, "-");

async function main() {
  const columnCheck = await pool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='funcionarios'
       AND column_name IN ('matricula_normalizada','coligada_normalizada')
  `);
  if (columnCheck.rowCount !== 2) {
    throw new Error("As colunas normalizadas ainda não foram criadas. Reinicie a API local uma vez e execute novamente.");
  }

  const duplicateRows = await pool.query(`
    WITH duplicate_keys AS (
      SELECT matricula_normalizada, coligada_normalizada
        FROM funcionarios
       WHERE matricula_normalizada IS NOT NULL AND coligada_normalizada IS NOT NULL
       GROUP BY matricula_normalizada, coligada_normalizada HAVING COUNT(*) > 1
    )
    SELECT f.id, f.nome, f.matricula, f.coligada, f.cpf, f.centro_custo,
           f.situacao, f.created_at, f.updated_at,
           f.matricula_normalizada, f.coligada_normalizada
      FROM funcionarios f JOIN duplicate_keys d
        ON d.matricula_normalizada=f.matricula_normalizada
       AND d.coligada_normalizada=f.coligada_normalizada
     ORDER BY f.coligada_normalizada, f.matricula_normalizada, f.created_at, f.id
  `);

  const foreignKeys = await pool.query(`
    SELECT source_ns.nspname AS schema_name, source_table.relname AS table_name,
           source_column.attname AS column_name, constraint_info.conname AS constraint_name
      FROM pg_constraint constraint_info
      JOIN pg_class source_table ON source_table.oid=constraint_info.conrelid
      JOIN pg_namespace source_ns ON source_ns.oid=source_table.relnamespace
      JOIN LATERAL unnest(constraint_info.conkey) WITH ORDINALITY source_key(attnum,ord) ON TRUE
      JOIN LATERAL unnest(constraint_info.confkey) WITH ORDINALITY target_key(attnum,ord)
        ON target_key.ord=source_key.ord
      JOIN pg_attribute source_column ON source_column.attrelid=constraint_info.conrelid
                                     AND source_column.attnum=source_key.attnum
      JOIN pg_attribute target_column ON target_column.attrelid=constraint_info.confrelid
                                     AND target_column.attnum=target_key.attnum
     WHERE constraint_info.contype='f'
       AND constraint_info.confrelid='public.funcionarios'::regclass
       AND target_column.attname='id'
     ORDER BY source_ns.nspname, source_table.relname, source_column.attname
  `);

  const referencesByEmployee = new Map();
  const totalsByReference = {};
  for (const fk of foreignKeys.rows) {
    const referenceName = `${fk.table_name}.${fk.column_name}`;
    const table = `${quoteIdentifier(fk.schema_name)}.${quoteIdentifier(fk.table_name)}`;
    const column = quoteIdentifier(fk.column_name);
    const counts = await pool.query(`SELECT ${column} AS funcionario_id, COUNT(*)::integer AS quantity
                                       FROM ${table} WHERE ${column} IS NOT NULL GROUP BY ${column}`);
    totalsByReference[referenceName] = counts.rows.reduce((total, row) => total + row.quantity, 0);
    for (const row of counts.rows) {
      const employeeReferences = referencesByEmployee.get(row.funcionario_id) || {};
      employeeReferences[referenceName] = row.quantity;
      referencesByEmployee.set(row.funcionario_id, employeeReferences);
    }
  }

  const groups = new Map();
  for (const employee of duplicateRows.rows) {
    const key = `${employee.matricula_normalizada}\u0000${employee.coligada_normalizada}`;
    const references = referencesByEmployee.get(employee.id) || {};
    const totalReferences = Object.values(references).reduce((total, quantity) => total + quantity, 0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...employee, totalReferences, references });
  }

  const analyses = [...groups.values()].map(candidates => {
    candidates.sort((left, right) => {
      if (right.totalReferences !== left.totalReferences) return right.totalReferences-left.totalReferences;
      const leftCreated = left.created_at ? new Date(left.created_at).getTime() : Number.MAX_SAFE_INTEGER;
      const rightCreated = right.created_at ? new Date(right.created_at).getTime() : Number.MAX_SAFE_INTEGER;
      if (leftCreated !== rightCreated) return leftCreated-rightCreated;
      return left.id.localeCompare(right.id);
    });
    const withReferences = candidates.filter(candidate => candidate.totalReferences > 0);
    return {
      matriculaNormalizada: candidates[0].matricula_normalizada,
      coligadaNormalizada: candidates[0].coligada_normalizada,
      quantity: candidates.length,
      excessRows: candidates.length-1,
      requiresReferenceReview: withReferences.length > 1,
      candidatesWithReferences: withReferences.length,
      suggestedSurvivorId: candidates[0].id,
      candidates,
    };
  });
  analyses.sort((left, right) =>
    Number(right.requiresReferenceReview)-Number(left.requiresReferenceReview) ||
    left.coligadaNormalizada.localeCompare(right.coligadaNormalizada) ||
    left.matriculaNormalizada.localeCompare(right.matriculaNormalizada, undefined, { numeric: true })
  );

  const generatedAt = new Date();
  const summary = {
    generatedAt: generatedAt.toISOString(), databaseMutation: false,
    rule: "matricula sem zeros à esquerda + coligada sem espaços excedentes e em maiúsculas",
    duplicateGroups: analyses.length,
    rowsInDuplicateGroups: analyses.reduce((total, group) => total+group.quantity, 0),
    excessRows: analyses.reduce((total, group) => total+group.excessRows, 0),
    groupsRequiringReferenceReview: analyses.filter(group => group.requiresReferenceReview).length,
    groupsWithNoReferences: analyses.filter(group => group.candidates.every(candidate => candidate.totalReferences===0)).length,
    discoveredForeignKeys: foreignKeys.rowCount,
    references: foreignKeys.rows,
    totalRowsByReference: totalsByReference,
  };

  const header = ["matricula_normalizada","coligada_normalizada","quantidade","excedentes",
    "requer_revisao_vinculos","candidatos_com_vinculos","id_sobrevivente_sugerido","nome_sobrevivente",
    "matricula_sobrevivente","vinculos_sobrevivente","ids_do_grupo","matriculas_do_grupo","cpfs_do_grupo","detalhes_vinculos"];
  const lines = [header.map(csvValue).join(",")];
  for (const group of analyses) {
    const survivor = group.candidates[0];
    lines.push([group.matriculaNormalizada,group.coligadaNormalizada,group.quantity,group.excessRows,
      group.requiresReferenceReview ? "SIM" : "NÃO",group.candidatesWithReferences,survivor.id,survivor.nome,
      survivor.matricula,survivor.totalReferences,group.candidates.map(c => c.id).join(" | "),
      group.candidates.map(c => c.matricula).join(" | "),group.candidates.map(c => c.cpf || "").join(" | "),
      group.candidates.map(c => ({ id:c.id,nome:c.nome,matricula:c.matricula,total:c.totalReferences,porTabela:c.references }))
    ].map(csvValue).join(","));
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = safeTimestamp(generatedAt);
  const files = {
    summaryPath: path.join(outputDir, `summary-${stamp}.json`),
    detailsPath: path.join(outputDir, `details-${stamp}.json`),
    csvPath: path.join(outputDir, `review-${stamp}.csv`),
  };
  fs.writeFileSync(files.summaryPath, `${JSON.stringify(summary,null,2)}\n`, "utf8");
  fs.writeFileSync(files.detailsPath, `${JSON.stringify({ summary,groups:analyses },null,2)}\n`, "utf8");
  fs.writeFileSync(files.csvPath, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
  console.log(JSON.stringify({ summary,files },null,2));
}

main().catch(error => { console.error(error.message); process.exitCode=1; }).finally(() => pool.end());
