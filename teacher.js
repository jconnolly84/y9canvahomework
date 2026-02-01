/*
  Teacher dashboard for Year 9 Canva video advert submissions.

  Features:
  - Email/password sign-in
  - Live list of submissions (Firestore)
  - Filters: class + marked/unmarked
  - Preview Canva link (iframe) + open in new tab
  - Save mark + feedback back into the submission doc
  - Export CSV
*/

const COLLECTION = "y9_canva_submissions";

function $(id){ return document.getElementById(id); }
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function setStatus(msg){ const el=$("status"); if(el) el.textContent = msg||""; }
function show(el,on=true){ if(!el) return; el.classList.toggle("hidden", !on); }

function getAuth(){ return window.auth; }
function getDb(){ return window.db; }
function getAuthHelpers(){ return window._authHelpers; }

function waitForFirebase(maxMs = 8000, intervalMs = 100){
  return new Promise((resolve, reject)=>{
    const start = Date.now();
    const t = setInterval(()=>{
      const ready = !!(window.auth && window.db && window._authHelpers);
      if (ready){
        clearInterval(t);
        resolve(true);
      } else if (Date.now() - start > maxMs){
        clearInterval(t);
        reject(new Error("Firebase init timeout"));
      }
    }, intervalMs);
  });
}


let _unsub = null;
let _cached = [];


async function deleteSubmission(id){
  if(!confirm("Delete this submission?")) return;

  const db = getDb();
  if (!db) return setStatus("Firestore not initialised.");

  const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  try{
    await deleteDoc(doc(db, COLLECTION, id));
    setStatus("Deleted.");
  }catch(err){
    setStatus(err?.message || "Could not delete (check Firestore rules).");
  }
}


function normaliseForPreview(url){
  const s = String(url || "").trim();
  if (!s) return "about:blank";

  // Try to produce a Canva-friendly embed URL.
  try{
    const u = new URL(s);

    if (u.hostname.includes("canva.com") && u.pathname.includes("/design/")){
      // Convert common paths to /view where possible
      u.pathname = u.pathname.replace(/\/(edit|present)\/?$/,"/view");

      // Add embed param for iframe previews (Canva's iframe code uses ?embed)
      if (!u.searchParams.has("embed")) u.searchParams.set("embed","");

      return u.toString();
    }
  }catch(_){}

  return s;
}

function openPreview(url, metaText){
  const modal = $("previewModal");
  const frame = $("previewFrame");
  const open = $("openNewTab");
  const meta = $("previewMeta");

  const u = normaliseForPreview(url);
  if (frame) frame.src = u;
  if (open) open.href = u;
  if (meta) meta.textContent = metaText || "";

  show(modal, true);

  // Focus for accessibility
  $("closePreview")?.focus?.();
}

