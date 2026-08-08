const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { normalizeCentroCusto } = require("../routes/sync");

const apply = process.argv.includes("--apply");
const integerArgument = name => {
  const argument = process.argv.find(item => item.startsWith(`${name}=`));
  if (!argument) return null;
  const value = Number(argument.slice(name.length+1));
  if (!Number.isInteger(value) || value < 0) throw new Error(`Valor inválido para ${name}.`);
  return value;
};
const expectedGroups = integerArgument("--expected-groups");
const expectedRows = integerArgument("--expected-rows");
const outputDir = path.resolve(__dirname, "..", "reports", "employee-duplicates");
const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;
const hasValue = value => value !== null && value !== undefined && String(value).trim() !== "";
const safeTimestamp = date => date.toISOString().replace(/[:.]/g, "-");

const syncFields = ["nome", "cpf", "rg", "logradouro", "numero", "complemento", "bairro", "cidade",
  "estado", "centro_custo", "cargo", "matricula", "coligada", "situacao"];
const manualFields = ["cep", "email", "fone", "observacao"];
const requiredReferences = [
  "consumo_entrega.funcionario_id",
  "controle_ativos.funcionario_id",
  "equipe_itens.funcionario_id",
  "escala_turnos.funcionario_id",
  "extra_avulso.funcionario_id",
  "ferias_equipe.funcionario_id",
  "folgas.funcionario_id",
  "km_records.funcionario_id",
  "manutencao_itens.funcionario_id",
  "manutencao_registros.funcionario_id",
  "pdis.responsavel_funcionario_id",
  "users.funcionario_id",
];

async function discoverForeignKeys(client) {
  const result = await client.query(`
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
  return result.rows;
}

async function loadDuplicateGroups(client) {
  const result = await client.query(`
    WITH duplicate_keys AS (
      SELECT matricula_normalizada, coligada_normalizada
        FROM funcionarios
       WHERE matricula_normalizada IS NOT NULL AND coligada_normalizada IS NOT NULL
       GROUP BY matricula_normalizada, coligada_normalizada HAVING COUNT(*) > 1
    )
    SELECT f.* FROM funcionarios f JOIN duplicate_keys d
      ON d.matricula_normalizada=f.matricula_normalizada
     AND d.coligada_normalizada=f.coligada_normalizada
     ORDER BY f.coligada_normalizada, f.matricula_normalizada, f.created_at, f.id
  `);
  const groups = new Map();
  for (const row of result.rows) {
    const key = `${row.matricula_normalizada}\u0000${row.coligada_normalizada}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()];
}

async function referenceCounts(client, foreignKeys, employeeIds) {
  const counts = new Map(employeeIds.map(id => [id, { total: 0, tables: {} }]));
  for (const fk of foreignKeys) {
    const table = `${quoteIdentifier(fk.schema_name)}.${quoteIdentifier(fk.table_name)}`;
    const column = quoteIdentifier(fk.column_name);
    const result = await client.query(
      `SELECT ${column} AS funcionario_id, COUNT(*)::integer AS quantity
         FROM ${table} WHERE ${column}=ANY($1::uuid[]) GROUP BY ${column}`,
      [employeeIds]
    );
    for (const row of result.rows) {
      const item = counts.get(row.funcionario_id);
      item.total += row.quantity;
      item.tables[`${fk.table_name}.${fk.column_name}`] = row.quantity;
    }
  }
  return counts;
}

function chooseSurvivor(candidates, counts) {
  return [...candidates].sort((left, right) => {
    const countDifference = counts.get(right.id).total-counts.get(left.id).total;
    if (countDifference) return countDifference;
    const leftCreated = left.created_at ? new Date(left.created_at).getTime() : Number.MAX_SAFE_INTEGER;
    const rightCreated = right.created_at ? new Date(right.created_at).getTime() : Number.MAX_SAFE_INTEGER;
    if (leftCreated !== rightCreated) return leftCreated-rightCreated;
    return left.id.localeCompare(right.id);
  })[0];
}

