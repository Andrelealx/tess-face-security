const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";
const AUTO_SCAN_INTERVAL_MS = 2400;
const ANALYTICS_REFRESH_MS = 10000;
const MAX_CONFIDENCE_POINTS = 28;

const ui = {
  video: document.getElementById("video"),
  overlay: document.getElementById("overlay"),
  apiStatus: document.getElementById("apiStatus"),
  watchMode: document.getElementById("watchMode"),
  faceSignal: document.getElementById("faceSignal"),
  cameraHint: document.getElementById("cameraHint"),
  identifyResult: document.getElementById("identifyResult"),
  liveLog: document.getElementById("liveLog"),
  riskFill: document.getElementById("riskFill"),
  riskLabel: document.getElementById("riskLabel"),
  matchCounter: document.getElementById("matchCounter"),
  unmatchedCounter: document.getElementById("unmatchedCounter"),
  blockedCounter: document.getElementById("blockedCounter"),
  totalCounter: document.getElementById("totalCounter"),
  profilesTable: document.getElementById("profilesTable"),
  detectionsTable: document.getElementById("detectionsTable"),
  profileName: document.getElementById("profileName"),
  profileCategory: document.getElementById("profileCategory"),
  profileNotes: document.getElementById("profileNotes"),
  cameraLabel: document.getElementById("cameraLabel"),
  thresholdInput: document.getElementById("thresholdInput"),
  tessQuestion: document.getElementById("tessQuestion"),
  tessAnswer: document.getElementById("tessAnswer"),
  startCameraBtn: document.getElementById("startCameraBtn"),
  identifyBtn: document.getElementById("identifyBtn"),
  autoScanBtn: document.getElementById("autoScanBtn"),
  enrollBtn: document.getElementById("enrollBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  askTessBtn: document.getElementById("askTessBtn"),
  confidenceChartCanvas: document.getElementById("confidenceChart"),
  matchChartCanvas: document.getElementById("matchChart"),
  timelineChartCanvas: document.getElementById("timelineChart"),
  categoryChartCanvas: document.getElementById("categoryChart"),
};

const state = {
  modelsReady: false,
  cameraReady: false,
  autoScanEnabled: false,
  scanInFlight: false,
  autoScanTimer: null,
  analyticsTimer: null,
  renderRaf: null,
  lastFace: null,
  charts: {
    confidence: null,
    match: null,
    timeline: null,
    category: null,
  },
  confidenceSeries: [],
  signalSeries: [],
};

function setBusy(button, busy) {
  button.disabled = busy;
  button.dataset.originalLabel = button.dataset.originalLabel || button.textContent;
  button.textContent = busy ? "Processando..." : button.dataset.originalLabel;
}

function setLiveLog(text) {
  ui.liveLog.textContent = text;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("pt-BR");
}

function confidenceText(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  return `${Math.round(Number(value) * 100)}%`;
}

function numericOr(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload?.message || "Erro desconhecido";
    throw new Error(message);
  }

  return payload;
}

async function loadModels() {
  if (state.modelsReady) {
    return;
  }

  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);

  state.modelsReady = true;
}

function syncOverlaySize() {
  if (!ui.video.videoWidth || !ui.video.videoHeight) {
    return;
  }

  ui.overlay.width = ui.video.videoWidth;
  ui.overlay.height = ui.video.videoHeight;
}

function renderOverlay() {
  const ctx = ui.overlay.getContext("2d");
  ctx.clearRect(0, 0, ui.overlay.width, ui.overlay.height);

  const w = ui.overlay.width;
  const h = ui.overlay.height;

  ctx.strokeStyle = "rgba(53, 180, 255, 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  if (state.lastFace?.box) {
    const box = state.lastFace.box;
    const riskColor = state.lastFace.riskColor || "#35b4ff";
    ctx.strokeStyle = riskColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    const label = state.lastFace.label || "FACE";
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(box.x, Math.max(0, box.y - 24), 220, 22);
    ctx.fillStyle = riskColor;
    ctx.font = "13px IBM Plex Mono";
    ctx.fillText(label, box.x + 6, Math.max(16, box.y - 9));
  }

  state.renderRaf = requestAnimationFrame(renderOverlay);
}

async function startCamera() {
  await loadModels();

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });

  ui.video.srcObject = stream;
  await ui.video.play();

  syncOverlaySize();
  state.cameraReady = true;
  ui.cameraHint.textContent = "Camera ativa. HUD neural pronto para leitura.";

  if (!state.renderRaf) {
    renderOverlay();
  }
}

