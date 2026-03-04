const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";

const ui = {
  video: document.getElementById("video"),
  apiStatus: document.getElementById("apiStatus"),
  cameraHint: document.getElementById("cameraHint"),
  identifyResult: document.getElementById("identifyResult"),
  profilesTable: document.getElementById("profilesTable"),
  detectionsTable: document.getElementById("detectionsTable"),
  profileName: document.getElementById("profileName"),
  profileCategory: document.getElementById("profileCategory"),
  profileNotes: document.getElementById("profileNotes"),
  cameraLabel: document.getElementById("cameraLabel"),
  tessQuestion: document.getElementById("tessQuestion"),
  tessAnswer: document.getElementById("tessAnswer"),
  startCameraBtn: document.getElementById("startCameraBtn"),
  identifyBtn: document.getElementById("identifyBtn"),
  enrollBtn: document.getElementById("enrollBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  askTessBtn: document.getElementById("askTessBtn"),
};

let modelsReady = false;
let cameraReady = false;

function setBusy(button, busy) {
  button.disabled = busy;
  button.dataset.originalLabel = button.dataset.originalLabel || button.textContent;
  button.textContent = busy ? "Processando..." : button.dataset.originalLabel;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof data === "string" ? data : data?.message || "Erro desconhecido";
    throw new Error(message);
  }

  return data;
}

async function loadModels() {
  if (modelsReady) {
    return;
  }

  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);

  modelsReady = true;
}

async function startCamera() {
  if (!modelsReady) {
    await loadModels();
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } },
    audio: false,
  });

  ui.video.srcObject = stream;
  await ui.video.play();
  cameraReady = true;
  ui.cameraHint.textContent = "Camera pronta. Cadastre ou identifique rostos.";
}

async function captureEmbedding() {
  if (!cameraReady) {
    throw new Error("Inicie a camera antes de capturar rosto.");
  }

  const detection = await faceapi
    .detectSingleFace(ui.video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 }))
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    throw new Error("Nenhum rosto detectado. Ajuste iluminacao e enquadramento.");
  }

  return Array.from(detection.descriptor);
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

function showIdentifyResult(result) {
  if (!result?.bestMatch) {
    ui.identifyResult.textContent = result?.reason || "Sem correspondencia.";
    return;
  }

  const { matched, bestMatch } = result;
  const summary = [
    `Resultado: ${matched ? "MATCH" : "SEM MATCH"}`,
    `Perfil mais proximo: ${bestMatch.name} (${bestMatch.category})`,
    `Distancia: ${bestMatch.distance}`,
    `Confianca: ${confidenceText(bestMatch.confidence)}`,
  ].join("\n");

  ui.identifyResult.textContent = summary;
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

async function refreshStatus() {
  try {
    const status = await api("/api/status");
    ui.apiStatus.textContent = `${status.appName} | DB: ${status.database} | ${new Date(status.now).toLocaleTimeString("pt-BR")}`;
  } catch (error) {
    ui.apiStatus.textContent = `Falha ao ler status: ${error.message}`;
  }
}

async function refreshProfiles() {
  const { profiles } = await api("/api/profiles");
  ui.profilesTable.innerHTML = "";

  profiles.forEach((profile) => {
    ui.profilesTable.appendChild(profileRow(profile));
  });

  if (profiles.length === 0) {
    ui.profilesTable.innerHTML = `<tr><td colspan="6">Nenhum perfil cadastrado.</td></tr>`;
  }
}

async function refreshDetections() {
  const { detections } = await api("/api/detections?limit=30");
  ui.detectionsTable.innerHTML = "";

  detections.forEach((detection) => {
    ui.detectionsTable.appendChild(detectionRow(detection));
  });

  if (detections.length === 0) {
    ui.detectionsTable.innerHTML = `<tr><td colspan="7">Sem deteccoes ainda.</td></tr>`;
  }
}

async function enrollProfile() {
  const name = ui.profileName.value.trim();
  if (!name) {
    throw new Error("Informe o nome do perfil antes de cadastrar.");
  }

  const embedding = await captureEmbedding();

  await api("/api/profiles", {
    method: "POST",
    body: JSON.stringify({
      name,
      category: ui.profileCategory.value,
      notes: ui.profileNotes.value.trim(),
      consent: true,
      embedding,
    }),
  });

  ui.profileName.value = "";
  ui.profileNotes.value = "";
}

async function identifyNow() {
  const embedding = await captureEmbedding();
  const result = await api("/api/recognition/identify", {
    method: "POST",
    body: JSON.stringify({
      embedding,
      cameraLabel: ui.cameraLabel.value.trim() || "entrada-principal",
    }),
  });

  showIdentifyResult(result);
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

  ui.enrollBtn.addEventListener("click", async () => {
    setBusy(ui.enrollBtn, true);
    try {
      await enrollProfile();
      await Promise.all([refreshProfiles(), refreshDetections()]);
      ui.identifyResult.textContent = "Perfil cadastrado com sucesso.";
    } catch (error) {
      alert(error.message);
    } finally {
      setBusy(ui.enrollBtn, false);
    }
  });

  ui.identifyBtn.addEventListener("click", async () => {
    setBusy(ui.identifyBtn, true);
    try {
      await identifyNow();
      await refreshDetections();
    } catch (error) {
      alert(error.message);
    } finally {
      setBusy(ui.identifyBtn, false);
    }
  });

  ui.refreshBtn.addEventListener("click", async () => {
    setBusy(ui.refreshBtn, true);
    try {
      await Promise.all([refreshProfiles(), refreshDetections(), refreshStatus()]);
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

    const confirmed = window.confirm("Excluir este perfil?");
    if (!confirmed) {
      return;
    }

    try {
      await deleteProfileById(profileId);
      await Promise.all([refreshProfiles(), refreshDetections()]);
    } catch (error) {
      alert(error.message);
    }
  });
}

async function bootstrap() {
  bindEvents();
  await Promise.all([refreshStatus(), refreshProfiles(), refreshDetections()]);
}

bootstrap().catch((error) => {
  ui.apiStatus.textContent = `Falha ao iniciar UI: ${error.message}`;
});
