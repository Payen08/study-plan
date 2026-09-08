# HANDOFF

最后更新：2026-08-11  
工作目录：`/Users/mac/Downloads/study-plan-main 1`

这份文档写给一个完全没有上下文的新会话。先读完再改代码，尤其是 `studyplan-github.html`、`index.html`、PWA、Supabase 同步这几块很容易踩坑。

## 1. 任务目标

这个项目是一个考研学习计划工具，核心是：

- 日历任务管理：按日期记录学习任务、完成状态、每日笔记。
- 多维笔记本：以 `科目 -> 文件夹 -> 笔记` 组织，而不是纯日期驱动。
- 日历辅助视图：当天写过/关联过的多维笔记会投影到当天日历笔记里，方便看“某天写了哪些笔记”。
- 云端同步：通过 Supabase 的 `study_progress` 表同步所有状态。
- PWA/GitHub Pages 使用：最终部署目标是 `https://payen08.github.io/study-plan/`，本地 `studyplan-github.html` 只是测试文件名。
- AI 学习伙伴：悬浮入口，不是独立 AI 页面。它读取当前学习状态、笔记、任务完成情况，给出计划、复盘、任务写入和提醒。

用户最近的产品想法：

```text
你提供考试日期、科目、每天可用时间
↓
AI 生成备考计划，直接写入日历任务
↓
每天主动提醒今日任务
↓
你完成任务 + 记笔记
↓
AI 理解进度，动态调整计划
↓
你随时可以聊：今天没状态 / 这题不会 / 进度够吗
```

交互原则：AI 是右下角悬浮对话入口；主动提醒出现在日历视图里，不要做一个单独的“AI 页面”。

## 2. 当前文件状态

主要文件：

- `studyplan-github.html`：当前主要开发文件，最新功能都在这里。
- `index.html`：GitHub Pages 生产入口，但当前文件大小明显旧于 `studyplan-github.html`，不要假设它已经同步。
- `studypro.html`：早期修好云同步问题的参考版本。
- `manifest.json`：PWA manifest，目前指向 `/study-plan/`。
- `sw.js`：PWA service worker，已经改成 HTML/Supabase 网络优先，避免 PWA 旧缓存。
- `supabase/functions/study-buddy/index.ts`：AI 对话 Edge Function。
- `supabase/functions/study-push/index.ts`：微信/Server 酱推送 Edge Function。
- `supabase_ai_setup.sql`：AI + 推送相关 SQL/Secrets/cron 说明。
- `supabase_setup.sql`：旧版 Supabase setup，可参考但不要盲跑。
- `Bold/...`：图标资源目录，之前日历添加/笔记 icon 从这里换过。

Git 状态：

- 当前目录已经有 `.git`，但 `git status --short` 显示几乎所有文件都是 untracked。
- 也就是说这个本地仓库可能是后来 `git init` 的，不要用 `git reset --hard`、`git checkout --` 等破坏性命令。
- 如果要发布 GitHub，先确认远程仓库是用户指定的：`https://github.com/Payen08/study-plan.git`。

重要命名提醒：

- 用户强调过：`studyplan-github.html` 只是本地测试名。
- GitHub Pages 真正入口应是 `index.html`。
- 发布前通常需要把确认好的 `studyplan-github.html` 同步/复制成 `index.html`，否则 GitHub 上看不到最新改动。

## 3. 已完成内容

### 3.1 Supabase 云同步/PWA 修复

已做过这些方向的修复：

- Supabase 状态统一存在 `public.study_progress` 的 `data jsonb` 中。
- 前端历史上遇到过 `study_progress?id=eq.payen 400 Bad Request`、`on_conflict=id 400`、`flushCloudQueue undefined lastErr` 等问题，后来已修过。
- 云端同步 ID 用户常用的是 `payen`。
- 云端表早期确认过只有 `id text` 和 `data jsonb`，没有 `updated_at`。但现在 `supabase_ai_setup.sql` 会创建/补充 `updated_at`。不要在不知道 SQL 是否已执行的情况下依赖 `updated_at`。
- PWA 旧缓存导致固定在屏幕上的 PWA 不实时刷新云端内容，后来 `sw.js` 改为：
  - Supabase 请求不缓存。
  - HTML/document 请求 `no-store`。
  - 只缓存静态非 HTML 资源。