function closePreview(){
  const modal = $("previewModal");
  const frame = $("previewFrame");
  if (frame) frame.src = "about:blank";
  show(modal, false);
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

async function initAuth(){
  const auth = getAuth();
  const h = getAuthHelpers();
  if (!auth || !h) {
    setStatus("Firebase not initialised yet. Check your config in teacher.html.");
    return;
  }

  h.onAuthStateChanged(auth, (user)=>{
    show($("authBox"), !user);
    show($("signedInBox"), !!user);
    if (user) {
      $("whoami").textContent = user.email || "Signed in";
      startListening();
    } else {
      stopListening();
      $("submissions").innerHTML = "";
    }
  });

  $("btnLogin")?.addEventListener("click", async ()=>{
    setStatus("");
    const email = $("email").value.trim();
    const password = $("password").value;
    if (!email || !password) return setStatus("Enter email and password.");

    try{
      await h.signInWithEmailAndPassword(auth, email, password);
      setStatus("Signed in.");
    }catch(err){
      setStatus(err?.message || "Sign in failed.");
    }
  });

  $("btnReset")?.addEventListener("click", async ()=>{
    setStatus("");
    const email = $("email").value.trim();
    if (!email) return setStatus("Enter your email first.");

    try{
      await h.sendPasswordResetEmail(auth, email);
      setStatus("Password reset email sent.");
    }catch(err){
      setStatus(err?.message || "Could not send reset email.");
    }
  });

  $("btnLogout")?.addEventListener("click", async ()=>{
    setStatus("");
    try{
      await h.signOut(auth);
      setStatus("Signed out.");
    }catch(err){
      setStatus(err?.message || "Could not sign out.");
    }
  });

  $("closePreview")?.addEventListener("click", closePreview);

  // Close when clicking the backdrop
  $("previewModal")?.addEventListener("click", (e)=>{
    const t = e.target;
    if (t && t.dataset && t.dataset.close === "true") closePreview();
  });

  // Close on Escape
  document.addEventListener("keydown", (e)=>{
    if (e.key === "Escape") closePreview();
  });


  $("btnRefresh")?.addEventListener("click", ()=>{
    render(_cached);
  });

  $("filterClass")?.addEventListener("change", ()=>render(_cached));
  $("filterMarked")?.addEventListener("change", ()=>render(_cached));

  $("btnExportCsv")?.addEventListener("click", ()=>exportCsv(_cached));
}

function stopListening(){
  if (_unsub) { _unsub(); _unsub = null; }
}

async function startListening(){
  stopListening();

  const db = getDb();
  if (!db) return setStatus("Firestore not initialised.");

  const { collection, query, orderBy, onSnapshot } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const q = query(collection(db, COLLECTION), orderBy("createdAt", "desc"));

  _unsub = onSnapshot(q, (snap)=>{
    const rows = [];
    snap.forEach(doc=>{
      rows.push({ id: doc.id, ...doc.data() });
    });
    _cached = rows;
    render(rows);
  }, (err)=>{
    setStatus(err?.message || "Could not load submissions (check Firestore rules).");
  });
}

function filterRows(rows){
  const cls = $("filterClass")?.value || "";
  const markedFilter = $("filterMarked")?.value || "";

  return rows.filter(r=>{
    if (cls && r.studentClass !== cls) return false;
    const isMarked = (r.mark && typeof r.mark.score === "number");
    if (markedFilter === "marked" && !isMarked) return false;
    if (markedFilter === "unmarked" && isMarked) return false;
    return true;
  });
}

function fmtTimestamp(ts){
  // Firestore Timestamp -> Date
  try{
    if (!ts) return "";
    if (typeof ts.toDate === "function") return ts.toDate().toLocaleString("en-GB");
    return "";
  }catch(_){ return ""; }
}

function categoryLabel(v){
  return v === "food" ? "Food chain" : v === "soft_drink" ? "Soft drink" : v === "trainers" ? "Trainers" : (v || "");
}

function render(rows){
  const root = $("submissions");
  if (!root) return;

  const filtered = filterRows(rows);

  if (!filtered.length){
    root.innerHTML = '<p class="muted">No submissions match your filters.</p>';
    return;
  }

  root.innerHTML = filtered.map(r=>{
    const marked = (r.mark && typeof r.mark.score === "number");
    const badge = marked ? '<span class="badge badge--ok">Marked</span>' : '<span class="badge badge--warn">Unmarked</span>';

    const score = marked ? String(r.mark.score) : "";
    const fb = marked ? (r.mark.feedback || "") : "";

    const safeName = escapeHtml(r.studentName || "");
    const safeClass = escapeHtml(r.studentClass || "");
    const safeBrand = escapeHtml(r.brand || "");
    const safeEmail = escapeHtml(r.studentEmail || "");
    const safeNotes = escapeHtml(r.notes || "");
    const safeUrl = escapeHtml(r.canvaUrl || "");

    return `
      <div class="submission" data-id="${escapeHtml(r.id)}">
        <div class="submission__head">
          <div>
            <h3 style="margin:0 0 6px 0;">${safeName} <span class="muted">(${safeClass})</span></h3>
            <div class="muted small">
              <strong>${escapeHtml(categoryLabel(r.category))}</strong> — ${safeBrand}
              ${safeEmail ? ` • ${safeEmail}` : ""}
              ${r.createdAt ? ` • ${escapeHtml(fmtTimestamp(r.createdAt))}` : ""}
            </div>
          </div>
          <div>${badge}</div>
        </div>

        <div class="submission__grid">
          <div>
            <div class="muted small"><strong>Canva link</strong></div>
            <div class="small" style="word-break:break-all;">${safeUrl || "<span class='muted'>No link</span>"}</div>
            <div class="submission__actions">
              <button class="btn btn--secondary" data-action="preview">Preview</button>
              <a class="btn btn--secondary" href="${safeUrl}" target="_blank" rel="noopener">Open</a>
              <button class="btn btn--danger btn--sm" data-action="delete" type="button">Delete</button>
            </div>
          </div>

          <div>
            <div class="muted small"><strong>Student notes</strong></div>
            <div class="small">${safeNotes || "<span class='muted'>—</span>"}</div>
          </div>
        </div>

        <hr style="border:none;border-top:1px solid var(--line);margin:12px 0;">

        <div class="submission__grid">
          <div>
            <label class="label" for="score-${escapeHtml(r.id)}">Mark /20</label>
            <input class="input" id="score-${escapeHtml(r.id)}" type="number" min="0" max="20" step="1" value="${escapeHtml(score)}" placeholder="0–20" />
          </div>
          <div>
            <label class="label" for="fb-${escapeHtml(r.id)}">Feedback</label>
            <textarea class="textarea" id="fb-${escapeHtml(r.id)}" rows="3" placeholder="WWW / EBI / next step…">${escapeHtml(fb)}</textarea>
          </div>
        </div>

        <div class="submission__actions">
          <button class="btn btn--primary" data-action="save">Save mark</button>
          <button class="btn" data-action="copy">Copy student summary</button>
        </div>
      </div>
    `;
  }).join("");

  // Wire actions
  root.querySelectorAll("[data-action]").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      const action = btn.getAttribute("data-action");
      const card = btn.closest(".submission");
      const id = card?.getAttribute("data-id");
      if (!id) return;

      const row = _cached.find(x=>x.id===id);
      if (!row) return;

      if (action === "preview"){
        openPreview(row.canvaUrl || "", `${row.studentName || ""} (${row.studentClass || ""}) — ${row.brand || ""}`);
      } else if (action === "delete"){
        deleteSubmission(id);
      } else if (action === "save"){
        saveMark(id);
      } else if (action === "copy"){
        copySummary(row);
      }
    });
  });
}