async function detectFaceDescriptor() {
  if (!state.cameraReady) {
    throw new Error("Inicie a camera antes da analise facial.");
  }

  const detection = await faceapi
    .detectSingleFace(ui.video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 }))
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    return null;
  }

  return {
    descriptor: Array.from(detection.descriptor),
    score: Number(detection.detection.score || 0),
    box: {
      x: Number(detection.detection.box.x || 0),
      y: Number(detection.detection.box.y || 0),
      width: Number(detection.detection.box.width || 0),
      height: Number(detection.detection.box.height || 0),
    },
  };
}

function ensureCharts() {
  if (state.charts.confidence) {
    return;
  }

  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: "#cbe7ff",
        },
      },
    },
    scales: {
      x: {
        ticks: { color: "#8fb6d7" },
        grid: { color: "rgba(143,182,215,0.15)" },
      },
      y: {
        ticks: { color: "#8fb6d7" },
        grid: { color: "rgba(143,182,215,0.15)" },
      },
    },
  };

  state.charts.confidence = new Chart(ui.confidenceChartCanvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Confianca",
          data: [],
          borderColor: "#35b4ff",
          backgroundColor: "rgba(53, 180, 255, 0.2)",
          tension: 0.32,
        },
        {
          label: "Sinal facial",
          data: [],
          borderColor: "#00ffc6",
          backgroundColor: "rgba(0, 255, 198, 0.18)",
          tension: 0.32,
        },
      ],
    },
    options: {
      ...chartDefaults,
      scales: {
        ...chartDefaults.scales,
        y: {
          ...chartDefaults.scales.y,
          min: 0,
          max: 1,
        },
      },
    },
  });

  state.charts.match = new Chart(ui.matchChartCanvas, {
    type: "doughnut",
    data: {
      labels: ["Match", "Sem Match"],
      datasets: [
        {
          data: [0, 0],
          backgroundColor: ["#5df2a4", "#ff5e7b"],
          borderColor: ["rgba(0,0,0,0)", "rgba(0,0,0,0)"],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#cbe7ff",
          },
        },
      },
    },
  });

  state.charts.timeline = new Chart(ui.timelineChartCanvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Match",
          data: [],
          borderColor: "#5df2a4",
          backgroundColor: "rgba(93, 242, 164, 0.2)",
          tension: 0.25,
        },
        {
          label: "Sem Match",
          data: [],
          borderColor: "#ff5e7b",
          backgroundColor: "rgba(255, 94, 123, 0.2)",
          tension: 0.25,
        },
      ],
    },
    options: chartDefaults,
  });

  state.charts.category = new Chart(ui.categoryChartCanvas, {
    type: "bar",
    data: {
      labels: ["staff", "vip", "blocked", "guest", "unknown"],
      datasets: [
        {
          label: "Deteccoes",
          data: [0, 0, 0, 0, 0],
          backgroundColor: [
            "rgba(53, 180, 255, 0.8)",
            "rgba(140, 132, 255, 0.8)",
            "rgba(255, 94, 123, 0.8)",
            "rgba(93, 242, 164, 0.8)",
            "rgba(255, 209, 102, 0.8)",
          ],
        },
      ],
    },
    options: chartDefaults,
  });
}

function pushConfidenceSnapshot(confidence, signal) {
  const nowLabel = new Date().toLocaleTimeString("pt-BR", {
    minute: "2-digit",
    second: "2-digit",
  });

  state.confidenceSeries.push(confidence);
  state.signalSeries.push(signal);

  if (state.confidenceSeries.length > MAX_CONFIDENCE_POINTS) {
    state.confidenceSeries.shift();
    state.signalSeries.shift();
  }

  const labels = state.confidenceSeries.map((_, index) =>
    index === state.confidenceSeries.length - 1 ? nowLabel : "",
  );

  const chart = state.charts.confidence;
  chart.data.labels = labels;
  chart.data.datasets[0].data = [...state.confidenceSeries];
  chart.data.datasets[1].data = [...state.signalSeries];
  chart.update("none");
}

function setRisk(level, context = "") {
  const presets = {
    LOW: { width: 22, color: "linear-gradient(90deg, #2adf8e, #9dffa4)" },
    MEDIUM: { width: 58, color: "linear-gradient(90deg, #f1b954, #ffd166)" },
    HIGH: { width: 82, color: "linear-gradient(90deg, #ff9b4d, #ff5e7b)" },
    CRITICAL: { width: 100, color: "linear-gradient(90deg, #ff5e7b, #ff2156)" },
  };

  const preset = presets[level] || presets.LOW;
  ui.riskFill.style.width = `${preset.width}%`;
  ui.riskFill.style.background = preset.color;
  ui.riskLabel.textContent = context ? `${level} | ${context}` : level;
}