- `manifest.json` 当前配置：
  - `id`: `/study-plan/`
  - `start_url`: `/study-plan/?v=sync-fix-2026-04-27-pwa-refresh-v2`
  - `scope`: `/study-plan/`

注意：

- 本地用 `file://` 打开时，manifest 会因为 CORS 报错。`studyplan-github.html` 里后来做过 file origin 下移除 manifest href 的逻辑。
- 真正测试 PWA/Service Worker/manifest，最好用本地 http server 或 GitHub Pages，不要只用 `file://`。

### 3.2 日历 UI 修复

用户之前连续反馈过日历手机视角问题，已做过的方向包括：

- 日历添加/笔记 icon 换成用户指定 SVG：
  - `Bold/Essentional, UI/Add Square.svg` 用作添加 icon。
  - `Bold/Notes/Document Add.svg` 用作笔记 icon。
- icon 在 web 正常、手机太小的问题已调过，目标至少接近 `28px`。
- 黄色 icon 改成蓝色系。
- 手机端三杠菜单挡住日历笔记编辑，已调过浮动菜单/底部遮挡。
- 过去日期不再置灰。
- 今日标签曾在 iPad 被截断，后来思路改成更像日历：用圈住当天数字的方式弱化“今日”标签。

2026-08-11 本轮移动端修复：

- 账号登录 UI 暂时隐藏（登录门禁、账号弹窗、底部账号入口）；底层 Supabase 同步与认证代码保留。
- 吸顶月份导航改为避让 `safe-area-inset-top`，解决 iPhone/PWA 滚动后月份被状态栏遮挡。
- 当前月份在导航渲染后自动滚动到可视区域中央。
- 快捷菜单展开时提高遮罩/面板层级，并让 AI 悬浮按钮退出点击层，避免菜单项被遮挡或点错。
- 手机端日历操作按钮与月份按钮的点击区域提升到至少 `44px`。
- `file://` 直开时状态明确显示“本地模式”；PWA 图标和 manifest 初始化也会完全跳过，避免独立安全源警告。
- Supabase 首次连接超过 5 秒时不再被判为永久离线，慢启动请求会继续完成，并保留 focus/每分钟自动重试。
- 新增 `.github/workflows/supabase-keepalive.yml`：每天北京时间 09:17 对 `study_progress` 发起一次只读查询，并可在 Actions 页面手动触发。仓库需要配置 GitHub Actions Secret `SUPABASE_ANON_KEY`。

### 3.3 多维笔记本数据模型

核心模型已经从“日期驱动”转为：

```text
科目 -> 文件夹 -> 笔记
```

同时保持日历映射：

- 每条 notebook entry 有 `dateKey` 和 `linkedDateKeys`。
- 日历查看某天时，会通过 `getNotebookEntriesByDate(dateKey)` 找到：
  - `entry.dateKey === dateKey`
  - 或 `entry.linkedDateKeys.includes(dateKey)`
- 这样“今天写过的多维笔记”可以投影到当天日历笔记中。

状态字段大致是：

```js
state.notebookFolders = {
  [folderId]: {
    id,
    subjectType,
    name,
    createdAt,
    updatedAt
  }
}

state.notebookEntries = {
  [entryId]: {
    id,
    subjectType,
    folderId,
    dateKey,
    linkedDateKeys,
    title,
    html,
    content,
    pinned,
    createdAt,
    updatedAt
  }
}
```

已实现：

