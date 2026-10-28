import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowLeft, Bold, Eye, Italic, Link2, List, ListOrdered, MessageSquareText, Quote, Redo2, Send, Underline, Undo2 } from "lucide-react";
import { blogBlockReducer, evaluateBlogReadiness, scheduleBlogAutosave } from "../../lib/blogEditorState";
import { blogMediaUrl } from "../../services/blogService";
import { Button } from "../ui/Button";
import { AlertCard } from "../ui/Card";
import { Input, Textarea } from "../ui/Input";
import { BlogBlockList } from "./BlogBlockList";
import { BlogMediaPicker } from "./BlogMediaPicker";
import { BlogLinkPicker } from "./BlogLinkPicker";
import { BlogPlacementPanel } from "./BlogPlacementPanel";
import { BlogPostSettings } from "./BlogPostSettings";
import { BlogPublishDialog } from "./BlogPublishDialog";
import { BlogReadinessPanel } from "./BlogReadinessPanel";
import { BlogSeoPanel } from "./BlogSeoPanel";
import { Modal, ModalBody } from "../ui/Modal";

export function BlogEditor({ api, postId, onBack }) {
  const [permissions, setPermissions] = useState({ can_write: false, can_publish: false });
  const [post, setPost] = useState(null); const [draft, setDraft] = useState(null); const [media, setMedia] = useState({}); const [featuredNow, setFeaturedNow] = useState(null);
  const [blocks, dispatchRaw] = useReducer(blogBlockReducer, { past: [], present: [], future: [] });
  const [saveState, setSaveState] = useState("saved"); const [dirty, setDirty] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [coverPicker, setCoverPicker] = useState(false); const [publishOpen, setPublishOpen] = useState(false); const [publishing, setPublishing] = useState(false); const [checking, setChecking] = useState(false); const [serverFailures, setServerFailures] = useState([]);
  const [linkPicker, setLinkPicker] = useState(false);
  const [staleCopy, setStaleCopy] = useState(null);
  const [focusedBlockId, setFocusedBlockId] = useState(null);
  const [publishNotice,setPublishNotice]=useState(null);
  const dirtyRef = useRef(false); const revisionRef = useRef(1); const linkRangeRef = useRef(null); const linkEditorRef = useRef(null); const savePromiseRef=useRef(null); const editSequenceRef=useRef(0);
  const dispatch = useCallback((action) => { dispatchRaw(action);editSequenceRef.current+=1;setDirty(true); dirtyRef.current = true; }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextPermissions, payload, mediaRows, featured] = await Promise.all([api.getBlogPermissions(), api.getBlogPost(postId), api.listBlogMedia(), api.getFeaturedBlogPost()]);
      if (!payload) throw new Error("Post not found");
      setPermissions(nextPermissions); setPost({ ...payload.post, author: payload.author, featured: payload.featured, link_check: payload.link_check }); setDraft(payload.draft);
      dispatchRaw({ type: "replace", blocks: payload.draft?.document?.blocks || [] });
      setMedia(Object.fromEntries((mediaRows || []).map((item) => [item.id, item]))); setFeaturedNow(featured); revisionRef.current = payload.post.revision; setDirty(false); dirtyRef.current=false; setSaveState("saved");
    } catch (next) { setError(next); }
    finally { setLoading(false); }
  }, [api, postId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const markPost = (patch) => { setPost((value)=>({...value,...patch}));editSequenceRef.current+=1;setDirty(true); dirtyRef.current=true; };
  const markDraft = (patch) => { setDraft((value)=>({...value,...patch}));editSequenceRef.current+=1;setDirty(true); dirtyRef.current=true; };
  const save = useCallback(async () => {
    if (savePromiseRef.current) return savePromiseRef.current;
    if (!dirtyRef.current || saveState === "stale" || !post || !draft) return;
    setSaveState("saving");
    const saveSequence=editSequenceRef.current;
    const operation=api.saveBlogDraft(post.id, revisionRef.current, {
      title: draft.title, summary: draft.summary, cover_media_id: draft.cover_media_id, cover_alt: draft.cover_alt,
      seo_title: draft.seo_title, seo_description: draft.seo_description, social_title: draft.social_title, social_description: draft.social_description,
      document: { version: 1, blocks: blocks.present }, slug: post.slug, category_slug: post.category_slug, topics: post.topics || [],
      show_in_more_stories: post.show_in_more_stories, hide_passed_event_cards: post.hide_passed_event_cards,
      take_down_mode: post.take_down_mode || "never", take_down_at: post.take_down_at, take_down_event_id: post.take_down_event_id,
    });
    savePromiseRef.current=operation;
    try {
      const saved = await operation;
      revisionRef.current=saved.revision; setPost((value)=>({...value,revision:saved.revision,draft_version_id:saved.draft_version_id})); const unchanged=editSequenceRef.current===saveSequence;dirtyRef.current=!unchanged;setDirty(!unchanged);setSaveState("saved");
    } catch (next) { if(next.code==="stale")setSaveState("stale");else setSaveState("error"); setError(next); throw next; }
    finally { savePromiseRef.current=null; }
  }, [api, blocks.present, draft, post, saveState]);
  useEffect(() => { if (!dirty || saveState==="stale") return; return scheduleBlogAutosave(()=>void save().catch(()=>{})); }, [dirty, save, saveState]);
  useEffect(() => { const handler=(event)=>{if(dirtyRef.current){event.preventDefault();event.returnValue="";}}; window.addEventListener("beforeunload",handler);return()=>window.removeEventListener("beforeunload",handler);},[]);

  const checks = useMemo(()=>post&&draft?evaluateBlogReadiness({post,draft:{...draft,document:{version:1,blocks:blocks.present}},media,linkCheck:post.link_check}):[],[post,draft,blocks.present,media]);
  async function checkLinks() { await save(); setChecking(true); try { const receipt=await api.checkBlogLinks(post.id); setPost((value)=>({...value,link_check:receipt})); } catch(next){setError(next);} finally{setChecking(false);} }
  async function preview() { await save(); const result=await api.createBlogPreviewToken(post.id); const origin=import.meta.env.VITE_MARKETING_ORIGIN||"https://usemingla.com"; window.open(`${origin.replace(/\/$/,"")}/blog/preview/${result.token}`,"_blank","noopener,noreferrer"); }
  async function submit() { if(!window.confirm("Send to a Support lead to publish?"))return;await save(); const result=await api.submitBlogPostForReview(post.id,revisionRef.current); revisionRef.current=result.revision;setPost((value)=>({...value,status:"in_review",revision:result.revision})); }
  async function requestChanges() { const note=window.prompt("What should the writer change?"); if(!note?.trim())return; const result=await api.requestBlogPostChanges(post.id,revisionRef.current,note);revisionRef.current=result.revision;setPost((value)=>({...value,status:"draft",review_note:note,revision:result.revision})); }
  async function publish(publishAt, featured) { setPublishing(true);setServerFailures([]);try{await save();const result=await api.publishBlogPost(post.id,revisionRef.current,publishAt,featured);revisionRef.current=result.post.revision;await api.revalidateBlog().catch(()=>null);setPublishOpen(false);setPublishNotice({scheduled:new Date(publishAt)>new Date(Date.now()+60000),publishAt,slug:post.slug});await load();}catch(next){setServerFailures(next.failedChecks||[]);setError(next);}finally{setPublishing(false);} }
  async function changeFeatured(featured) { if (!post.first_published_at || post.status !== "published") { markPost({featured}); return; } try { await api.setFeaturedBlogPost(featured ? post.id : null); await api.revalidateBlog().catch(()=>null); await load(); } catch (next) { setError(next); } }
  async function unpublish(){if(!window.confirm("Unpublish this post?"))return;const result=await api.unpublishBlogPost(post.id,revisionRef.current);revisionRef.current=result.revision;await api.revalidateBlog().catch(()=>null);await load();}
  async function remove(){if(!window.confirm("Delete this never-published draft?"))return;await api.deleteBlogPost(post.id);onBack();}
  async function reloadAfterStale(){setStaleCopy(JSON.stringify({title:draft.title,summary:draft.summary,document:{version:1,blocks:blocks.present}},null,2));await load();}
  async function copyUnsaved(){const text=staleCopy||JSON.stringify({title:draft.title,summary:draft.summary,document:{version:1,blocks:blocks.present}},null,2);await navigator.clipboard.writeText(text);}
  function openLinkPicker() { const selection=window.getSelection(); const range=selection?.rangeCount?selection.getRangeAt(0):null; linkRangeRef.current=range?.cloneRange()||null; const node=range?.commonAncestorContainer; linkEditorRef.current=(node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement)?.closest?.("[contenteditable]")||null; setLinkPicker(true); }
  function applyLink(target) { const selection=window.getSelection(); if(linkRangeRef.current&&selection){selection.removeAllRanges();selection.addRange(linkRangeRef.current);} const href=target.kind==="page"?target.path:target.kind==="url"?target.href:null; if(href){document.execCommand("createLink",false,href);if(target.kind==="url"&&target.newTab){const node=selection?.anchorNode?.nodeType===Node.ELEMENT_NODE?selection.anchorNode:selection?.anchorNode?.parentElement;const anchor=node?.closest?.("a");anchor?.setAttribute("target","_blank");anchor?.setAttribute("rel","noopener noreferrer");}}else{const label=selection?.toString()||"Open in Mingla";const safeLabel=label.replace(/[&<>"']/g,(value)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[value]);document.execCommand("insertHTML",false,`<a data-mingla-target="${target.kind}:${target.placeId||target.eventId}">${safeLabel}</a>`);} linkEditorRef.current?.dispatchEvent(new InputEvent("input",{bubbles:true})); setLinkPicker(false); }

  if (loading) return <div className="h-72 animate-pulse rounded-xl bg-[var(--gray-100)]" />;
  if (error?.code==="blog_not_ready") return <AlertCard title="The blog isn't switched on yet." />;
  if (!post || !draft) return <AlertCard variant="error" title="Post didn't load." action={<Button onClick={load}>Retry</Button>}>{error?.message}</AlertCard>;
  const statusCopy=saveState==="saving"?"Saving…":saveState==="error"?"Couldn't save. Retry":saveState==="stale"?"Someone else changed this post. Reload":`Saved${dirty?" · waiting":""}`;
  return <div className="space-y-4" data-blog-view="editor" onBlur={()=>{if(dirtyRef.current)void save().catch(()=>{});}}>
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--gray-200)] bg-white/95 p-3 shadow-sm backdrop-blur"><div className="flex items-center gap-3"><Button variant="ghost" icon={ArrowLeft} onClick={onBack}>Posts</Button><span className={`text-sm ${saveState==="stale"||saveState==="error"?"text-red-700":"text-[var(--color-text-secondary)]"}`}>{post.status.replace("_"," ")} · {statusCopy}</span>{saveState==="stale"?<Button size="sm" variant="secondary" onClick={reloadAfterStale}>Reload</Button>:null}</div><div className="flex flex-wrap gap-2"><Button variant="secondary" icon={Eye} onClick={preview}>Preview</Button>{post.status==="draft"?<Button variant="secondary" icon={Send} onClick={submit}>Send for review</Button>:null}{permissions.can_publish&&post.status==="in_review"?<Button variant="link" onClick={requestChanges}>Request changes</Button>:null}{permissions.can_publish?<Button onClick={()=>{setPublishOpen(true);void checkLinks();}}>Publish…</Button>:null}</div></div>
    {publishNotice?<AlertCard title={publishNotice.scheduled?`Scheduled for ${new Date(publishNotice.publishAt).toLocaleString()}`:"Published. It's live."} action={<a className="text-sm font-semibold text-[var(--color-brand-700)] underline" href={`https://usemingla.com/blog/${publishNotice.slug}`} target="_blank" rel="noreferrer">Open</a>}>usemingla.com/blog/{publishNotice.slug}</AlertCard>:null}
    {post.review_note?<AlertCard variant="warning" title="Changes requested">{post.review_note}</AlertCard>:null}
    {saveState==="stale"||staleCopy?<AlertCard variant="error" title="Your unsaved version is still here." action={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={()=>void copyUnsaved()}>Copy my text</Button>{staleCopy?<Button size="sm" variant="ghost" onClick={()=>setStaleCopy(null)}>Dismiss</Button>:null}</div>}>Reload the server copy before editing again. Your local title, summary and blocks remain available here to copy.</AlertCard>:null}
    <div className="grid gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_360px]">
      <main className="min-w-0 rounded-2xl border border-[var(--gray-200)] bg-white p-5 shadow-sm sm:p-8">
        <div className="mb-5">{draft.cover_media_id&&media[draft.cover_media_id]?<button type="button" onClick={()=>setCoverPicker(true)} className="group relative block w-full overflow-hidden rounded-xl"><img src={blogMediaUrl(media[draft.cover_media_id].storage_path)} alt={draft.cover_alt} className="aspect-[21/9] w-full object-cover" /><span className="absolute inset-0 grid place-items-center bg-black/0 text-sm font-semibold text-transparent transition group-hover:bg-black/30 group-hover:text-white">Replace cover</span></button>:<button type="button" onClick={()=>setCoverPicker(true)} className="grid aspect-[21/9] w-full place-items-center rounded-xl border-2 border-dashed border-[var(--gray-300)] text-sm font-semibold text-[var(--color-text-secondary)]">Add a cover photo</button>}</div>
        <Input label="Cover alt text" value={draft.cover_alt||""} error={draft.cover_media_id&&!draft.cover_alt?.trim()?"Alt text is required":null} onChange={(e)=>markDraft({cover_alt:e.target.value})} />
        {draft.cover_media_id&&media[draft.cover_media_id]?<p className="mt-1 text-xs text-[var(--color-text-tertiary)]">Source: {media[draft.cover_media_id].source.replaceAll("_"," ")} · {media[draft.cover_media_id].source_ref}</p>:null}
        <textarea aria-label="Post title" value={draft.title} maxLength={140} onChange={(e)=>markDraft({title:e.target.value})} className="mt-8 min-h-24 w-full resize-none border-0 bg-transparent text-4xl font-black leading-tight outline-none" />
        <Textarea label="Summary" value={draft.summary||""} maxLength={300} className="min-h-20 font-sans text-base" onChange={(e)=>markDraft({summary:e.target.value})} />
        <div className="sticky top-20 z-[5] my-5 flex flex-wrap items-center gap-1 rounded-xl border border-[var(--gray-200)] bg-white p-2 shadow-sm"><Tool icon={Undo2} label="Undo" onClick={()=>dispatchRaw({type:"undo"})}/><Tool icon={Redo2} label="Redo" onClick={()=>dispatchRaw({type:"redo"})}/><select aria-label="Text block style" value="" disabled={!focusedBlockId} onChange={(event)=>{if(event.target.value)dispatch({type:"convert",blockId:focusedBlockId,target:event.target.value});event.target.value="";}} className="h-11 rounded-lg border border-[var(--gray-200)] bg-white px-2 text-sm disabled:opacity-40"><option value="">Paragraph ▾</option><option value="paragraph">Paragraph</option><option value="heading-2">H2</option><option value="heading-3">H3</option></select><Tool icon={Bold} label="Bold" onClick={()=>document.execCommand("bold")}/><Tool icon={Italic} label="Italic" onClick={()=>document.execCommand("italic")}/><Tool icon={Underline} label="Underline" onClick={()=>document.execCommand("underline")}/><Tool icon={Link2} label="Link" onClick={openLinkPicker}/><Tool icon={List} label="Bulleted list" disabled={!focusedBlockId} onClick={()=>dispatch({type:"convert",blockId:focusedBlockId,target:"bullet-list"})}/><Tool icon={ListOrdered} label="Numbered list" disabled={!focusedBlockId} onClick={()=>dispatch({type:"convert",blockId:focusedBlockId,target:"numbered-list"})}/><Tool icon={Quote} label="Quote" disabled={!focusedBlockId} onClick={()=>dispatch({type:"convert",blockId:focusedBlockId,target:"quote"})}/><Tool icon={MessageSquareText} label="Callout" disabled={!focusedBlockId} onClick={()=>dispatch({type:"convert",blockId:focusedBlockId,target:"callout"})}/></div>
        <BlogBlockList api={api} blocks={blocks.present} dispatch={dispatch} onFocusBlock={setFocusedBlockId} />
      </main>
      <aside className="space-y-5 rounded-2xl border border-[var(--gray-200)] bg-white p-5 shadow-sm"><BlogPostSettings post={post} draft={draft} onChange={(patch)=>markPost(patch)} /><BlogPlacementPanel post={post} blocks={blocks.present} featuredNow={featuredNow} canPublish={permissions.can_publish} onChange={(patch)=>markPost(patch)} onFeaturedChange={changeFeatured} /><BlogSeoPanel post={post} draft={draft} media={media} onChange={markDraft} /><BlogReadinessPanel checks={checks} linkCheck={post.link_check} onCheckLinks={checkLinks} checking={checking} />{permissions.can_publish?<div className="space-y-2 border-t border-[var(--gray-200)] pt-5">{post.first_published_at?<Button variant="secondary" className="w-full" onClick={unpublish}>Unpublish</Button>:<Button variant="danger" className="w-full" onClick={remove}>Delete draft</Button>}</div>:null}</aside>
    </div>
    <BlogMediaPicker open={coverPicker} onClose={()=>setCoverPicker(false)} api={api} onPick={(item)=>{setMedia((value)=>({...value,[item.id]:item}));markDraft({cover_media_id:item.id,cover_alt:draft.cover_alt||item.alt});}} />
    <Modal open={linkPicker} onClose={()=>setLinkPicker(false)} title="Add a link" size="md"><ModalBody><BlogLinkPicker api={api} onPick={applyLink} /></ModalBody></Modal>
    {publishOpen?<BlogPublishDialog open onClose={()=>setPublishOpen(false)} checks={checks} featured={post.featured} initialPublishAt={post.publish_at} featuredNow={featuredNow} onPublish={publish} busy={publishing} serverFailures={serverFailures} />:null}
  </div>;
}

function Tool({icon:Icon,label,onClick,disabled=false}) { void Icon; return <button type="button" aria-label={label} title={label} disabled={disabled} onMouseDown={(event)=>event.preventDefault()} onClick={onClick} className="grid h-11 min-w-9 place-items-center rounded-lg px-2 hover:bg-[var(--gray-100)] disabled:opacity-40"><Icon className="h-4 w-4" /></button>; }