async function saveMark(id){
  setStatus("");
  const scoreEl = $(`score-${id}`);
  const fbEl = $(`fb-${id}`);
  const score = Number(scoreEl?.value);

  if (!Number.isFinite(score) || score < 0 || score > 20){
    return setStatus("Score must be a number from 0 to 20.");
  }

  const feedback = (fbEl?.value || "").trim();

  const db = getDb();
  if (!db) return setStatus("Firestore not initialised.");

  const auth = getAuth();
  const user = auth?.currentUser;

  const { doc, updateDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  try{
    await updateDoc(doc(db, COLLECTION, id), {
      mark: {
        score,
        feedback,
        markedBy: user?.email || "",
        markedAt: serverTimestamp()
      }
    });
    setStatus("Saved.");
  }catch(err){
    setStatus(err?.message || "Could not save mark (check Firestore rules).");
  }
}

async function copySummary(row){
  const lines = [
    `Name: ${row.studentName || ""}`,
    `Class: ${row.studentClass || ""}`,
    `Category: ${categoryLabel(row.category)}`,
    `Brand/Product: ${row.brand || ""}`,
    `Canva: ${row.canvaUrl || ""}`,
    row.mark?.score !== undefined ? `Mark: ${row.mark.score}/20` : "Mark: (not marked yet)",
    row.mark?.feedback ? `Feedback: ${row.mark.feedback}` : ""
  ].filter(Boolean);

  try{
    await navigator.clipboard.writeText(lines.join("\n"));
    setStatus("Copied to clipboard.");
  }catch(_){
    setStatus("Could not copy (browser blocked clipboard).");
  }
}

function exportCsv(rows){
  const filtered = filterRows(rows);

  const headers = [
    "id","studentName","studentClass","studentEmail","category","brand","canvaUrl","notes",
    "createdAt","markScore","markFeedback","markedBy","markedAt"
  ];

  const csvRows = [headers.join(",")];

  filtered.forEach(r=>{
    const vals = [
      r.id,
      r.studentName || "",
      r.studentClass || "",
      r.studentEmail || "",
      r.category || "",
      r.brand || "",
      r.canvaUrl || "",
      (r.notes || "").replace(/\s+/g," ").trim(),
      fmtTimestamp(r.createdAt),
      (r.mark && typeof r.mark.score === "number") ? String(r.mark.score) : "",
      (r.mark?.feedback || "").replace(/\s+/g," ").trim(),
      r.mark?.markedBy || "",
      fmtTimestamp(r.mark?.markedAt)
    ].map(v => `"${String(v).replace(/"/g,'""')}"`);
    csvRows.push(vals.join(","));
  });

  const blob = new Blob([csvRows.join("\n")], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "y9_canva_submissions.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

(function main(){
  initNav();
  waitForFirebase().then(()=>{
    initAuth();
  }).catch(()=>{
    setStatus("Firebase not initialised yet. Refresh and try again (or check teacher.html config).");
  });
})();
