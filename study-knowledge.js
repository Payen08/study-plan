/* Summary text is authored in Obsidian; this view writes only immutable review events. */
(() => {
  'use strict';
  const categories=['全部','考研英语','考研政治','337 设计基础','长期学习','待确认'];
  let dialog,notes=[],active=null,currentId='',prefix='',filter='全部',search='',busy=false;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};
  const getId=()=>String(typeof MY_SYNC_ID!=='undefined'?MY_SYNC_ID:'').trim();
  const getClient=()=>typeof supabaseClient!=='undefined'?supabaseClient:null;
  const key=(name)=>`study-kb-${name}:${prefix}`;
  const read=(name,fallback,p=prefix)=>{try{return JSON.parse(localStorage.getItem(`study-kb-${name}:${p}`))||fallback;}catch(_){return fallback;}};
  const write=(name,data,p=prefix)=>localStorage.setItem(`study-kb-${name}:${p}`,JSON.stringify(data));
  async function namespace(id){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id));return 'kb-'+[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,20);}
  function notify(text){if(typeof showToast==='function')showToast(text);else console.info(text);}
  function inline(target,text){
    // Text nodes throughout: raw HTML, scripts, and model-generated links are never executed.
    const parts=String(text).split(/(\*\*[^*]+\*\*)/g);
    for(const p of parts)target.append(p.startsWith('**')&&p.endsWith('**')?el('strong',p.slice(2,-2)):document.createTextNode(p));
  }
  function markdown(text){
    const container=el('div',undefined,'kb-body');let details=null;
    for(const line of String(text).split('\n')){
      if(/^> \[!tip\]-/.test(line)){details=el('details');details.append(el('summary','参考答案'));container.append(details);continue;}
      if(details&&line.startsWith('>')){const p=el('p');inline(p,line.replace(/^>\s?/,''));details.append(p);continue;}
      if(!line.trim())continue;
      details=null;const m=line.match(/^(#{1,6})\s+(.*)$/);
      const p=el(m?'h'+Math.min(m[1].length+1,4):'p');
      inline(p,m?m[2]:line.replace(/^>\s?/,'').replace(/^[-*]\s+/,'• ').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1'));
      container.append(p);
    }
    return container;
  }
  function status(text,error=false){const n=dialog?.querySelector('.kb-status');if(n){n.textContent=text;n.classList.toggle('kb-error',error);}}
  function render(){
    if(!dialog)return;dialog.replaceChildren();
    const header=el('header');const left=el('div');left.append(el('h2',active?'学习总结':'Obsidian 知识库'));left.append(el('p',`同步 ID：${currentId}`,'kb-subtitle'));header.append(left);
    const actions=el('div',undefined,'kb-actions');if(active)actions.append(button('返回',()=>{active=null;render();}));else actions.append(button('刷新',refresh));actions.append(button('关闭',()=>dialog.close()));header.append(actions);dialog.append(header);
    dialog.append(el('p',navigator.onLine?'正在读取同步内容…':'离线浏览已缓存的总结','kb-status'));
    const content=el('div',undefined,'kb-content');dialog.append(content);
    if(active){
      content.append(el('h3',active.title));content.append(el('p',`${active.subject} · 来源：${active.sourceName}`,'kb-meta'));content.append(markdown(active.markdown));
      const review=el('section',undefined,'kb-review');review.append(el('h3','这次复习怎么样？'));review.append(el('p','正文在 Obsidian 中修改；这里的复习记录会回传到 Mac。','kb-meta'));
      const comment=el('textarea');comment.placeholder='记下卡住的地方或下次复习重点（可选）';comment.maxLength=2000;comment.setAttribute('aria-label','复习备注');comment.value=read('drafts',{})[active.noteId]||'';comment.oninput=()=>{try{const drafts=read('drafts',{});drafts[active.noteId]=comment.value;write('drafts',drafts);}catch(e){status('备注草稿未保存：'+e.message,true);}};review.append(comment);
      const grades=el('div',undefined,'kb-grades');for(const grade of ['未掌握','需巩固','已掌握'])grades.append(button(grade,()=>saveReview(grade,comment.value)));review.append(grades);
      const history=[...read('reviews',[]),...read('outbox',[])].filter(x=>x.noteId===active.noteId);const unique=[...new Map(history.map(x=>[x.eventId,x])).values()].sort((a,b)=>b.at.localeCompare(a.at));
      for(const r of unique.slice(0,10)){const pending=read('outbox',[]).some(x=>x.eventId===r.eventId);const p=el('p',`${new Date(r.at).toLocaleString()} · ${r.grade}${pending?' · 待上传':''}${r.comment?'\n'+r.comment:''}`,'kb-history');review.append(p);}
      content.append(review);
    }else{
      const tools=el('div',undefined,'kb-filters');const select=el('select');select.setAttribute('aria-label','按科目筛选');for(const c of categories){const o=el('option',c);o.value=c;select.append(o);}select.value=filter;select.onchange=()=>{filter=select.value;render();updateStatus();};
      const input=el('input');input.type='search';input.placeholder='搜索标题或总结';input.setAttribute('aria-label','搜索总结');input.value=search;input.oninput=()=>{search=input.value;renderList(list);};tools.append(select,input);content.append(tools);
      const list=el('div',undefined,'kb-list');content.append(list);renderList(list);
    }
    updateStatus();
  }
  function renderList(list){
    list.replaceChildren();const shown=notes.filter(n=>(filter==='全部'||n.subject===filter)&&(`${n.title}\n${n.markdown}`).toLowerCase().includes(search.toLowerCase()));
    if(!shown.length){list.append(el('p',notes.length?'没有匹配的总结。':'还没有同步的总结。在 Mac 的 Obsidian 中生成总结，并在插件设置中填入相同同步 ID。','kb-empty'));return;}
    for(const n of shown){const b=button('',()=>{active=n;render();});b.className='kb-note';b.append(el('span',n.subject,'kb-meta'),el('strong',n.title),el('span',n.sourceName,'kb-meta'));list.append(b);}
  }
  function updateStatus(){const pending=read('outbox',[]).length;status(`${notes.length} 篇总结${pending?` · ${pending} 条复习记录待上传`:''} · ${navigator.onLine?'本地模型仅在 Mac 运行时处理新资料':'当前离线'}`);}
  async function rows(client,p){let offset=0,result=[];for(;;){const {data,error}=await client.from('study_progress').select('id,data').like('id',p+'%').order('id').range(offset,offset+999);if(error)throw error;result.push(...data);if(data.length<1000)return result;offset+=data.length;}}
  async function refresh(){
    if(busy)return;busy=true;const id=currentId,p=prefix;status('正在同步…');
    try{
      const client=getClient();if(!client)throw new Error('Web云端连接尚未就绪，请稍后刷新');
      await flush();
      const [summaries,reviews]=await Promise.all([rows(client,p+'-n-'),rows(client,p+'-r-')]);
      if(id!==getId())throw new Error('同步ID已改变，请关闭后重新打开知识库');
      notes=summaries.filter(r=>r.data?.kind==='summary'&&r.id===p+'-n-'+r.data.noteId&&typeof r.data.markdown==='string').map(r=>r.data).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
      const valid=reviews.filter(r=>r.data?.kind==='review'&&r.id===p+'-r-'+r.data.eventId).map(r=>r.data);
      try{write('notes',notes);write('reviews',valid);}catch(_){notify('浏览器存储已满，本次内容可阅读，但无法完整离线缓存');}
      if(active)active=notes.find(n=>n.noteId===active.noteId)||null;render();
    }catch(e){status('同步未完成：'+(e.message||String(e))+'。已缓存内容仍可阅读。',true);}
    finally{busy=false;}
  }
  let flushing=false;
  async function flush(){
    if(flushing||!navigator.onLine||!prefix)return;const client=getClient();if(!client)return;flushing=true;const p=prefix;
    try{
      for(const r of read('outbox',[])){
        if(p!==prefix||currentId!==getId())throw new Error('同步ID已改变');
        const {error}=await client.from('study_progress').upsert({id:p+'-r-'+r.eventId,data:r});if(error)throw error;
        const sent=read('reviews',[],p);if(!sent.some(x=>x.eventId===r.eventId))sent.push(r);write('reviews',sent,p);write('outbox',read('outbox',[],p).filter(x=>x.eventId!==r.eventId),p);
      }
    }finally{flushing=false;}
  }
  let saving=false;
  async function saveReview(grade,comment){
    if(saving||!active)return;if(currentId!==getId()){status('同步ID已改变，请重新打开知识库',true);return;}saving=true;
    try{
      const event={schema:1,kind:'review',eventId:crypto.randomUUID(),noteId:active.noteId,grade,comment:comment.trim().slice(0,2000),at:new Date().toISOString()};
      write('outbox',[...read('outbox',[]),event]);const drafts=read('drafts',{});delete drafts[active.noteId];write('drafts',drafts);render();
      try{await flush();render();notify('复习已记录，Mac在线时自动回传');}catch(e){status('复习已保存在本机，联网后重试上传：'+e.message,true);}
    }catch(e){status('复习未能保存：'+e.message,true);}finally{saving=false;}
  }
  async function open(){
    const id=getId();if(!id){notify('请先在学习Web设置中配置同步ID');return;}currentId=id;prefix=await namespace(id);notes=read('notes',[]);active=null;
    if(!dialog){dialog=el('dialog',undefined,'kb-dialog');dialog.setAttribute('aria-label','Obsidian知识库');document.body.append(dialog);}
    render();if(!dialog.open)dialog.showModal();refresh();
  }
  const mount=document.querySelector('#notebook-modal .notebook-modal-head-actions');
  if(mount){const b=button('知识库',open);b.className='kb-entry';b.title='来自Obsidian的学习总结与复习';mount.prepend(b);}
  window.addEventListener('online',()=>{if(prefix)flush().then(()=>{if(dialog?.open)refresh();}).catch(()=>{});});
  setInterval(()=>{if(dialog?.open&&!document.hidden)refresh();},60000);
  function getCachedNotes() { return notes.slice(); }
  async function saveToKnowledgeBase(entry) {
    const id = getId(); if (!id) return { ok: false, error: '未设置同步 ID' };
    const p = await namespace(id);
    const client = getClient(); if (!client) return { ok: false, error: '云端未就绪' };
    const noteId = 'web-' + (entry.id || crypto.randomUUID().slice(0, 8));
    const note = {
      schema: 1, kind: 'summary', noteId,
      title: entry.title || '未命名',
      markdown: entry.content || entry.text || '',
      subject: entry.subject || '待确认',
      sourceName: '学习 Web',
      source: 'web',
      updatedAt: new Date().toISOString()
    };
    const { error } = await client.from('study_progress').upsert({ id: p + '-n-' + noteId, data: note });
    if (error) return { ok: false, error: error.message };
    notes.unshift(note);
    return { ok: true };
  }
  window.StudyKnowledge={ open, getCachedNotes, saveToKnowledgeBase };
})();
