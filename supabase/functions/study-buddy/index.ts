const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type RequestBody = {
  messages?: ChatMessage[];
  model?: string;
  modelPreset?: "flash" | "pro";
  thinking?: "enabled" | "disabled";
  context?: unknown;
  actionSchemas?: unknown;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function extractJsonActions(text: string) {
  const actions: unknown[] = [];
  const candidates: string[] = [];
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first > -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        actions.push(...parsed.filter(isSupportedAction));
      } else if (isSupportedAction(parsed)) {
        actions.push(parsed);
      }
    } catch {
      // The model may return ordinary prose. That is fine.
    }
  }
  return actions;
}

function isSupportedAction(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const action = value as { action?: string; tasks?: unknown; reminders?: unknown };
  return (
    (action.action === "create_tasks" && Array.isArray(action.tasks)) ||
    (action.action === "create_reminders" && Array.isArray(action.reminders))
  );
}

function cleanModelId(value: unknown) {
  const model = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9._:-]{2,80}$/.test(model) ? model : "";
}

function sanitizeMessageContent(value: unknown) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\\/g, "/")
    .replace(/[\u2028\u2029]/g, " ")
    .trim()
    .slice(0, 12000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (Deno.env.get("STUDY_SHARED_AI_ENABLED") !== "true") {
    return jsonResponse({
      error: "Shared AI endpoint is disabled. Configure your own AI API endpoint in Study Plan.",
    }, 410);
  }

  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  const baseUrl = Deno.env.get("DEEPSEEK_BASE_URL") || "https://api.deepseek.com";

  if (!apiKey) {
    return jsonResponse({ error: "Missing DEEPSEEK_API_KEY in Supabase Function Secrets" }, 500);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const messages = Array.isArray(body.messages)
    ? body.messages
        .filter((message) => message && typeof message === "object")
        .map((message) => ({
          role: ["system", "user", "assistant"].includes(message.role) ? message.role : "user",
          content: sanitizeMessageContent(message.content),
        }))
        .filter((message) => message.content)
    : [];
  if (!messages.length) {
    return jsonResponse({ error: "Missing messages" }, 400);
  }

  const flashModel = Deno.env.get("DEEPSEEK_MODEL_FLASH")
    || Deno.env.get("DEEPSEEK_MODEL")
    || "deepseek-v4-flash";
  const proModel = Deno.env.get("DEEPSEEK_MODEL_PRO")
    || Deno.env.get("DEEPSEEK_REASONER_MODEL")
    || "deepseek-v4-pro";
  const modelPreset = body.modelPreset === "pro" ? "pro" : "flash";
  const model = cleanModelId(body.model) || (modelPreset === "pro" ? proModel : flashModel);
  const thinkingMode = body.thinking === "enabled" ? "enabled" : "disabled";
  const deepseekLike = baseUrl.includes("deepseek") || model.startsWith("deepseek-");
  const payload: Record<string, unknown> = {
    model,
    messages,
    stream: false,
  };
  if (deepseekLike && thinkingMode === "enabled") {
    payload.thinking = { type: thinkingMode };
    payload.reasoning_effort = "high";
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const deepseekText = await response.text();
  if (!response.ok) {
    let detail = deepseekText.slice(0, 1000);
    try {
      const parsed = JSON.parse(deepseekText);
      detail = parsed?.error?.message || parsed?.message || detail;
    } catch {
      // Keep the raw upstream body.
    }
    return jsonResponse({
      error: "DeepSeek request failed",
      status: response.status,
      detail,
      model,
      modelPreset,
      thinking: thinkingMode,
    }, 502);
  }

  let deepseekData: any;
  try {
    deepseekData = JSON.parse(deepseekText);
  } catch {
    return jsonResponse({ error: "DeepSeek returned non-JSON response" }, 502);
  }

  const message = deepseekData?.choices?.[0]?.message || {};
  const reply = message?.content || "";
  return jsonResponse({
    reply,
    actions: extractJsonActions(reply),
    usage: deepseekData?.usage || null,
    model,
    modelPreset,
    thinking: thinkingMode,
    reasoningContent: message?.reasoning_content || "",
  });
});