- 自动为每个科目创建默认文件夹。
- 旧 notebook entries 自动补齐 `subjectType`、`folderId`、`dateKey`、`linkedDateKeys`、`pinned`。
- 新建文件夹。
- 新建笔记。
- 将笔记移动到当前科目的其他文件夹。
- 笔记标星置顶：`entry.pinned = true`，排序时星标优先。
- 编辑页删除当前笔记。
- 笔记列表卡片上直接删除，不必先进编辑页。
- 删除会弹确认，避免误删。

相关函数可搜索：

- `ensureNotebookFolders`
- `getNotebookFoldersBySubject`
- `getNotebookEntriesByFolder`
- `renderNotebookFolders`
- `renderNotebookEntries`
- `moveNotebookEntryToFolder`
- `toggleNotebookStar`
- `deleteCurrentNotebookEntry`
- `deleteNotebookEntryFromList`
- `commitNotebookDraft`

### 3.4 多维笔记本 UI/交互

用户明确不喜欢早期桌面左侧常驻栏，最后改成手机同款分步交互。

当前交互：

```text
打开多维笔记本
↓
选择文件夹：科目 chip + 文件夹宫格 + 新增文件夹卡片
↓
进入文件夹：笔记列表 + 新建笔记
↓
进入笔记：编辑器整屏显示
```

已做的 UI 调整：

- 桌面端也使用分步交互，不再左右栏常驻编辑器。
- 文件夹卡片是正方形网格。
- “新增文件夹”是同级正方形卡片，灰色虚线描边，显示 `+` 和“新增文件夹”。
- 新建文件夹不再是圆形按钮，也不再有浅蓝底。
- 笔记列表卡片：
  - 标题一行。
  - 内容最多三行。
  - 内容普通字重，不加粗。
  - 选中态去浅蓝底，改白底 + 蓝色描边/内阴影。
  - 卡片右上角可直接删除。
  - 星标笔记显示星星，且置顶。
- 编辑器顶部：
  - 左侧返回。
  - 标题显示科目。
  - 文件夹下拉用于移动当前笔记。
  - 右侧有星标、删除、关闭。
- 文件夹下拉箭头：
  - 已隐藏原生箭头。
  - 使用自定义 SVG 背景箭头。
  - 右侧留出边距，最近调整为 desktop `right 16px center`，mobile `right 14px center`。

最近一次 UI 改动：

- 日历查看模式中 `来自 Notebook` 投影块字体变小、行距变大：
  - `.projection-text` 字号 `15px`
  - line-height `1.9`
  - 段落间距 `14px`
  - `font-weight: 400`
  - 覆盖了旧的 `#note-editor .projection-text { line-height: 1.45 }`

### 3.5 日历查看模式中的多维笔记投影

日历每日笔记里会追加一块：

```html
<section class="notebook-projection" data-notebook-projection="1" contenteditable="false">
  <div class="projection-head">来自 Notebook</div>
  ...
</section>
```

相关函数：

- `buildProjectionHtml(dateKey)`
- `getRenderedNoteHtml(dateKey, ensureEditableSlot = false)`
- `stripProjectionHtml(html)`
- `syncNotebookProjectionEdits()`

注意：

- 投影块原则上是从 notebook entries 渲染出来的，不应直接保存为普通每日笔记正文。
- `stripProjectionHtml()` 用来避免把投影 HTML 写回 `state.notes`。
- 如果改日历笔记保存逻辑，要小心不要把投影内容复制进 daily note，造成重复。

### 3.6 AI 学习伙伴

当前 `studyplan-github.html` 里已经有 AI 学习伙伴代码，不只是 prompt 草案。

### 3.7 墨墨查词联动

2026-08-11 新增第一版墨墨联动：

