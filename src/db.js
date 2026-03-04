const mysql = require("mysql2/promise");

function parseDatabaseUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.replace(/^\/+/, "");

  if (!databaseName) {
    throw new Error("DATABASE_URL sem nome de banco.");
  }

  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: databaseName,
  };
}

function buildConnectionConfig() {
  const databaseUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;
  if (databaseUrl) {
    return parseDatabaseUrl(databaseUrl);
  }

  const {
    MYSQLHOST,
    MYSQLPORT,
    MYSQLUSER,
    MYSQLPASSWORD,
    MYSQLDATABASE,
  } = process.env;

  if (!MYSQLHOST || !MYSQLUSER || !MYSQLDATABASE) {
    throw new Error(
      "Defina DATABASE_URL (ou MYSQL_URL) ou MYSQLHOST, MYSQLUSER e MYSQLDATABASE.",
    );
  }

  return {
    host: MYSQLHOST,
    port: Number(MYSQLPORT || 3306),
    user: MYSQLUSER,
    password: MYSQLPASSWORD || "",
    database: MYSQLDATABASE,
  };
}

const pool = mysql.createPool({
  ...buildConnectionConfig(),
  connectionLimit: 8,
  enableKeepAlive: true,
});

async function pingDatabase() {
  const [rows] = await pool.query("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      category ENUM('staff', 'vip', 'blocked', 'guest') NOT NULL DEFAULT 'guest',
      consent TINYINT(1) NOT NULL DEFAULT 1,
      embedding_json JSON NOT NULL,
      notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS detections (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      profile_id BIGINT UNSIGNED NULL,
      camera_label VARCHAR(120) NOT NULL DEFAULT 'entrada-principal',
      distance DOUBLE NULL,
      confidence DOUBLE NULL,
      matched TINYINT(1) NOT NULL DEFAULT 0,
      metadata_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_detections_created_at (created_at),
      INDEX idx_detections_matched (matched),
      CONSTRAINT fk_detections_profile FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE SET NULL
    );
  `);
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  initSchema,
  pingDatabase,
  closePool,
};
