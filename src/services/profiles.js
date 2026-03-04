const { pool } = require("../db");

function normalizeEmbedding(value) {
  if (!Array.isArray(value) || value.length < 64) {
    throw new Error("Embedding invalido. Esperado array numerico com ao menos 64 posicoes.");
  }

  const normalized = value.map((item) => Number(item));
  const hasInvalidNumber = normalized.some((item) => !Number.isFinite(item));

  if (hasInvalidNumber) {
    throw new Error("Embedding contem valores invalidos.");
  }

  return normalized;
}

function parseEmbeddingField(field) {
  if (Buffer.isBuffer(field)) {
    return normalizeEmbedding(JSON.parse(field.toString("utf8")));
  }

  if (Array.isArray(field)) {
    return normalizeEmbedding(field);
  }

  if (typeof field === "string") {
    return normalizeEmbedding(JSON.parse(field));
  }

  if (field && typeof field === "object") {
    return normalizeEmbedding(field);
  }

  throw new Error("Falha ao ler embedding salvo.");
}

function parseJsonField(field, fallback = {}) {
  try {
    if (field === null || field === undefined) {
      return fallback;
    }

    if (Buffer.isBuffer(field)) {
      return JSON.parse(field.toString("utf8"));
    }

    if (typeof field === "string") {
      return JSON.parse(field);
    }

    if (typeof field === "object") {
      return field;
    }

    return fallback;
  } catch (_error) {
    return fallback;
  }
}

async function listProfiles() {
  const [rows] = await pool.query(
    "SELECT id, name, category, consent, notes, embedding_json, created_at FROM profiles ORDER BY id DESC",
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    consent: Boolean(row.consent),
    notes: row.notes,
    createdAt: row.created_at,
    embedding: parseEmbeddingField(row.embedding_json),
  }));
}

async function createProfile(payload) {
  const name = String(payload?.name || "").trim();
  const category = String(payload?.category || "guest").trim();
  const notes = payload?.notes ? String(payload.notes).slice(0, 1000) : null;
  const consent = payload?.consent === false ? 0 : 1;
  const embedding = normalizeEmbedding(payload?.embedding);

  const allowedCategories = new Set(["staff", "vip", "blocked", "guest"]);
  if (!name) {
    throw new Error("Nome e obrigatorio.");
  }
  if (!allowedCategories.has(category)) {
    throw new Error("Categoria invalida. Use staff, vip, blocked ou guest.");
  }

  const [result] = await pool.query(
    "INSERT INTO profiles (name, category, consent, notes, embedding_json) VALUES (?, ?, ?, ?, CAST(? AS JSON))",
    [name, category, consent, notes, JSON.stringify(embedding)],
  );

  const [rows] = await pool.query(
    "SELECT id, name, category, consent, notes, embedding_json, created_at FROM profiles WHERE id = ?",
    [result.insertId],
  );

  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    consent: Boolean(row.consent),
    notes: row.notes,
    createdAt: row.created_at,
    embedding: parseEmbeddingField(row.embedding_json),
  };
}

