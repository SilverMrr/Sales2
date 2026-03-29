(() => {
// ============================================================
// Sales360 — AI Engine (OpenAI split APIs only)
// Transcription : gpt-4o-mini-transcribe
// Analyse / résumé : gpt-4o-mini
// ============================================================
if (window.S360AI && window.S360AI.__engineId === "s360-split-v2") {
  return;
}

// ── Storage keys ──────────────────────────────────────────────
const S360_AUDIO_API_KEY = "s360_audio_api_key";
const S360_TEXT_API_KEY  = "s360_text_api_key";

const STORAGE_CALLS      = "s360_calls";
const STORAGE_CONTACTS   = "s360_contacts";
const STORAGE_NEXT_STEPS = "s360_next_steps";

// Fixed models
const MODEL_TRANSCRIBE = "gpt-4o-mini-transcribe";
const MODEL_ANALYSIS   = "gpt-4o-mini";

// ── CRM prompt ────────────────────────────────────────────────
const CRM_PROMPT = `
Tu es un assistant CRM expert en vente B2B. On te fournit la transcription brute d'un appel commercial.

Analyse-la et retourne UNIQUEMENT un objet JSON valide avec cette structure exacte :
{
  "prospect": {
    "name": "Prénom Nom du prospect",
    "company": "Nom de l'entreprise",
    "email": "email si mentionné, sinon ''",
    "phone": "téléphone si mentionné, sinon ''",
    "status": "Prospect" | "Intéressé" | "Chaud" | "Client",
    "estimatedValue": nombre entier en euros (0 si non mentionné),
    "notes": "2-3 phrases résumant le profil et contexte du prospect"
  },
  "callSummary": {
    "duration": "durée estimée si mentionnée sinon 'N/A'",
    "sentiment": "positif" | "neutre" | "négatif",
    "keyPoints": ["point 1", "point 2", "point 3"],
    "objections": ["objection 1"],
    "outcome": "résultat de l'appel en 1 phrase"
  },
  "nextSteps": [
    {
      "title": "Titre court de l'action",
      "description": "Description précise de ce qu'il faut faire",
      "type": "urgent" | "follow-up" | "opportunity" | "risk",
      "dueDate": "YYYY-MM-DD",
      "priority": "high" | "medium" | "low",
      "estimatedValue": nombre entier en euros
    }
  ],
  "pipelineStage": "Prospection" | "Qualification" | "Proposition" | "Négociation" | "Conclue"
}

Règles :
- nextSteps doit contenir entre 2 et 5 actions concrètes et actionnables.
- Les dates dueDate sont relatives à aujourd'hui (${new Date().toISOString().slice(0,10)}).
- Si une information est manquante, déduis-la du contexte ou laisse la valeur vide/0.
- Réponds UNIQUEMENT avec le JSON, sans texte autour.
`;

// ── Storage helpers ───────────────────────────────────────────
function loadData(key, fallback = []) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
}
function saveData(key, data) { localStorage.setItem(key, JSON.stringify(data)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ── Config ────────────────────────────────────────────────────
function getAiConfig() {
  return {
    mode:          "split_apis",
    audioProvider: "openai",
    audioApiKey:   localStorage.getItem(S360_AUDIO_API_KEY) || "",
    textProvider:  "openai",
    textApiKey:    localStorage.getItem(S360_TEXT_API_KEY)  || "",
    textModel:     MODEL_ANALYSIS,
    audioModel:    MODEL_TRANSCRIBE
  };
}

function saveAiConfig(config = {}) {
  if (config.audioApiKey !== undefined) localStorage.setItem(S360_AUDIO_API_KEY, config.audioApiKey || "");
  if (config.textApiKey  !== undefined) localStorage.setItem(S360_TEXT_API_KEY,  config.textApiKey  || "");
  return getAiConfig();
}

function getMissingRequirements() {
  const cfg = getAiConfig();
  const missing = [];
  if (!cfg.audioApiKey) missing.push("Clé API transcription (OpenAI) manquante");
  if (!cfg.textApiKey)  missing.push("Clé API analyse CRM (OpenAI) manquante");
  return missing;
}

function hasRequiredKeys() { return getMissingRequirements().length === 0; }

function getActiveAiSummary() {
  return `APIs séparées : ${MODEL_TRANSCRIBE} (transcription) + ${MODEL_ANALYSIS} (analyse)`;
}

// ── JSON utils ────────────────────────────────────────────────
function normalizeJsonText(raw) {
  const txt = String(raw || "").trim()
    .replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
  const first = txt.indexOf("{");
  const last  = txt.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return "";
  return txt.slice(first, last + 1);
}

function parseJsonWithFallback(raw, fallback) {
  try { return JSON.parse(normalizeJsonText(raw) || "null") || fallback; }
  catch { return fallback; }
}

function sanitizeArray(arr) {
  return Array.isArray(arr) ? arr.map(v => String(v || "").trim()).filter(Boolean) : [];
}

function normalizeCrmAnalysis(parsed) {
  const fallback = {
    prospect: { name: "", company: "", email: "", phone: "", status: "Prospect", estimatedValue: 0, notes: "" },
    callSummary: { duration: "N/A", sentiment: "neutre", keyPoints: [], objections: [], outcome: "" },
    nextSteps: [],
    pipelineStage: "Prospection"
  };
  if (!parsed || typeof parsed !== "object") return fallback;
  return {
    prospect: {
      ...fallback.prospect,
      ...(parsed.prospect || {}),
      estimatedValue: Number(parsed?.prospect?.estimatedValue) || 0
    },
    callSummary: {
      ...fallback.callSummary,
      ...(parsed.callSummary || {}),
      keyPoints: sanitizeArray(parsed?.callSummary?.keyPoints),
      objections: sanitizeArray(parsed?.callSummary?.objections)
    },
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map(step => ({
      title: String(step?.title || "Action à préciser"),
      description: String(step?.description || ""),
      type: ["urgent", "follow-up", "opportunity", "risk"].includes(step?.type) ? step.type : "follow-up",
      dueDate: String(step?.dueDate || new Date().toISOString().slice(0, 10)),
      priority: ["high", "medium", "low"].includes(step?.priority) ? step.priority : "medium",
      estimatedValue: Number(step?.estimatedValue) || 0
    })) : [],
    pipelineStage: String(parsed.pipelineStage || fallback.pipelineStage)
  };
}

// ── Network helper ────────────────────────────────────────────
async function fetchJson(url, options, fallbackMessage = "Erreur réseau") {
  let res;
  try { res = await fetch(url, options); }
  catch { throw new Error(fallbackMessage); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || body?.error || `${fallbackMessage} (${res.status})`);
  return body;
}

// ── OpenAI transcription (gpt-4o-mini-transcribe) ─────────────
async function transcribeWithOpenAI(apiKey, audioBlob) {
  const form = new FormData();
  form.append("file", new File([audioBlob], "call.webm", { type: audioBlob.type || "audio/webm" }));
  form.append("model", MODEL_TRANSCRIBE);
  form.append("response_format", "json");
  const body = await fetchJson("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  }, "Transcription OpenAI indisponible");
  return { transcript: String(body?.text || "").trim(), summary: "", needs: [], objections: [], next_steps: [] };
}

// ── OpenAI analysis (gpt-4o-mini) ────────────────────────────
async function analyzeWithOpenAIText(apiKey, transcript) {
  const body = await fetchJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL_ANALYSIS,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CRM_PROMPT },
        { role: "user",   content: transcript  }
      ]
    })
  }, "Analyse CRM OpenAI indisponible");
  return body?.choices?.[0]?.message?.content || "{}";
}