function mergeEmployee(candidates, survivor) {
  const newestFirst = [...candidates].sort((left, right) => {
    const leftUpdated = left.updated_at ? new Date(left.updated_at).getTime() : 0;
    const rightUpdated = right.updated_at ? new Date(right.updated_at).getTime() : 0;
    return rightUpdated-leftUpdated;
  });
  const merged = {};
  for (const field of syncFields) {
    const source = newestFirst.find(candidate => hasValue(candidate[field]));
    merged[field] = source ? source[field] : null;
  }
  merged.centro_custo = normalizeCentroCusto(merged.centro_custo);
  for (const field of manualFields) {
    if (hasValue(survivor[field])) merged[field] = survivor[field];
    else {
      const source = newestFirst.find(candidate => hasValue(candidate[field]));
      merged[field] = source ? source[field] : null;
    }
  }
  merged.matricula_normalizada = survivor.matricula_normalizada;
  merged.coligada_normalizada = survivor.coligada_normalizada;
  return merged;
}

async function main() {
  if (apply && (expectedGroups === null || expectedRows === null)) {
    throw new Error("No modo --apply informe --expected-groups=N e --expected-rows=N conforme o relatório da mesma base.");
  }
  const client = await pool.connect();
  const startedAt = new Date();
  const audit = { startedAt: startedAt.toISOString(), mode: apply ? "APPLY" : "DRY_RUN", databaseMutation: false };
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    if (apply) await client.query("LOCK TABLE funcionarios IN SHARE ROW EXCLUSIVE MODE");

    const foreignKeys = await discoverForeignKeys(client);
    const discoveredReferences = new Set(foreignKeys.map(fk => `${fk.table_name}.${fk.column_name}`));
    const missingReferences = requiredReferences.filter(reference => !discoveredReferences.has(reference));
    if (missingReferences.length) {
      throw new Error(`Referências obrigatórias ausentes: ${missingReferences.join(", ")}.`);
    }
    const groups = await loadDuplicateGroups(client);
    const rowsInGroups = groups.reduce((total, group) => total+group.length, 0);
    if (apply && (groups.length !== expectedGroups || rowsInGroups !== expectedRows)) {
      throw new Error(`A base mudou após o relatório: esperados ${expectedGroups} grupos/${expectedRows} linhas; encontrados ${groups.length}/${rowsInGroups}.`);
    }

    const employeeIds = groups.flatMap(group => group.map(candidate => candidate.id));
    const counts = await referenceCounts(client, foreignKeys, employeeIds);
    const mappings = [];
    const mergeRows = [];
    const duplicateMappings = [];
    for (const candidates of groups) {
      const survivor = chooseSurvivor(candidates, counts);
      const duplicates = candidates.filter(candidate => candidate.id !== survivor.id);
      const merged = mergeEmployee(candidates, survivor);
      mappings.push({
        normalizedKey: `${survivor.matricula_normalizada}||${survivor.coligada_normalizada}`,
        survivorId: survivor.id,
        survivorBefore: { nome: survivor.nome, matricula: survivor.matricula, centro_custo: survivor.centro_custo },
        merged: { nome: merged.nome, matricula: merged.matricula, centro_custo: merged.centro_custo },
        duplicateIds: duplicates.map(candidate => candidate.id),
        referencesBefore: candidates.map(candidate => ({ id: candidate.id, ...counts.get(candidate.id) })),
      });
      mergeRows.push({ id: survivor.id, ...merged });
      for (const duplicate of duplicates) {
        duplicateMappings.push({ duplicate_id: duplicate.id, survivor_id: survivor.id });
      }
    }

    audit.groups = groups.length;
    audit.rowsInGroups = rowsInGroups;
    audit.rowsToRemove = rowsInGroups-groups.length;
    audit.foreignKeys = foreignKeys;
    audit.sensitiveMappings = mappings.filter(mapping => mapping.referencesBefore.filter(item => item.total > 0).length > 1);
    audit.andre = mappings.find(mapping => mapping.survivorBefore.nome === "ANDRE BASTOS MORAIS");

    if (apply) {
      await client.query(`CREATE TEMP TABLE employee_merge_map (
        duplicate_id UUID PRIMARY KEY, survivor_id UUID NOT NULL
      ) ON COMMIT DROP`);
      await client.query(`INSERT INTO employee_merge_map (duplicate_id,survivor_id)
        SELECT duplicate_id,survivor_id FROM json_to_recordset($1::json)
          AS source(duplicate_id UUID,survivor_id UUID)`, [JSON.stringify(duplicateMappings)]);

      audit.transferredReferences = {};
      for (const fk of foreignKeys) {
        const table = `${quoteIdentifier(fk.schema_name)}.${quoteIdentifier(fk.table_name)}`;
        const column = quoteIdentifier(fk.column_name);
        const transferred = await client.query(`UPDATE ${table} target SET ${column}=mapping.survivor_id
          FROM employee_merge_map mapping WHERE target.${column}=mapping.duplicate_id`);
        audit.transferredReferences[`${fk.table_name}.${fk.column_name}`] = transferred.rowCount;
      }

      const deleted = await client.query(`DELETE FROM funcionarios target USING employee_merge_map mapping
        WHERE target.id=mapping.duplicate_id`);
      if (deleted.rowCount !== duplicateMappings.length) {
        throw new Error(`Exclusão incompleta: esperados ${duplicateMappings.length}; excluídos ${deleted.rowCount}.`);
      }

      await client.query(`CREATE TEMP TABLE employee_merge_data (
        id UUID PRIMARY KEY, nome TEXT, cpf TEXT, rg TEXT, logradouro TEXT, numero TEXT, complemento TEXT,
        bairro TEXT, cidade TEXT, estado TEXT, centro_custo TEXT, cargo TEXT, matricula TEXT, coligada TEXT,
        situacao TEXT, cep TEXT, email TEXT, fone TEXT, observacao TEXT,
        matricula_normalizada TEXT, coligada_normalizada TEXT
      ) ON COMMIT DROP`);
      await client.query(`INSERT INTO employee_merge_data
        SELECT * FROM json_to_recordset($1::json) AS source(
          id UUID, nome TEXT, cpf TEXT, rg TEXT, logradouro TEXT, numero TEXT, complemento TEXT,
          bairro TEXT, cidade TEXT, estado TEXT, centro_custo TEXT, cargo TEXT, matricula TEXT, coligada TEXT,
          situacao TEXT, cep TEXT, email TEXT, fone TEXT, observacao TEXT,
          matricula_normalizada TEXT, coligada_normalizada TEXT
        )`, [JSON.stringify(mergeRows)]);
      const updated = await client.query(`UPDATE funcionarios target SET
        nome=source.nome, cpf=source.cpf, rg=source.rg, logradouro=source.logradouro, numero=source.numero,
        complemento=source.complemento, bairro=source.bairro, cidade=source.cidade, estado=source.estado,
        centro_custo=source.centro_custo, cargo=source.cargo, matricula=source.matricula,
        coligada=source.coligada, situacao=source.situacao, cep=source.cep, email=source.email,
        fone=source.fone, observacao=source.observacao, matricula_normalizada=source.matricula_normalizada,
        coligada_normalizada=source.coligada_normalizada, updated_at=NOW()
        FROM employee_merge_data source WHERE target.id=source.id`);
      if (updated.rowCount !== mergeRows.length) {
        throw new Error(`Atualização incompleta: esperados ${mergeRows.length}; atualizados ${updated.rowCount}.`);
      }

      await client.query(`CREATE UNIQUE INDEX funcionarios_normalized_unique
        ON funcionarios(matricula_normalizada,coligada_normalizada)
        WHERE matricula_normalizada IS NOT NULL AND coligada_normalizada IS NOT NULL`);
      const remaining = await client.query(`SELECT COUNT(*)::integer AS quantity FROM (
        SELECT 1 FROM funcionarios WHERE matricula_normalizada IS NOT NULL AND coligada_normalizada IS NOT NULL
        GROUP BY matricula_normalizada,coligada_normalizada HAVING COUNT(*)>1
      ) duplicates`);
      if (remaining.rows[0].quantity !== 0) throw new Error(`${remaining.rows[0].quantity} grupos duplicados permaneceram.`);
      await client.query("COMMIT");
      audit.databaseMutation = true;
      audit.remainingDuplicateGroups = 0;
    } else {
      await client.query("ROLLBACK");
    }

    audit.finishedAt = new Date().toISOString();
    fs.mkdirSync(outputDir, { recursive: true });
    const auditPath = path.join(outputDir, `consolidation-${apply ? "applied" : "dry-run"}-${safeTimestamp(startedAt)}.json`);
    fs.writeFileSync(auditPath, `${JSON.stringify({ audit, mappings }, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ audit, auditPath }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode=1; }).finally(() => pool.end());
