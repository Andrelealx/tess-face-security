const OpenAI = require("openai");
const { getDetectionStats, listDetections } = require("./profiles");

let cachedClient = null;

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey });
  }

  return cachedClient;
}

function buildLocalFallback(question, stats) {
  return [
    "TESS (modo local): nao consegui usar a API da OpenAI neste momento.",
    `Janela analisada: ${stats.windowHours}h`,
    `Deteccoes totais: ${stats.total}`,
    `Reconhecimentos positivos: ${stats.matched}`,
    `Nao reconhecidos: ${stats.unmatched}`,
    `Alertas de perfil bloqueado: ${stats.blockedHits}`,
    "Recomendacoes imediatas:",
    "1) Revise os perfis bloqueados e regra de threshold.",
    "2) Mantenha operador humano para validacao final.",
    "3) Garanta consentimento e politica LGPD no evento.",
    "Pergunta recebida:",
    question,
  ].join("\n");
}

function serializeDetectionSnippet(detections) {
  return detections.slice(0, 8).map((item) => ({
    id: item.id,
    profileName: item.profileName,
    category: item.profileCategory,
    cameraLabel: item.cameraLabel,
    matched: item.matched,
    confidence: item.confidence,
    createdAt: item.createdAt,
  }));
}

async function tessAnalyze(question) {
  const safeQuestion = String(question || "").trim();
  if (!safeQuestion) {
    throw new Error("A pergunta para TESS e obrigatoria.");
  }

  const stats = await getDetectionStats(24);
  const detections = await listDetections(20);
  const client = getOpenAiClient();

  if (!client) {
    return {
      mode: "fallback",
      answer: buildLocalFallback(safeQuestion, stats),
    };
  }

  const systemPrompt = [
    "Voce e TESS, analista de seguranca para eventos com monitoramento facial assistido.",
    "Objetivo: orientar a equipe de operacao com linguagem objetiva, sem tomar decisoes finais automaticas.",
    "Regras:",
    "- Sempre incluir riscos, acao imediata e acao preventiva.",
    "- Nunca recomendar abordagem violenta.",
    "- Sempre lembrar que reconhecimento facial pode gerar falso positivo.",
    "- Responda em portugues do Brasil.",
  ].join("\n");

  const contextPayload = {
    stats24h: stats,
    recentDetections: serializeDetectionSnippet(detections),
  };

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    temperature: 0.2,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Contexto operacional (JSON): ${JSON.stringify(contextPayload)}`,
          },
          {
            type: "input_text",
            text: `Pergunta do operador: ${safeQuestion}`,
          },
        ],
      },
    ],
  });

  const answer = response.output_text || "TESS nao conseguiu gerar resposta textual.";

  return {
    mode: "openai",
    answer,
  };
}

module.exports = {
  tessAnalyze,
};