function updateFaceSignal(score) {
  const percent = Math.round((numericOr(score, 0) || 0) * 100);
  ui.faceSignal.textContent = `Sinal facial: ${percent}%`;
}

function profileRow(profile) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${profile.id}</td>
    <td>${profile.name}</td>
    <td>${profile.category}</td>
    <td>${profile.consent ? "sim" : "nao"}</td>
    <td>${formatDate(profile.createdAt)}</td>
    <td><button data-delete-id="${profile.id}" class="secondary">Excluir</button></td>
  `;
  return tr;
}

function detectionRow(item) {
  const tr = document.createElement("tr");
  const badgeClass = item.matched ? "ok" : "danger";
  const badgeLabel = item.matched ? "match" : "nao";

  tr.innerHTML = `
    <td>${item.id}</td>
    <td>${item.profileName || "-"}</td>
    <td>${item.profileCategory || "-"}</td>
    <td>${item.cameraLabel}</td>
    <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
    <td>${confidenceText(item.confidence)}</td>
    <td>${formatDate(item.createdAt)}</td>
  `;
  return tr;
}

function summarizeResult(result, faceScore) {
  if (!result?.bestMatch) {
    return [
      "Resultado: SEM MATCH",
      "Motivo: Nenhum perfil apto ou sem correspondencia",
      `Sinal facial: ${Math.round((faceScore || 0) * 100)}%`,
    ].join("\n");
  }

  const { matched, bestMatch } = result;
  return [
    `Resultado: ${matched ? "MATCH" : "SEM MATCH"}`,
    `Perfil: ${bestMatch.name} (${bestMatch.category})`,
    `Distancia: ${bestMatch.distance}`,
    `Confianca: ${confidenceText(bestMatch.confidence)}`,
    `Sinal facial: ${Math.round((faceScore || 0) * 100)}%`,
  ].join("\n");
}

function applyRiskFromResult(result) {
  if (!result?.matched) {
    setRisk("MEDIUM", "sem match");
    state.lastFace = {
      ...(state.lastFace || {}),
      label: "UNKNOWN",
      riskColor: "#ffd166",
    };
    return;
  }

  const category = result.bestMatch?.category || "guest";
  if (category === "blocked") {
    setRisk("CRITICAL", "perfil bloqueado");
    state.lastFace = {
      ...(state.lastFace || {}),
      label: `${result.bestMatch.name} | BLOCKED`,
      riskColor: "#ff5e7b",
    };
    return;
  }

  if (category === "vip") {
    setRisk("LOW", "vip identificado");
  } else if (category === "staff") {
    setRisk("LOW", "staff identificado");
  } else {
    setRisk("MEDIUM", `categoria ${category}`);
  }

  state.lastFace = {
    ...(state.lastFace || {}),
    label: `${result.bestMatch.name} | ${category}`,
    riskColor: "#5df2a4",
  };
}

async function refreshStatus() {
  try {
    const status = await api("/api/status");
    ui.apiStatus.textContent = `${status.appName} | DB ${status.database} | ${new Date(status.now).toLocaleTimeString("pt-BR")}`;
  } catch (error) {
    ui.apiStatus.textContent = `Falha status: ${error.message}`;
  }
}

async function refreshProfiles() {
  const { profiles } = await api("/api/profiles");
  ui.profilesTable.innerHTML = "";

  profiles.forEach((profile) => {
    ui.profilesTable.appendChild(profileRow(profile));
  });

  if (profiles.length === 0) {
    ui.profilesTable.innerHTML = '<tr><td colspan="6">Nenhum perfil cadastrado.</td></tr>';
  }
}

async function refreshDetections() {
  const { detections } = await api("/api/detections?limit=40");
  ui.detectionsTable.innerHTML = "";

  detections.forEach((item) => {
    ui.detectionsTable.appendChild(detectionRow(item));
  });

  if (detections.length === 0) {
    ui.detectionsTable.innerHTML = '<tr><td colspan="7">Sem deteccoes ainda.</td></tr>';
    return;
  }

  const top = detections[0];
  setLiveLog(
    `[${formatDate(top.createdAt)}] ${top.matched ? "MATCH" : "SEM MATCH"} | ${top.profileName || "desconhecido"} | ${top.cameraLabel}`,
  );
}

async function refreshAnalytics() {
  try {
    const [summary, timeline] = await Promise.all([
      api("/api/analytics/summary"),
      api("/api/analytics/timeline?minutes=90&bucket=3"),
    ]);

    ui.matchCounter.textContent = String(summary.stats1h?.matched || 0);
    ui.unmatchedCounter.textContent = String(summary.stats1h?.unmatched || 0);
    ui.blockedCounter.textContent = String(summary.stats24h?.blockedHits || 0);
    ui.totalCounter.textContent = String(summary.stats24h?.total || 0);

    state.charts.match.data.datasets[0].data = [
      Number(summary.stats1h?.matched || 0),
      Number(summary.stats1h?.unmatched || 0),
    ];
    state.charts.match.update("none");

    const categories = summary.categoryBreakdown?.categories || {};
    state.charts.category.data.datasets[0].data = [
      Number(categories.staff || 0),
      Number(categories.vip || 0),
      Number(categories.blocked || 0),
      Number(categories.guest || 0),
      Number(categories.unknown || 0),
    ];
    state.charts.category.update("none");

    state.charts.timeline.data.labels = timeline.points.map((p) => p.label);
    state.charts.timeline.data.datasets[0].data = timeline.points.map((p) => p.matched);
    state.charts.timeline.data.datasets[1].data = timeline.points.map((p) => p.unmatched);
    state.charts.timeline.update("none");
  } catch (error) {
    setLiveLog(`Falha analytics: ${error.message}`);
  }
}

async function enrollProfile() {
  const name = ui.profileName.value.trim();
  if (!name) {
    throw new Error("Informe nome antes de cadastrar.");
  }

  const face = await detectFaceDescriptor();
  if (!face) {
    throw new Error("Nenhum rosto detectado para cadastro.");
  }

  await api("/api/profiles", {
    method: "POST",
    body: JSON.stringify({
      name,
      category: ui.profileCategory.value,
      notes: ui.profileNotes.value.trim(),
      consent: true,
      embedding: face.descriptor,
    }),
  });

  state.lastFace = {
    box: face.box,
    label: `ENROLLED | ${name}`,
    riskColor: "#00ffc6",
  };

  ui.profileName.value = "";
  ui.profileNotes.value = "";
}

async function runIdentify(mode = "manual") {
  if (state.scanInFlight) {
    return;
  }

  state.scanInFlight = true;

  try {
    const face = await detectFaceDescriptor();

    if (!face) {
      updateFaceSignal(0);
      pushConfidenceSnapshot(0, 0);
      ui.identifyResult.textContent = "Sem rosto detectado no frame atual.";
      setRisk("LOW", "aguardando face");
      return;
    }

    updateFaceSignal(face.score);
    state.lastFace = {
      box: face.box,
      label: "ANALISANDO...",
      riskColor: "#35b4ff",
    };

    const threshold = numericOr(ui.thresholdInput.value, 0.5) || 0.5;
    const result = await api("/api/recognition/identify", {
      method: "POST",
      body: JSON.stringify({
        embedding: face.descriptor,
        cameraLabel: ui.cameraLabel.value.trim() || "entrada-principal",
        threshold,
        metadata: {
          source: mode,
          detectorScore: Number(face.score.toFixed(4)),
          box: {
            x: Number(face.box.x.toFixed(1)),
            y: Number(face.box.y.toFixed(1)),
            width: Number(face.box.width.toFixed(1)),
            height: Number(face.box.height.toFixed(1)),
          },
        },
      }),
    });

    const confidence = Number(result?.bestMatch?.confidence || 0);
    pushConfidenceSnapshot(confidence, face.score);
    ui.identifyResult.textContent = summarizeResult(result, face.score);
    applyRiskFromResult(result);

    if (result?.bestMatch?.category === "blocked" && result.matched) {
      setLiveLog(`ALERTA CRITICO: perfil bloqueado identificado (${result.bestMatch.name}).`);
    } else {
      setLiveLog(`${mode.toUpperCase()} | ${result.matched ? "MATCH" : "SEM MATCH"} | ${result.bestMatch?.name || "desconhecido"}`);
    }

    await Promise.all([refreshDetections(), refreshAnalytics()]);
  } catch (error) {
    ui.identifyResult.textContent = `Falha na leitura: ${error.message}`;
    setLiveLog(`Erro de leitura: ${error.message}`);
  } finally {
    state.scanInFlight = false;
  }
}

function startAutoScan() {
  if (state.autoScanEnabled) {
    return;
  }

  state.autoScanEnabled = true;
  ui.watchMode.textContent = "Modo: auto-scan";
  ui.autoScanBtn.textContent = "Parar Auto-Scan";
  ui.autoScanBtn.classList.remove("secondary");

  state.autoScanTimer = setInterval(() => {
    runIdentify("auto").catch(() => {});
  }, AUTO_SCAN_INTERVAL_MS);
}

function stopAutoScan() {
  state.autoScanEnabled = false;
  ui.watchMode.textContent = "Modo: manual";
  ui.autoScanBtn.textContent = "Ativar Auto-Scan";
  ui.autoScanBtn.classList.add("secondary");

  if (state.autoScanTimer) {
    clearInterval(state.autoScanTimer);
    state.autoScanTimer = null;
  }
}

async function askTess() {
  const question = ui.tessQuestion.value.trim();
  if (!question) {
    throw new Error("Digite uma pergunta para TESS.");
  }

  const result = await api("/api/tess/analyze", {
    method: "POST",
    body: JSON.stringify({ question }),
  });

  const modeText = result.mode === "openai" ? "TESS (OpenAI)" : "TESS (fallback local)";
  ui.tessAnswer.textContent = `${modeText}\n\n${result.answer}`;
}

async function deleteProfileById(profileId) {
  await api(`/api/profiles/${profileId}`, { method: "DELETE" });
}

function bindEvents() {
  ui.startCameraBtn.addEventListener("click", async () => {
    setBusy(ui.startCameraBtn, true);
    try {
      await startCamera();
    } catch (error) {
      alert(error.message);
    } finally {
      setBusy(ui.startCameraBtn, false);
    }
  });

  ui.identifyBtn.addEventListener("click", async () => {
    setBusy(ui.identifyBtn, true);
    try {
      await runIdentify("manual");
    } finally {
      setBusy(ui.identifyBtn, false);
    }
  });

  ui.autoScanBtn.addEventListener("click", async () => {
    if (!state.cameraReady) {
      alert("Inicie a camera antes do auto-scan.");
      return;
    }

    if (state.autoScanEnabled) {
      stopAutoScan();
      return;
    }

    startAutoScan();
    await runIdentify("auto");
  });

  ui.enrollBtn.addEventListener("click", async () => {
    setBusy(ui.enrollBtn, true);
    try {
      await enrollProfile();
      await Promise.all([refreshProfiles(), refreshDetections(), refreshAnalytics()]);
      setLiveLog("Perfil cadastrado com sucesso.");
    } catch (error) {
      alert(error.message);
    } finally {
      setBusy(ui.enrollBtn, false);
    }
  });

  ui.refreshBtn.addEventListener("click", async () => {
    setBusy(ui.refreshBtn, true);
    try {
      await Promise.all([refreshStatus(), refreshProfiles(), refreshDetections(), refreshAnalytics()]);
    } catch (error) {
      alert(error.message);
    } finally {
      setBusy(ui.refreshBtn, false);
    }
  });

  ui.askTessBtn.addEventListener("click", async () => {
    setBusy(ui.askTessBtn, true);
    try {
      await askTess();
    } catch (error) {
      alert(error.message);
    } finally {
      setBusy(ui.askTessBtn, false);
    }
  });

  ui.profilesTable.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-delete-id]");
    if (!button) {
      return;
    }

    const profileId = Number(button.dataset.deleteId);
    if (!Number.isInteger(profileId)) {
      return;
    }

    if (!window.confirm("Excluir este perfil?")) {
      return;
    }

    try {
      await deleteProfileById(profileId);
      await Promise.all([refreshProfiles(), refreshDetections(), refreshAnalytics()]);
    } catch (error) {
      alert(error.message);
    }
  });

  window.addEventListener("resize", syncOverlaySize);
}

function startBackgroundRefresh() {
  if (state.analyticsTimer) {
    clearInterval(state.analyticsTimer);
  }

  state.analyticsTimer = setInterval(() => {
    Promise.all([refreshStatus(), refreshAnalytics(), refreshDetections()]).catch(() => {});
  }, ANALYTICS_REFRESH_MS);
}

async function bootstrap() {
  ensureCharts();
  bindEvents();
  setRisk("LOW", "standby");
  await Promise.all([refreshStatus(), refreshProfiles(), refreshDetections(), refreshAnalytics()]);
  startBackgroundRefresh();
}

bootstrap().catch((error) => {
  ui.apiStatus.textContent = `Falha ao iniciar painel: ${error.message}`;
});
