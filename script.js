/* 
  Year 9 Homework: Canva Video Advert (20–30 seconds)

  Student workflow:
  - Create advert in Canva Video Editor
  - Make sure your share link is set to "Anyone with the link can view"
  - Submit: name, class, category, brand, Canva view link

  Storage:
  - Writes to Firestore collection: y9_video_submissions (if Firebase is configured)
  - Also saves a local copy (localStorage) as a backup for the student/device
*/

const COLLECTION = "y9_canva_submissions";
const CLASSES = ["9A1","9A2","9A3","9B1","9B2","9B3","9B4"];

function $(id){ return document.getElementById(id); }

function setStatus(msg){
  const el = $("status");
  if (el) el.textContent = msg || "";
}

function show(el, on=true){
  if (!el) return;
  el.classList.toggle("hidden", !on);
}

function normaliseCanvaLink(raw){
  const s = String(raw || "").trim();
  if (!s) return { ok:false, reason:"Paste your Canva share link." };

  if (!/^https?:\/\//i.test(s)) return { ok:false, reason:"Your link must start with http(s)://"};
  if (!s.includes("canva.com/")) return { ok:false, reason:"That doesn't look like a Canva link." };

  // We prefer /view or /watch links, but we won't over-enforce.
  const looksOk = /\/watch(\?|$)/.test(s) || /\/view(\?|$)/.test(s) || /\/present(\?|$)/.test(s);
  return { ok:true, url:s, hint: looksOk ? "" : "Tip: if your teacher can't open it, re-share as a Canva 'view' link with permissions set to Anyone with link can view." };
}

function loadDraft(){
  try{
    const s = localStorage.getItem("y9_video_draft");
    if (!s) return;
    const d = JSON.parse(s);
    if (d.studentName) $("studentName").value = d.studentName;
    if (d.studentClass) $("studentClass").value = d.studentClass;
    if (d.category) $("category").value = d.category;
    if (d.brand) $("brand").value = d.brand;
    if (d.canvaLink) $("canvaLink").value = d.canvaLink;
    if (d.notes) $("notes").value = d.notes;
  }catch(_){}
}

function saveDraft(){
  try{
    const d = {
      studentName: $("studentName")?.value || "",
      studentClass: $("studentClass")?.value || "",
      category: $("category")?.value || "",
      brand: $("brand")?.value || "",
      canvaLink: $("canvaLink")?.value || "",
      notes: $("notes")?.value || ""
    };
    localStorage.setItem("y9_video_draft", JSON.stringify(d));
  }catch(_){}
}

function wireDraftAutosave(){
  ["studentName","studentClass","category","brand","canvaLink","notes"].forEach(id=>{
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", saveDraft);
    el.addEventListener("change", saveDraft);
  });
}

function normaliseForPreview(url){
  const s = String(url || "").trim();
  if (!s) return "about:blank";

  // Try to convert Canva /edit links into /view and add ?embed for iframes.
  try{
    const u = new URL(s);
    if (u.hostname.includes("canva.com") && u.pathname.includes("/design/")){
      u.pathname = u.pathname.replace(/\/(edit|present)\/?$/,"/view");
      if (!u.pathname.endsWith("/view") && !u.pathname.endsWith("/watch")){
        // Leave as-is if unknown path, but still attempt embed
      }
      // Add embed param (Canva's iframe code uses ?embed)
      if (!u.searchParams.has("embed")) u.searchParams.set("embed","");
      return u.toString();
    }
  }catch(_){}
  return s;
}

function openPreview(url){
  const box = $("previewBox");
  const frame = $("previewFrame");
  const open = $("openNewTab");
  const u = normaliseForPreview(url);

  if (frame) frame.src = u;
  if (open) open.href = u;
  show(box, true);
  box?.scrollIntoView({behavior:"smooth", block:"start"});
}

function closePreview(){
  const box = $("previewBox");
  const frame = $("previewFrame");
  if (frame) frame.src = "about:blank";
  show(box, false);
}

async function writeSubmission(payload){
  const db = window.db;
  if (!db) throw new Error("Firebase/Firestore not initialised. Check Firebase config in index.html.");

  const { collection, addDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const ref = await addDoc(collection(db, COLLECTION), {
    ...payload,
    createdAt: serverTimestamp()
  });
  return ref.id;
}

function saveLocalBackup(payload, id){
  try{
    const key = "y9_video_submissions_local";
    const existing = JSON.parse(localStorage.getItem(key) || "[]");
    existing.unshift({ id, ...payload, createdAt: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(existing.slice(0, 50)));
  }catch(_){}
}

function initPreview(){
  $("btnPreview")?.addEventListener("click", ()=>{
    const canva = normaliseCanvaLink($("canvaLink").value);
    if (!canva.ok) return setStatus(canva.reason);
    setStatus(canva.hint || "");
    openPreview(canva.url);
  });

  $("closePreview")?.addEventListener("click", closePreview);
}

function initSubmit(){
  const form = $("submitForm");
  if (!form) return;

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    setStatus("");

    const studentName = $("studentName").value.trim();
    const studentClass = $("studentClass").value;
    const category = $("category").value;
    const brand = $("brand").value.trim();
    const canva = normaliseCanvaLink($("canvaLink").value);
    const notes = $("notes").value.trim();

    if (!studentName) return setStatus("Enter your name.");
    if (!CLASSES.includes(studentClass)) return setStatus("Select your class.");
    if (!category) return setStatus("Select an advert category.");
    if (!brand) return setStatus("Enter a brand/product name.");
    if (!canva.ok) return setStatus(canva.reason);

    const payload = {
      studentName,
      studentClass,
      category,
      brand,
      canvaUrl: canva.url,
      notes
    };

    try{
      const id = await writeSubmission(payload);
      saveLocalBackup(payload, id);
      localStorage.removeItem("y9_video_draft");
      setStatus(`Submitted! Reference: ${id}`);
      form.reset();
      closePreview();
    }catch(err){
      // Still save locally so the student can prove submission, even if Firebase is misconfigured.
      const localId = "local_" + Math.random().toString(16).slice(2, 10);
      saveLocalBackup(payload, localId);
      setStatus((err?.message || "Submission failed.") + " (Saved on this device as a backup.)");
    }
  });
}

function initNav(){
  const hamburger = $("hamburger");
  const nav = $("nav");
  if (!hamburger || !nav) return;

  hamburger.addEventListener("click", ()=>{
    const open = nav.classList.toggle("nav--open");
    hamburger.setAttribute("aria-expanded", open ? "true" : "false");
  });

  nav.querySelectorAll("a").forEach(a=>{
    a.addEventListener("click", ()=> nav.classList.remove("nav--open"));
  });
}

(function main(){
  initNav();
  loadDraft();
  wireDraftAutosave();
  initPreview();
  initSubmit();
})();