// ── Core pipeline ─────────────────────────────────────────────
async function analyzeTranscriptRaw(transcriptText, callerId = "") {
  const cfg = getAiConfig();
  const userPrompt = callerId ? `Interlocuteur connu : ${callerId}\n\n---\n${transcriptText}` : transcriptText;
  const raw = await analyzeWithOpenAIText(cfg.textApiKey, userPrompt);
  return normalizeCrmAnalysis(parseJsonWithFallback(raw, null));
}

async function transcribeAudioRaw(audioBlob) {
  const cfg = getAiConfig();
  return transcribeWithOpenAI(cfg.audioApiKey, audioBlob);
}

// ── Persist ───────────────────────────────────────────────────
function persistAnalysis(transcriptText, analysis, callerId = "", extra = {}) {
  const callRecord = {
    id: uid(),
    date: new Date().toISOString(),
    transcript: transcriptText,
    analysis,
    callerId,
    source: extra.source || "manual-transcript",
    audioInsights: extra.audioInsights || null
  };
  const calls = loadData(STORAGE_CALLS);
  calls.unshift(callRecord);
  saveData(STORAGE_CALLS, calls);

  const contactId = upsertContact(analysis.prospect, callRecord.id);

  const steps = (analysis.nextSteps || []).map(s => ({
    ...s,
    id: uid(),
    callId: callRecord.id,
    contactId,
    contactName: analysis.prospect?.name || "Inconnu",
    done: false,
    createdAt: new Date().toISOString()
  }));
  const allSteps = loadData(STORAGE_NEXT_STEPS);
  allSteps.unshift(...steps);
  saveData(STORAGE_NEXT_STEPS, allSteps);

  return { callId: callRecord.id, contactId, analysis, nextSteps: steps };
}

