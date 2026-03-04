require("dotenv").config();

const path = require("path");
const express = require("express");
const { initSchema, pingDatabase, closePool } = require("./db");
const {
  listProfiles,
  createProfile,
  deleteProfile,
  listDetections,
} = require("./services/profiles");
const { identifyFace } = require("./services/recognition");
const { tessAnalyze } = require("./services/tess");

const app = express();
const port = Number(process.env.PORT || 3000);
const appName = process.env.APP_NAME || "TESS Face Security";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.resolve(__dirname, "..", "public")));

app.get("/health", async (_req, res) => {
  try {
    const ok = await pingDatabase();
    res.json({ ok, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/api/status", async (_req, res) => {
  try {
    const databaseOk = await pingDatabase();
    res.json({
      appName,
      status: "online",
      database: databaseOk ? "connected" : "disconnected",
      now: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      appName,
      status: "error",
      database: "unreachable",
      message: error.message,
    });
  }
});

app.get("/api/profiles", async (_req, res) => {
  try {
    const profiles = await listProfiles();
    const slim = profiles.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      consent: item.consent,
      notes: item.notes,
      createdAt: item.createdAt,
      embeddingSize: item.embedding.length,
    }));
    res.json({ total: slim.length, profiles: slim });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/profiles", async (req, res) => {
  try {
    const profile = await createProfile(req.body || {});
    res.status(201).json({
      id: profile.id,
      name: profile.name,
      category: profile.category,
      consent: profile.consent,
      notes: profile.notes,
      createdAt: profile.createdAt,
      embeddingSize: profile.embedding.length,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.delete("/api/profiles/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "ID invalido." });
  }

  try {
    const deleted = await deleteProfile(id);
    return res.json({ deleted });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/recognition/identify", async (req, res) => {
  try {
    const result = await identifyFace({
      embedding: req.body?.embedding,
      cameraLabel: req.body?.cameraLabel,
      threshold: req.body?.threshold,
    });

    return res.json(result);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/detections", async (req, res) => {
  try {
    const detections = await listDetections(req.query.limit);
    return res.json({ total: detections.length, detections });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/tess/analyze", async (req, res) => {
  try {
    const result = await tessAnalyze(req.body?.question);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "..", "public", "index.html"));
});

async function bootstrap() {
  await initSchema();

  const server = app.listen(port, () => {
    console.log(`${appName} online na porta ${port}`);
  });

  async function gracefulShutdown(signal) {
    console.log(`${signal} recebido. Encerrando TESS Face Security...`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  }

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
}

bootstrap().catch((error) => {
  console.error("Falha ao iniciar aplicacao:", error);
  process.exit(1);
});