- Supabase Edge Function：`supabase/functions/maimemo-proxy/index.ts`。
- Token 只从 Supabase Secret `MAIMEMO_API_TOKEN` 读取，不写入前端。
- 生产域名默认限制为 `https://payen08.github.io`，本地允许 localhost；只开放只读查词。
- Study Plan 全局搜索输入英文单词时，会同时查询墨墨词汇、自定义释义、助记和例句。
- 墨墨没有返回自定义释义时，显示 AI 解释入口；开放 API 不提供 App 内置词典释义。
- 查词结果可保存为英语科目的多维笔记。
- 前端 450ms 防抖，Edge Function 按 IP 限流并缓存 5 分钟，以遵守墨墨频控。

可搜索：

- `AI 学习伙伴`
- `ai-buddy-fab`
- `AI_API_ENDPOINT`
- `STUDY_PUSH_ENDPOINT`
- `DEFAULT_AI_BUDDY`
- `collectNotebookProgress`
- `buildAiSystemPrompt`
- `create_tasks`
- `create_reminders`
- `appendToNotebookEntry`
- `createNotebookFromSelection`

前端默认 endpoints：

```js
const AI_API_ENDPOINT = `${SUPABASE_URL}/functions/v1/study-buddy`;
const STUDY_PUSH_ENDPOINT = `${SUPABASE_URL}/functions/v1/study-push`;
```

当前 build tag：

```text
wechat-push-debug-2026-05-28-v1
```

AI 已实现/设计中的能力：

- 右下角 AI 悬浮按钮。
- AI 聊天面板。
- AI 资料/配置面板：考试日期、每天可用小时、目标院校/专业、科目基础、模考成绩、API 地址、模型、微信推送配置。
- 收集上下文：
  - 考试剩余天数。
  - 今日任务完成情况。
  - 本周任务完成情况。
  - 笔记进度。
  - 多维笔记结构/进度。
  - 历史对话摘要。
- 模型输出 `create_tasks` 时自动写入日历任务。
- 模型输出 `create_reminders` 时自动写提醒。
- 用户选中 AI 回复文字后，可以加入/追加到多维笔记本。
- 笔记检索/RAG 逻辑：会从每日笔记和 notebook entries 搜相关片段塞进 prompt。

Edge Functions：

- `supabase/functions/study-buddy/index.ts`
  - 代理 DeepSeek API。
  - 支持 `modelPreset: flash/pro`。
  - 支持 `thinking: enabled/disabled`。
  - 提取模型回复中的 `create_tasks` / `create_reminders` actions。
  - 绝不能把 DeepSeek API key 写进 HTML。
- `supabase/functions/study-push/index.ts`
  - 负责每日推送。
  - 支持 Server 酱。
  - 从 Supabase 中按 sync id 获取状态，生成今日任务/本周进度摘要。

需要 Supabase Secrets：

```text
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL_FLASH=deepseek-v4-flash
DEEPSEEK_MODEL_PRO=deepseek-v4-pro
SERVERCHAN_SENDKEY=SCT...
STUDY_PUSH_SYNC_ID=payen 或用户实际同步 ID
STUDY_PUSH_TIMEZONE=Asia/Shanghai
```

需要部署：

```bash
supabase functions deploy study-buddy
supabase functions deploy study-push
```

可选 SQL：`supabase_ai_setup.sql`，里面包含：

- `study_progress` 表创建/补充。
- RLS policy。
- `updated_at` trigger。
- `pg_cron` + `pg_net` 定时推送示例。

## 4. 当前问题/未完成事项

### 4.1 `studyplan-github.html` 与 `index.html` 未同步

这是最重要的发布坑。

当前 `studyplan-github.html` 很大，包含最新 AI 和 notebook UI；`index.html` 明显旧很多。用户最终上传 GitHub Pages 用的是 `index.html`，所以发布前必须确认：

```bash
cp studyplan-github.html index.html
```

或用用户认可的方式同步。

不要反过来用旧 `index.html` 覆盖 `studyplan-github.html`。

### 4.2 当前 Git 全部 untracked

