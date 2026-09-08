const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PushTask = {
  text: string;
  done?: boolean;
  subjectName?: string;
  label?: string;
};

type PushSummary = {
  todayDate: string;
  todayLabel?: string;
  daysLeft?: number;
  targetName?: string;
  profile?: {
    targetSchool?: string;
    major?: string;
    dailyHours?: number;
  };
  today?: {
    total: number;
    done: number;
    left: number;
    tasks: PushTask[];
  };
  week?: {
    total: number;
    done: number;
    left?: number;
    rate?: number;
    noteDays?: number;
  };
  overdue?: PushTask[];
};

type RequestBody = {
  mode?: "test" | "daily";
  syncId?: string;
  state?: any;
  summary?: PushSummary;
  pushConfig?: {
    enabled?: boolean;
    time?: string;
    provider?: "serverchan" | "messagepusher" | "wechatwork";
    messagePusherUrl?: string;
    messagePusherUsername?: string;
    messagePusherToken?: string;
    messagePusherChannel?: string;
  };
  dryRun?: boolean;
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

function datePartsInZone(date = new Date(), timeZone = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

function todayStamp(timeZone = Deno.env.get("STUDY_PUSH_TIMEZONE") || "Asia/Shanghai") {
  const parts = datePartsInZone(new Date(), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseStamp(stamp: string) {
  const match = String(stamp || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function addDaysStamp(stamp: string, days: number) {
  const parts = parseStamp(stamp);
  if (!parts) return stamp;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dateToStudyKey(stamp: string) {
  const parts = parseStamp(stamp);
  if (!parts) return stamp;
  if (parts.year === 2025 && parts.month === 12) return `d${parts.day}`;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function keyToLabel(key: string) {
  if (String(key || "").startsWith("d")) return `2025年12月${String(key).slice(1)}日`;
  const [year, month, day] = String(key || "").split("-");
  return year && month && day ? `${year}年${month}月${day}日` : key;
}

function keyToStamp(key: string) {
  if (String(key || "").startsWith("d")) return `2025-12-${String(key).slice(1).padStart(2, "0")}`;
  const parts = String(key || "").split("-");
  if (parts.length < 3) return "";
  return `${parts[0]}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}`;
}

function daysBetween(fromStamp: string, toStamp: string) {
  const from = parseStamp(fromStamp);
  const to = parseStamp(toStamp);
  if (!from || !to) return 0;
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.ceil((b - a) / 86400000);
}

function getSubjectName(state: any, type: string) {
  const categories = state?.settings?.categories || [];
  const exact = categories.find((cat: any) => cat?.type === type);
  if (exact?.name) return exact.name;
  const legacy: Record<string, string> = {
    "t-pol": "政治",
    "t-eng": "英语",
    "t-art": "手绘",
    "t-the": "337",
    "t-work": "手绘",
    "t-study": "学习",
    "t-life": "生活",
    "t-urgent": "紧急",
  };
  return legacy[type] || "学习";
}

function textFromHtml(html: string) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function getTasksForKey(state: any, key: string): PushTask[] {
  const year = String(key || "").startsWith("d") ? "2025" : String(key || "").split("-")[0];
  const yearState = state?.[year] || {};
  const done = new Set(yearState.done || []);
  return (yearState.customTasks?.[key] || []).map((task: any) => ({
    text: String(task?.text || "学习任务"),
    done: done.has(task?.id),
    subjectName: getSubjectName(state, task?.type),
  }));
}

function noteTextForKey(state: any, key: string) {
  const year = String(key || "").startsWith("d") ? "2025" : String(key || "").split("-")[0];
  const yearState = state?.[year] || {};
  const daily = textFromHtml(yearState.notes?.[key] || "");
  const notebook = Object.values(yearState.notebookEntries || {})
    .filter((entry: any) => entry?.dateKey === key || (entry?.linkedDateKeys || []).includes(key))
    .map((entry: any) => [entry?.title, entry?.content || textFromHtml(entry?.html || "")].filter(Boolean).join(": "))
    .join("\n");
  return [daily, notebook].filter(Boolean).join("\n").trim();
}

function collectRange(state: any, startStamp: string, days: number) {
  let total = 0;
  let done = 0;
  let noteDays = 0;
  const rows: PushTask[] = [];
  for (let i = 0; i < days; i++) {
    const stamp = addDaysStamp(startStamp, i);
    const key = dateToStudyKey(stamp);
    if (noteTextForKey(state, key)) noteDays++;
    getTasksForKey(state, key).forEach((task) => {
      total++;
      if (task.done) done++;
      rows.push({ ...task, label: keyToLabel(key) });
    });
  }
  return {
    total,
    done,
    left: Math.max(0, total - done),
    rate: total ? Math.round((done / total) * 100) : 0,
    noteDays,
    rows,
  };
}

function buildSummaryFromState(state: any): PushSummary {
  const todayDate = todayStamp();
  const todayKey = dateToStudyKey(todayDate);
  const todayTasks = getTasksForKey(state, todayKey);
  const targetDate = state?.settings?.aiBuddy?.profile?.examDate || state?.settings?.targetDate || "2026-12-19";
  const day = new Date(`${todayDate}T00:00:00Z`).getUTCDay();
  const weekStart = addDaysStamp(todayDate, -((day + 6) % 7));
  const week = collectRange(state, weekStart, 7);
  const overdue = collectRange(state, addDaysStamp(todayDate, -14), 14).rows
    .filter((task) => !task.done)
    .slice(0, 6);
  const profile = state?.settings?.aiBuddy?.profile || {};
  return {
    todayDate,
    todayLabel: keyToLabel(todayKey),
    daysLeft: Math.max(0, daysBetween(todayDate, targetDate)),
    targetName: state?.settings?.targetName || "距离考试仅剩",
    profile: {
      targetSchool: profile.targetSchool || "",
      major: profile.major || "",
      dailyHours: Number(profile.dailyHours) || 0,
    },
    today: {
      total: todayTasks.length,
      done: todayTasks.filter((task) => task.done).length,
      left: todayTasks.filter((task) => !task.done).length,
      tasks: todayTasks,
    },
    week: {
      total: week.total,
      done: week.done,
      left: week.left,
      rate: week.rate,
      noteDays: week.noteDays,
    },
    overdue,
  };
}

function composeMessage(summary: PushSummary, mode: string) {
  const today = summary.today || { total: 0, done: 0, left: 0, tasks: [] };
  const week = summary.week || { total: 0, done: 0, rate: 0, noteDays: 0 };
  const profile = summary.profile || {};
  const todo = (today.tasks || []).filter((task) => !task.done);
  const overdue = summary.overdue || [];
  const firstTask = todo[0]?.text || "打开日历补计划";
  const shortFirstTask = firstTask.replace(/\s+/g, " ").slice(0, 24);
  const taskLines = todo.length
    ? todo.slice(0, 5).map((task, index) => `${index + 1}. ${task.text}${task.subjectName ? `（${task.subjectName}）` : ""}`).join("\n")
    : "今天没有任务。建议打开日历让 AI 补 1-2 个轻量任务。";
  const overdueLines = overdue.length
    ? overdue.slice(0, 4).map((task) => `- ${task.label || ""} ${task.text}`.trim()).join("\n")
    : "暂无明显逾期任务。";
  const suggestion = todo.length
    ? `先做「${todo[0].text}」。如果状态一般，就只完成最小版本，先让计划继续滚起来。`
    : "今天适合做 10 分钟复盘，或者让 AI 生成下一组任务。";
  const title = mode === "test"
    ? `测试提醒｜今日${today.left || todo.length}任务｜Server酱已通`
    : `学习提醒｜今日${today.left || todo.length}任务｜${shortFirstTask}${overdue.length ? `｜逾期${overdue.length}` : ""}`;
  const desp = [
    `# ${mode === "test" ? "测试提醒" : "今天先做这个"}`,
    `**${shortFirstTask}**`,
    "",
    `今日：${today.done}/${today.total}　　本周：${week.done}/${week.total}${typeof week.rate === "number" ? `（${week.rate}%）` : ""}`,
    typeof summary.daysLeft === "number" ? `距离考试：${summary.daysLeft} 天${profile.dailyHours ? `　　可用：${profile.dailyHours}h/天` : ""}` : "",
    "",
    "## 今日任务",
    taskLines,
    "",
    "## 逾期",
    overdueLines,
    "",
    "## 建议",
    suggestion,
  ].filter((line) => line !== "").join("\n");
  return { title, desp };
}

async function fetchStateBySyncId(syncId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY");
  }
  const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/study_progress?id=eq.${encodeURIComponent(syncId)}&select=data`;
  const response = await fetch(url, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to read study_progress: ${response.status} ${await response.text()}`);
  }
  const rows = await response.json();
  return rows?.[0]?.data || null;
}

function getServerChanUrl() {
  const directUrl = Deno.env.get("SERVERCHAN_SEND_URL") || "";
  if (directUrl) return directUrl;
  const sendKey = Deno.env.get("SERVERCHAN_SENDKEY")
    || Deno.env.get("SERVERCHAN_SEND_KEY")
    || Deno.env.get("SERVERCHAN_SCKEY")
    || "";
  if (!sendKey) return "";
  if (/^https?:\/\//i.test(sendKey)) return sendKey;
  return `https://sctapi.ftqq.com/${encodeURIComponent(sendKey)}.send`;
}

async function sendServerChan(title: string, desp: string) {
  const url = getServerChanUrl();
  if (!url) throw new Error("Missing SERVERCHAN_SENDKEY in Supabase Function Secrets");
  const body = new URLSearchParams({ title, desp });
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
  });
  const text = await response.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    // ServerChan may still return plain text from some gateways.
  }
  if (!response.ok || (data && typeof data === "object" && data.code && data.code !== 0)) {
    throw new Error(`Server酱发送失败：${response.status} ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

// === message-pusher 推送 ===
// 使用你自己的 message-pusher 实例发送微信消息
// 前置条件：在 message-pusher 中已配置好微信渠道（推荐微信测试号）
function getMessagePusherConfig() {
  const baseUrl = (Deno.env.get("MESSAGE_PUSHER_URL") || "").replace(/\/+$/, "");
  const username = Deno.env.get("MESSAGE_PUSHER_USERNAME") || "";
  const token = Deno.env.get("MESSAGE_PUSHER_TOKEN") || "";
  const channel = Deno.env.get("MESSAGE_PUSHER_CHANNEL") || "";
  return { baseUrl, username, token, channel };
}

async function sendMessagePusher(title: string, description: string, content: string) {
  const { baseUrl, username, token, channel } = getMessagePusherConfig();
  if (!baseUrl || !username || !token || !channel) {
    throw new Error(
      "Missing MESSAGE_PUSHER_URL / USERNAME / TOKEN / CHANNEL in Supabase Function Secrets"
    );
  }
  const url = `${baseUrl}/push/${encodeURIComponent(username)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, description, content, channel }),
  });
  const result = await response.json();
  if (!response.ok || (result && !result.success)) {
    throw new Error(
      `message-pusher 发送失败：${response.status} ${result?.message || JSON.stringify(result)}`
    );
  }
  return result;
}

// === 企业微信自建应用 直接推送 ===
// 无需额外部署任何服务，直接从 Edge Function 调企业微信 API
// 需要：企业微信后台 → 应用管理 → 自建应用 → 获取 CorpId / AgentId / Secret

type WechatWorkToken = {
  access_token: string;
  expires_at: number; // timestamp in ms
};

let cachedToken: WechatWorkToken | null = null;

async function getWechatWorkAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expires_at > now + 60_000) {
    return cachedToken.access_token;
  }

  const corpId = Deno.env.get("WECHAT_CORP_ID") || "";
  const agentSecret = Deno.env.get("WECHAT_AGENT_SECRET") || "";

  if (!corpId || !agentSecret) {
    throw new Error("Missing WECHAT_CORP_ID or WECHAT_AGENT_SECRET in Supabase Function Secrets");
  }

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(agentSecret)}`;
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.errcode !== 0) {
    throw new Error(`企业微信获取 token 失败：${data.errmsg || JSON.stringify(data)}`);
  }

  cachedToken = {
    access_token: data.access_token,
    expires_at: now + (data.expires_in || 7200) * 1000,
  };

  return cachedToken.access_token;
}

async function sendWechatWorkApp(title: string, description: string, content: string) {
  const agentId = Deno.env.get("WECHAT_AGENT_ID") || "";
  if (!agentId) {
    throw new Error("Missing WECHAT_AGENT_ID in Supabase Function Secrets");
  }

  const accessToken = await getWechatWorkAccessToken();
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;

  // 企业微信应用号支持 markdown 消息
  const body: Record<string, unknown> = {
    touser: "@all",
    msgtype: "markdown",
    agentid: Number(agentId),
    markdown: { content },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();

  if (!response.ok || (result && result.errcode !== 0)) {
    throw new Error(
      `企业微信发送失败：errcode=${result?.errcode} ${result?.errmsg || JSON.stringify(result)}`
    );
  }

  return result;
}

// 统一推送入口：根据 provider 选择推送方式
async function sendPush(provider: string, title: string, desp: string, description: string) {
  if (provider === "wechatwork") {
    // desp 里已经是 Markdown 格式，直接作为 content 发送
    return await sendWechatWorkApp(title, description, desp);
  }
  if (provider === "messagepusher") {
    return await sendMessagePusher(title, description, desp);
  }
  // 默认走 Server酱
  return await sendServerChan(title, desp);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: RequestBody = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const mode = body.mode === "daily" ? "daily" : "test";
  let state = body.state || null;
  const syncId = body.syncId || Deno.env.get("STUDY_PUSH_SYNC_ID") || "default";
  try {
    if (!body.summary && !state) {
      state = await fetchStateBySyncId(syncId);
    }
    if (!body.summary && !state) {
      throw new Error(`No study_progress data found for syncId "${syncId}"`);
    }
    const pushConfig = body.pushConfig || state?.settings?.aiBuddy?.push || {};
    if (mode !== "test" && pushConfig.enabled === false) {
      return jsonResponse({ skipped: true, reason: "WeChat push disabled", syncId });
    }
    const summary = body.summary || buildSummaryFromState(state);
    const message = composeMessage(summary, mode);
    if (body.dryRun) {
      return jsonResponse({ sent: false, dryRun: true, syncId, ...message });
    }
    const provider = body.pushConfig?.provider || pushConfig.provider || "serverchan";
    const pushResult = await sendPush(provider, message.title, message.desp, message.desp);
    return jsonResponse({ sent: true, syncId, provider, ...message, pushResult });
  } catch (err) {
    return jsonResponse({
      error: err instanceof Error ? err.message : String(err),
      syncId,
    }, 500);
  }
});
