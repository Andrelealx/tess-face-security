const {
  normalizeEmbedding,
  listProfiles,
  registerDetection,
} = require("./profiles");

function euclideanDistance(a, b) {
  if (a.length !== b.length) {
    return Number.POSITIVE_INFINITY;
  }

  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const delta = a[i] - b[i];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

function calculateConfidence(distance, threshold) {
  if (!Number.isFinite(distance)) {
    return 0;
  }
  const score = 1 - distance / (threshold * 2);
  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  try {
    const serialized = JSON.stringify(metadata);
    if (serialized.length <= 4000) {
      return JSON.parse(serialized);
    }
    return { warning: "metadata_truncated" };
  } catch (_error) {
    return {};
  }
}

async function identifyFace({ embedding, cameraLabel, threshold, metadata }) {
  const probe = normalizeEmbedding(embedding);
  const recognitionThreshold = Number(threshold || process.env.RECOGNITION_THRESHOLD || 0.5);
  const safeMetadata = sanitizeMetadata(metadata);
  const profiles = await listProfiles();

  const candidates = profiles.filter((profile) => profile.consent);
  if (candidates.length === 0) {
    await registerDetection({
      profileId: null,
      cameraLabel,
      distance: null,
      confidence: 0,
      matched: false,
      metadata: {
        reason: "no_profiles",
        threshold: recognitionThreshold,
        probeLength: probe.length,
        ...safeMetadata,
      },
    });

    return {
      matched: false,
      reason: "Nenhum perfil cadastrado com consentimento.",
      bestMatch: null,
      threshold: recognitionThreshold,
    };
  }

  let best = null;
  for (const profile of candidates) {
    const distance = euclideanDistance(probe, profile.embedding);

    if (!best || distance < best.distance) {
      best = { profile, distance };
    }
  }

  const matched = Number.isFinite(best.distance) && best.distance <= recognitionThreshold;
  const confidence = calculateConfidence(best.distance, recognitionThreshold);

  await registerDetection({
    profileId: matched ? best.profile.id : null,
    cameraLabel,
    distance: Number.isFinite(best.distance) ? Number(best.distance.toFixed(6)) : null,
    confidence,
    matched,
    metadata: {
      threshold: recognitionThreshold,
      probeLength: probe.length,
      candidateCount: candidates.length,
      ...safeMetadata,
    },
  });

  return {
    matched,
    threshold: recognitionThreshold,
    bestMatch: {
      profileId: best.profile.id,
      name: best.profile.name,
      category: best.profile.category,
      distance: Number.isFinite(best.distance) ? Number(best.distance.toFixed(6)) : null,
      confidence,
    },
  };
}

module.exports = {
  identifyFace,
};