// ── Public API ────────────────────────────────────────────────
async function analyzeTranscript(transcriptText, callerId = "") {
  if (!transcriptText || transcriptText.trim().length < 20) throw new Error("Le transcript est trop court.");
  const missing = getMissingRequirements();
  if (missing.length) throw new Error(missing.join(" · "));
  const analysis = await analyzeTranscriptRaw(transcriptText, callerId);
  return persistAnalysis(transcriptText, analysis, callerId);
}

async function analyzeCallAudio(audioBlob, callerId = "") {
  if (!audioBlob || !audioBlob.size) throw new Error("Aucun audio valide à analyser.");
  const missing = getMissingRequirements();
  if (missing.length) throw new Error(missing.join(" · "));
  const audioAnalysis = await transcribeAudioRaw(audioBlob);
  if (!audioAnalysis.transcript) throw new Error("Transcription audio vide.");
  const analysis = await analyzeTranscriptRaw(audioAnalysis.transcript, callerId);
  const persisted = persistAnalysis(audioAnalysis.transcript, analysis, callerId, {
    source: "audio-recording",
    audioInsights: audioAnalysis
  });
  return { ...persisted, transcript: audioAnalysis.transcript, audioAnalysis };
}

function upsertContact(prospectData, callId) {
  if (!prospectData?.name) return null;
  const contacts = loadData(STORAGE_CONTACTS);
  const nameNorm = prospectData.name.toLowerCase().trim();
  const idx = contacts.findIndex(c =>
    c.name.toLowerCase().trim() === nameNorm ||
    (prospectData.email && c.email === prospectData.email)
  );
  const now = new Date().toISOString();
  if (idx >= 0) {
    contacts[idx] = { ...contacts[idx], ...prospectData, lastCallId: callId, lastCallDate: now, callCount: (contacts[idx].callCount || 0) + 1 };
    saveData(STORAGE_CONTACTS, contacts);
    return contacts[idx].id;
  }
  const newContact = { id: uid(), ...prospectData, callCount: 1, lastCallId: callId, lastCallDate: now, createdAt: now, source: "Appel analysé" };
  contacts.unshift(newContact);
  saveData(STORAGE_CONTACTS, contacts);
  return newContact.id;
}

function markStepDone(stepId) {
  const steps = loadData(STORAGE_NEXT_STEPS);
  const idx = steps.findIndex(s => s.id === stepId);
  if (idx >= 0) {
    steps[idx].done   = true;
    steps[idx].doneAt = new Date().toISOString();
    saveData(STORAGE_NEXT_STEPS, steps);
    return true;
  }
  return false;
}

function deleteStep(stepId) {
  saveData(STORAGE_NEXT_STEPS, loadData(STORAGE_NEXT_STEPS).filter(s => s.id !== stepId));
}

function deleteContact(contactId) {
  saveData(STORAGE_CONTACTS, loadData(STORAGE_CONTACTS).filter(c => c.id !== contactId));
}

function getStats() {
  const calls    = loadData(STORAGE_CALLS);
  const contacts = loadData(STORAGE_CONTACTS);
  const steps    = loadData(STORAGE_NEXT_STEPS);
  const pending  = steps.filter(s => !s.done);
  return {
    totalCalls:    calls.length,
    totalContacts: contacts.length,
    pendingSteps:  pending.length,
    urgentSteps:   pending.filter(s => s.type === "urgent").length,
    followUpSteps: pending.filter(s => s.type === "follow-up").length,
    opportunities: pending.filter(s => s.type === "opportunity").length
  };
}

// ── Key test helpers ──────────────────────────────────────────
async function testAudioProviderKey(provider, key) {
  if (!key) throw new Error("Clé audio manquante");
  await fetchJson("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } }, "Clé OpenAI transcription invalide");
  return true;
}

async function testTextProviderKey(provider, key) {
  if (!key) throw new Error("Clé texte manquante");
  await fetchJson("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } }, "Clé OpenAI analyse invalide");
  return true;
}

// ── Expose ────────────────────────────────────────────────────
window.S360AI = {
  __engineId: "s360-split-v2",
  provider: "openai-split",
  version: "2026-03-29",
  MODEL_TRANSCRIBE, MODEL_ANALYSIS,
  STORAGE_CALLS, STORAGE_CONTACTS, STORAGE_NEXT_STEPS,
  loadData, saveData,
  getAiConfig, saveAiConfig,
  getMissingRequirements, hasRequiredKeys, getActiveAiSummary,
  testAudioProviderKey, testTextProviderKey,
  analyzeTranscript, analyzeCallAudio,
  upsertContact, markStepDone, deleteStep, deleteContact, getStats
};
})();