async function deleteProfile(id) {
  const [result] = await pool.query("DELETE FROM profiles WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

async function registerDetection({
  profileId,
  cameraLabel,
  distance,
  confidence,
  matched,
  metadata,
}) {
  await pool.query(
    "INSERT INTO detections (profile_id, camera_label, distance, confidence, matched, metadata_json) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))",
    [
      profileId || null,
      cameraLabel || "entrada-principal",
      distance ?? null,
      confidence ?? null,
      matched ? 1 : 0,
      JSON.stringify(metadata || {}),
    ],
  );
}

async function listDetections(limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const [rows] = await pool.query(
    `
      SELECT
        d.id,
        d.profile_id,
        p.name AS profile_name,
        p.category AS profile_category,
        d.camera_label,
        d.distance,
        d.confidence,
        d.matched,
        d.metadata_json,
        d.created_at
      FROM detections d
      LEFT JOIN profiles p ON p.id = d.profile_id
      ORDER BY d.id DESC
      LIMIT ?
    `,
    [safeLimit],
  );

  return rows.map((row) => ({
    id: row.id,
    profileId: row.profile_id,
    profileName: row.profile_name,
    profileCategory: row.profile_category,
    cameraLabel: row.camera_label,
    distance: row.distance,
    confidence: row.confidence,
    matched: Boolean(row.matched),
    metadata: parseJsonField(row.metadata_json, {}),
    createdAt: row.created_at,
  }));
}

async function getDetectionStats(hours = 24) {
  const safeHours = Math.max(1, Math.min(Number(hours) || 24, 168));
  const [rows] = await pool.query(
    `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN d.matched = 1 THEN 1 ELSE 0 END) AS matched,
        SUM(CASE WHEN d.matched = 0 THEN 1 ELSE 0 END) AS unmatched,
        SUM(CASE WHEN p.category = 'blocked' AND d.matched = 1 THEN 1 ELSE 0 END) AS blocked_hits
      FROM detections d
      LEFT JOIN profiles p ON p.id = d.profile_id
      WHERE d.created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
    `,
    [safeHours],
  );

  const stats = rows[0] || {};
  return {
    windowHours: safeHours,
    total: Number(stats.total || 0),
    matched: Number(stats.matched || 0),
    unmatched: Number(stats.unmatched || 0),
    blockedHits: Number(stats.blocked_hits || 0),
  };
}

async function getCategoryBreakdown(hours = 24) {
  const safeHours = Math.max(1, Math.min(Number(hours) || 24, 168));
  const [rows] = await pool.query(
    `
      SELECT
        COALESCE(p.category, 'unknown') AS category,
        COUNT(*) AS total,
        SUM(CASE WHEN d.matched = 1 THEN 1 ELSE 0 END) AS matched
      FROM detections d
      LEFT JOIN profiles p ON p.id = d.profile_id
      WHERE d.created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
      GROUP BY COALESCE(p.category, 'unknown')
      ORDER BY total DESC
    `,
    [safeHours],
  );

  const categories = {
    staff: 0,
    vip: 0,
    blocked: 0,
    guest: 0,
    unknown: 0,
  };

  for (const row of rows) {
    const category = String(row.category || "unknown");
    if (!Object.hasOwn(categories, category)) {
      categories.unknown += Number(row.total || 0);
      continue;
    }
    categories[category] = Number(row.total || 0);
  }

  return {
    windowHours: safeHours,
    categories,
    rows: rows.map((row) => ({
      category: String(row.category || "unknown"),
      total: Number(row.total || 0),
      matched: Number(row.matched || 0),
    })),
  };
}

async function getDetectionsTimeline(minutes = 90, bucketMinutes = 3) {
  const safeMinutes = Math.max(5, Math.min(Number(minutes) || 90, 12 * 60));
  const safeBucketMinutes = Math.max(1, Math.min(Number(bucketMinutes) || 3, 30));
  const bucketSeconds = safeBucketMinutes * 60;
  const bucketMs = bucketSeconds * 1000;

  const [rows] = await pool.query(
    `
      SELECT
        FROM_UNIXTIME(
          FLOOR(UNIX_TIMESTAMP(d.created_at) / ?) * ?
        ) AS bucket_start,
        COUNT(*) AS total,
        SUM(CASE WHEN d.matched = 1 THEN 1 ELSE 0 END) AS matched,
        SUM(CASE WHEN d.matched = 0 THEN 1 ELSE 0 END) AS unmatched
      FROM detections d
      WHERE d.created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
      GROUP BY bucket_start
      ORDER BY bucket_start ASC
    `,
    [bucketSeconds, bucketSeconds, safeMinutes],
  );

  const pointsByMs = new Map();
  for (const row of rows) {
    const bucketStart = new Date(row.bucket_start).getTime();
    const key = Math.floor(bucketStart / bucketMs) * bucketMs;
    pointsByMs.set(key, {
      bucketStart: new Date(key).toISOString(),
      label: new Date(key).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      total: Number(row.total || 0),
      matched: Number(row.matched || 0),
      unmatched: Number(row.unmatched || 0),
    });
  }

  const points = [];
  const alignedNow = Math.floor(Date.now() / bucketMs) * bucketMs;
  const totalBuckets = Math.max(1, Math.ceil(safeMinutes / safeBucketMinutes));
  const start = alignedNow - (totalBuckets - 1) * bucketMs;

  for (let i = 0; i < totalBuckets; i += 1) {
    const bucketStart = start + i * bucketMs;
    const existing = pointsByMs.get(bucketStart);
    points.push(
      existing || {
        bucketStart: new Date(bucketStart).toISOString(),
        label: new Date(bucketStart).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        total: 0,
        matched: 0,
        unmatched: 0,
      },
    );
  }

  return {
    windowMinutes: safeMinutes,
    bucketMinutes: safeBucketMinutes,
    points,
  };
}

module.exports = {
  normalizeEmbedding,
  listProfiles,
  createProfile,
  deleteProfile,
  registerDetection,
  listDetections,
  getDetectionStats,
  getCategoryBreakdown,
  getDetectionsTimeline,
};