`git status --short` 显示所有文件未跟踪。新会话如果要提交，先确认用户是否希望初始化/提交整个项目。不要随便 `git add .`。

建议提交前至少说明范围：

- `studyplan-github.html`
- `index.html`（如果已同步）
- `manifest.json`
- `sw.js`
- `supabase/functions/...`
- `supabase_ai_setup.sql`

### 4.3 AI 端到端可能需要重新验证

虽然前端和 Edge Functions 代码都在，但未确认当前 Supabase 项目：

- Edge Functions 是否已 deploy 最新版本。
- Secrets 是否齐全。
- DeepSeek 模型名是否仍可用。
- Server 酱 SendKey 是否有效。
- 定时推送 cron 是否已开启。

验证顺序建议：

1. 在 AI 资料面板点“测试”。
2. 看浏览器 console 是否有 `AI API` 错误。
3. 直接测试 Edge Function：`study-buddy`。
4. 再测试 `study-push` dryRun/test。
5. 最后再测定时推送。

### 4.4 Supabase 表结构不要想当然

用户以前在 SQL 编辑器查过：

```sql
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='study_progress'
order by ordinal_position;
```

当时结果只有：

```text
id text
data jsonb
```

后来 `supabase_ai_setup.sql` 会补 `updated_at`。所以如果新会话要写 SQL 或查询，不要默认线上已经有 `updated_at`，先查表结构。

### 4.5 文件夹/笔记删除还需要真实数据回归

列表直接删除按钮已加，但最近浏览器验证时当前文件夹没有笔记，所以只验证了代码/语法，没有实际点删除。需要用有笔记的文件夹回归：

- 点击列表卡片是否仍打开笔记。
- 点击垃圾桶是否只弹删除确认，不打开笔记。
- 删除后是否停留在笔记列表。
- 删除星标笔记后排序是否正常。
- 删除后是否同步到 Supabase。

### 4.6 投影块样式需要视觉确认

最近刚改了日历查看模式的 Notebook 投影样式：字体小、行距大。需要用户肉眼确认是否舒服。可能还要调：

- `font-size: 14px` 或 `15px`。
- `line-height: 1.8` 或 `1.9`。
- 段落间距 `12px` 或 `14px`。

## 5. 下一步计划

建议按这个顺序继续：

1. **视觉回归**
   - 打开 `studyplan-github.html`。
   - 测日历查看模式的 Notebook 投影块。
   - 测多维笔记本：文件夹页、笔记列表、编辑器页、暗黑模式、手机/iPad 视角。

2. **功能回归**
   - 新建文件夹。
   - 新建笔记。
   - 移动笔记到其他文件夹。
   - 标星/取消标星。
   - 列表直接删除。
   - 编辑页删除。
   - 日历当天是否显示多维笔记投影。
   - 云端保存后刷新/换浏览器是否能看到。

3. **AI 伙伴回归**
   - 打开 AI 面板。
   - 资料面板保存配置。
   - API 测试。
   - 发送一句普通对话。
   - 让 AI 生成任务，确认能写入日历。
   - 选中 AI 回复片段加入多维笔记。
   - 测试提醒/Server 酱。

4. **发布准备**
   - 确认 `studyplan-github.html` 是用户认可版本。
   - 同步到 `index.html`。
   - 如改 PWA 行为，更新 `BUILD_TAG`、`manifest.json` start_url 版本和 `sw.js` cache name。
   - 再提交并推送到 `Payen08/study-plan.git`。

## 6. 踩过的坑

### 6.1 不要把 `studyplan-github.html` 当生产路径

用户非常明确：`studyplan-github.html` 只是本地命名。真实 GitHub Pages 入口是 `index.html`。

### 6.2 不要把 PWA scope 写成本地文件名

以前误把 manifest/sw 指向 `studyplan-github.html`，用户指出这是错的。GitHub Pages 应该是 `/study-plan/`。

### 6.3 `file://` 会导致 manifest/CORS 问题

