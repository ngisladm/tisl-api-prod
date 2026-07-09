const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// GET /folgas
router.get("/", auth, async (req, res) => {
  try {
    const { empresa, equipe, funcionario, data, compensado } = req.query;
    const conds = [], params = [];
    if (empresa)     { params.push(empresa);     conds.push(`f.empresa_id=$${params.length}`); }
    if (equipe)      { params.push(equipe);       conds.push(`f.equipe_id=$${params.length}`); }
    if (funcionario) { params.push(funcionario);  conds.push(`f.funcionario_id=$${params.length}`); }
    if (data)        { params.push(data);         conds.push(`f.data=$${params.length}`); }
    if (compensado)  { params.push(compensado);   conds.push(`f.compensado=$${params.length}`); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const r = await pool.query(
      `SELECT f.id,
              f.empresa_id AS "empresaId", e.nome AS "empresaNome",
              f.equipe_id  AS "equipeId",  eq.name AS "equipeNome",
              f.funcionario_id AS "funcionarioId", fn.nome AS "funcionarioNome",
              TO_CHAR(f.data,'DD/MM/YYYY') AS data,
              f.hora_inicio AS "horaInicio", f.hora_fim AS "horaFim",
              f.total_horas AS "totalHoras", f.compensado, f.observacao
         FROM folgas f
         JOIN empresas   e  ON e.id  = f.empresa_id
         JOIN teams      eq ON eq.id = f.equipe_id
         JOIN funcionarios fn ON fn.id = f.funcionario_id
         ${where}
         ORDER BY f.data DESC, fn.nome`,
      params
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar folgas." }); }
});

// POST /folgas
router.post("/", auth, async (req, res) => {
  const { empresaId, equipeId, funcionarioId, data, horaInicio, horaFim, totalHoras, compensado, observacao } = req.body;
  if (!empresaId || !equipeId || !funcionarioId || !data || !horaInicio || !horaFim)
    return res.status(400).json({ error: "Campos obrigatórios não preenchidos." });
  try {
    const r = await pool.query(
      `INSERT INTO folgas (empresa_id,equipe_id,funcionario_id,data,hora_inicio,hora_fim,total_horas,compensado,observacao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [empresaId, equipeId, funcionarioId, data, horaInicio, horaFim, totalHoras || null, compensado || "Não", observacao || null]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar folga." }); }
});

// PUT /folgas/:id
router.put("/:id", auth, async (req, res) => {
  const { empresaId, equipeId, funcionarioId, data, horaInicio, horaFim, totalHoras, compensado, observacao } = req.body;
  if (!empresaId || !equipeId || !funcionarioId || !data || !horaInicio || !horaFim)
    return res.status(400).json({ error: "Campos obrigatórios não preenchidos." });
  try {
    await pool.query(
      `UPDATE folgas SET empresa_id=$1,equipe_id=$2,funcionario_id=$3,data=$4,
       hora_inicio=$5,hora_fim=$6,total_horas=$7,compensado=$8,observacao=$9 WHERE id=$10`,
      [empresaId, equipeId, funcionarioId, data, horaInicio, horaFim, totalHoras || null, compensado || "Não", observacao || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar folga." }); }
});

// DELETE /folgas/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM folgas WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir folga." }); }
});

// GET /folgas/relatorio
router.get("/relatorio", auth, async (req, res) => {
  try {
    const { empresa, equipe, funcionario, data, compensado } = req.query;
    const conds = [], params = [];
    if (empresa)     { params.push(empresa);     conds.push(`f.empresa_id=$${params.length}`); }
    if (equipe)      { params.push(equipe);       conds.push(`f.equipe_id=$${params.length}`); }
    if (funcionario) { params.push(funcionario);  conds.push(`f.funcionario_id=$${params.length}`); }
    if (data)        { params.push(data);         conds.push(`f.data=$${params.length}`); }
    if (compensado)  { params.push(compensado);   conds.push(`f.compensado=$${params.length}`); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const r = await pool.query(
      `SELECT fn.nome AS "funcionarioNome", eq.name AS "equipeNome",
              TO_CHAR(f.data,'DD/MM/YYYY') AS data,
              f.hora_inicio AS "horaInicio", f.hora_fim AS "horaFim",
              f.total_horas AS "totalHoras", f.compensado, f.observacao
         FROM folgas f
         JOIN teams      eq ON eq.id = f.equipe_id
         JOIN funcionarios fn ON fn.id = f.funcionario_id
         ${where}
         ORDER BY fn.nome, eq.name, f.data DESC`,
      params
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao gerar relatório." }); }
});

module.exports = router;
