const DEFAULT_ALLOWED_ORIGINS = [
  "https://payen08.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
];

type LookupBody = {
  action?: "lookup";
  word?: string;
};

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const lookupCache = new Map<string, CacheEntry>();
const requestBuckets = new Map<string, number[]>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 30;
const MAIMEMO_BASE_URL = "https://open.maimemo.com/open/api/v1/memo";

function allowedOrigins() {
  const configured = (Deno.env.get("MAIMEMO_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function isAllowedOrigin(origin: string) {
  if (!origin) return true;
  if (allowedOrigins().includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) && origin ? origin : DEFAULT_ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

function clientKey(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("cf-connecting-ip")
    || "unknown";
}

function isRateLimited(req: Request) {
  const key = clientKey(req);
  const now = Date.now();
  const recent = (requestBuckets.get(key) || []).filter((time) => now - time < RATE_WINDOW_MS);
  recent.push(now);
  requestBuckets.set(key, recent);
  return recent.length > RATE_LIMIT;
}

function cleanWord(value: unknown) {
  const word = String(value || "").trim().toLowerCase();
  if (!/^[a-z][a-z' -]{0,62}[a-z]$|^[a-z]$/i.test(word)) return "";
  return word.replace(/\s+/g, " ");
}

function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of lookupCache) {
    if (entry.expiresAt <= now) lookupCache.delete(key);
  }
  while (lookupCache.size > MAX_CACHE_ENTRIES) {
    const oldest = lookupCache.keys().next().value;
    if (!oldest) break;
    lookupCache.delete(oldest);
  }
}

async function maimemoRequest(path: string, token: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  let response: Response;
  try {
    response = await fetch(`${MAIMEMO_BASE_URL}${path}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail = data?.message || data?.error?.message || data?.error || `HTTP ${response.status}`;
    throw new Error(`HTTP ${response.status}: ${String(detail).slice(0, 260)}`);
  }
  if (data?.success === false || (Array.isArray(data?.errors) && data.errors.length)) {
    const firstError = Array.isArray(data?.errors) ? data.errors[0] : data?.errors;
    const detail = firstError?.message || firstError?.detail || firstError?.code || "墨墨接口返回失败";
    throw new Error(String(detail).slice(0, 300));
  }
  return data?.data ?? data ?? {};
}

function cleanInterpretations(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 12).map((item: any) => ({
    id: String(item?.id || ""),
    interpretation: String(item?.interpretation || "").slice(0, 1000),
    tags: Array.isArray(item?.tags) ? item.tags.map(String).slice(0, 12) : [],
  })).filter((item) => item.interpretation);
}

function cleanNotes(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 12).map((item: any) => ({
    id: String(item?.id || ""),
    type: String(item?.note_type || "").slice(0, 80),
    note: String(item?.note || "").slice(0, 1200),
  })).filter((item) => item.note);
}

function cleanPhrases(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 8).map((item: any) => ({
    id: String(item?.id || ""),
    phrase: String(item?.phrase || "").slice(0, 1200),
    interpretation: String(item?.interpretation || "").slice(0, 1200),
    origin: String(item?.origin || "").slice(0, 120),
  })).filter((item) => item.phrase);
}

type AiDefinition = {
  meanings: Array<{ partOfSpeech: string; definition: string }>;
  collocations: Array<{ phrase: string; meaning: string }>;
  example: { english: string; chinese: string } | null;
};

function cleanText(value: unknown, maxLength: number) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parseAiDefinition(content: unknown): AiDefinition | null {
  const raw = String(content || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    const meanings = (Array.isArray(parsed?.meanings) ? parsed.meanings : [])
      .slice(0, 6)
      .map((item: any) => ({
        partOfSpeech: cleanText(item?.partOfSpeech, 24),
        definition: cleanText(item?.definition, 240),
      }))
      .filter((item: { definition: string }) => item.definition);
    const collocations = (Array.isArray(parsed?.collocations) ? parsed.collocations : [])
      .slice(0, 5)
      .map((item: any) => ({
        phrase: cleanText(item?.phrase, 100),
        meaning: cleanText(item?.meaning, 160),
      }))
      .filter((item: { phrase: string }) => item.phrase);
    const english = cleanText(parsed?.example?.english, 280);
    const chinese = cleanText(parsed?.example?.chinese, 280);
    if (!meanings.length) return null;
    return {
      meanings,
      collocations,
      example: english ? { english, chinese } : null,
    };
  } catch {
    return null;
  }
}

async function generateAiDefinition(word: string): Promise<AiDefinition | null> {
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  if (!apiKey) throw new Error("AI 释义服务尚未配置");
  const baseUrl = (Deno.env.get("DEEPSEEK_BASE_URL") || "https://api.deepseek.com").replace(/\/$/, "");
  const model = Deno.env.get("DEEPSEEK_MODEL_FLASH")
    || Deno.env.get("DEEPSEEK_MODEL")
    || "deepseek-chat";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: 700,
        messages: [
          {
            role: "system",
            content: "你是严谨的英汉学习词典。只输出合法 JSON，不要 Markdown。格式：{\"meanings\":[{\"partOfSpeech\":\"n.\",\"definition\":\"常用中文释义\"}],\"collocations\":[{\"phrase\":\"English phrase\",\"meaning\":\"中文含义\"}],\"example\":{\"english\":\"自然、简短的英文例句\",\"chinese\":\"中文翻译\"}}。义项按常用程度排列，最多 5 个；搭配最多 4 个。",
          },
          { role: "user", content: `请解释：${word}` },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`AI 服务 HTTP ${response.status}`);
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("AI 服务返回格式异常");
  }
  const definition = parseAiDefinition(data?.choices?.[0]?.message?.content);
  if (!definition) throw new Error("AI 释义格式异常");
  return definition;
}

async function lookupWord(word: string, token: string) {
  pruneCache();
  const cached = lookupCache.get(word);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let vocabularyData: any;
  try {
    vocabularyData = await maimemoRequest(`/vocabulary?spelling=${encodeURIComponent(word)}`, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP 404|not found|不存在/i.test(message)) {
      const missing = { found: false, word };
      lookupCache.set(word, { expiresAt: Date.now() + CACHE_TTL_MS, value: missing });
      return missing;
    }
    throw error;
  }
  const vocabulary = vocabularyData?.voc
    || vocabularyData?.vocabulary
    || (vocabularyData?.id && vocabularyData?.spelling ? vocabularyData : null);
  if (!vocabulary?.id) {
    const missing = { found: false, word };
    lookupCache.set(word, { expiresAt: Date.now() + CACHE_TTL_MS, value: missing });
    return missing;
  }

  const vocId = String(vocabulary.id);
  const warnings: string[] = [];
  const safeDetail = async (path: string, field: string) => {
    try {
      const data = await maimemoRequest(path, token);
      if (Array.isArray(data)) return data;
      return data?.[field] || data?.items || [];
    } catch (error) {
      warnings.push(`${field}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  };

  const encodedId = encodeURIComponent(vocId);
  const [interpretations, notes, phrases] = await Promise.all([
    safeDetail(`/interpretations?voc_id=${encodedId}`, "interpretations"),
    safeDetail(`/notes?voc_id=${encodedId}`, "notes"),
    safeDetail(`/phrases?voc_id=${encodedId}`, "phrases"),
  ]);

  const cleanedInterpretations = cleanInterpretations(interpretations);
  let aiDefinition: AiDefinition | null = null;
  if (!cleanedInterpretations.length) {
    try {
      aiDefinition = await generateAiDefinition(String(vocabulary.spelling || word));
    } catch (error) {
      console.error("AI definition failed:", error);
      warnings.push(`aiDefinition: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const result = {
    found: true,
    word: String(vocabulary.spelling || word),
    vocId,
    interpretations: cleanedInterpretations,
    notes: cleanNotes(notes),
    phrases: cleanPhrases(phrases),
    aiDefinition,
    definitionSource: cleanedInterpretations.length ? "maimemo" : aiDefinition ? "ai" : "none",
    warnings: warnings.slice(0, 3),
    source: "maimemo",
  };
  const resultTtl = !cleanedInterpretations.length && !aiDefinition ? 60 * 1000 : CACHE_TTL_MS;
  lookupCache.set(word, { expiresAt: Date.now() + resultTtl, value: result });
  pruneCache();
  return result;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") {
    if (!isAllowedOrigin(origin)) return jsonResponse({ error: "Origin not allowed" }, 403, origin);
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: "Origin not allowed" }, 403, origin);
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);
  if (isRateLimited(req)) return jsonResponse({ error: "请求过于频繁，请稍后再试" }, 429, origin);

  const token = Deno.env.get("MAIMEMO_API_TOKEN");
  if (!token) return jsonResponse({ error: "Missing MAIMEMO_API_TOKEN" }, 500, origin);

  let body: LookupBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }
  if (body.action !== "lookup") return jsonResponse({ error: "Unsupported action" }, 400, origin);
  const word = cleanWord(body.word);
  if (!word) return jsonResponse({ error: "请输入 1–64 个英文字母组成的单词或短语" }, 400, origin);

  try {
    return jsonResponse(await lookupWord(word, token), 200, origin);
  } catch (error) {
    console.error("Maimemo lookup failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: "墨墨查词失败", detail: message.slice(0, 300) }, 502, origin);
  }
});