本地 file 打开时浏览器会报：

```text
Access to manifest at file:///.../manifest.json from origin null has been blocked by CORS policy
```

这是 file origin 的限制。PWA/manifest 正式验证请用 http 或 GitHub Pages。

### 6.4 PWA 固定图标容易看到旧云端数据

原因通常是 service worker 缓存 HTML 或 Supabase 响应。现在 `sw.js` 已尽量避免缓存 HTML 和 Supabase，但发布后仍可能需要：

- 更新 `CACHE_NAME`。
- 更新 `BUILD_TAG`。
- 强刷。
- 删除旧 PWA 后重新添加。

### 6.5 Supabase 400 不一定是前端字段错

历史上出现过：

```text
POST /rest/v1/study_progress?on_conflict=id 400
PATCH /rest/v1/study_progress?id=eq.payen 400
```

排查顺序：

1. 表是否存在。
2. `id` 是否 text。
3. `data` 是否 jsonb。
4. RLS policy 是否允许 anon select/insert/update。
5. 前端是不是写了线上表没有的列，比如 `updated_at`。
6. payload 是否过大或格式非法。

### 6.6 Notebook 投影不要重复写回 daily note

日历笔记查看模式的 `来自 Notebook` 是投影，不是 daily note 原文。保存 daily note 时必须去掉 `data-notebook-projection`，否则刷新后会重复。

### 6.7 不要用本地规则冒充 AI

AI API 失败时，当前前端会显示错误详情，不应该用本地 fallback 假装模型回答。用户要的是“真正了解进度的 AI”，不是模板建议。

### 6.8 UI 方向偏好

用户对 UI 很敏感，几个明确偏好：

- 不喜欢浅蓝大面积底色。
- 不喜欢黄色 icon。
- 不喜欢 web 上笨重的左侧栏布局。
- 喜欢手机同款分步交互。
- 文件夹更适合正方形卡片。
- 新建文件夹应该像一个同级卡片，不是圆形小按钮。
- 框内内容不要过度加粗。
- 间距和图标大小要认真看手机/iPad。

## 7. 快速检查命令

语法检查 HTML 内联脚本：

```bash
node - <<'NODE'
const fs=require('fs');
const html=fs.readFileSync('studyplan-github.html','utf8');
const scripts=[...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
let ok=true;
scripts.forEach((code,i)=>{try{new Function(code)}catch(e){ok=false;console.error(`script ${i+1}: ${e.message}`)}});
console.log(ok ? `OK: parsed ${scripts.length} inline scripts` : 'FAILED');
NODE
```

本地 HTTP 预览：

```bash
cd "/Users/mac/Downloads/study-plan-main 1"
python3 -m http.server 8766 --bind 127.0.0.1
```

打开：

```text
http://127.0.0.1:8766/studyplan-github.html
```

Supabase 表结构检查：

```sql
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='study_progress'
order by ordinal_position;
```

获取当前 build tag：

```bash
rg -n "BUILD_TAG" studyplan-github.html
```

查关键 notebook 代码：

```bash
rg -n "renderNotebookEntries|toggleNotebookStar|deleteNotebookEntryFromList|moveNotebookEntryToFolder|notebook-projection" studyplan-github.html
```

查 AI 代码：

```bash
rg -n "AI_API_ENDPOINT|buildAiSystemPrompt|create_tasks|study-push|collectNotebookProgress" studyplan-github.html supabase/functions
```

## 8. 接手时的建议开场

如果新会话继续接这个项目，建议先做：

1. 读 `HANDOFF.md`。
2. 跑 HTML 内联脚本语法检查。
3. 用浏览器打开 `studyplan-github.html`，确认当前用户看到的问题。
4. 修改只动必要区域，不要大面积重构。
5. 修改后再语法检查 + 浏览器回归。
6. 发布前问用户是否把 `studyplan-github.html` 同步到 `index.html`。
