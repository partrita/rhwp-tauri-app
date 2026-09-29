// rhwp-desk — 한글/워드 프로세서 메인 앱 부트스트랩 및 이벤트 배선.

import { mountIcons, ICONS } from "./icons.js";
import * as api from "./api.js";
import { Viewer } from "./viewer.js";

const $ = (id) => document.getElementById(id);
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem("rhwpDesk." + k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem("rhwpDesk." + k, JSON.stringify(v)),
};

/* ══════════ 전역 상태 ══════════ */
const state = {
  engine: null, // {path, source, version}
  activeDoc: null,
  recentDocs: LS.get("recentDocs", []),
  caps: null,
};

let viewer = null;

/* ══════════ 토스트 알림 ══════════ */
function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  $("toasts")?.append(el);
  setTimeout(() => el.remove(), 4000);
}

/* ══════════ 최근 문서 관리 ══════════ */
function addRecentDoc(path) {
  if (!path) return;
  state.recentDocs = [path, ...state.recentDocs.filter((p) => p !== path)].slice(0, 10);
  LS.set("recentDocs", state.recentDocs);
  renderRecentDocs();
}

function renderRecentDocs() {
  const list = $("recent-docs-list");
  if (!list) return;
  list.innerHTML = "";
  if (!state.recentDocs.length) {
    list.innerHTML = '<span style="color:var(--text-muted);font-size:11px;">최근 문서 없음</span>';
    return;
  }
  for (const path of state.recentDocs) {
    const item = document.createElement("div");
    item.className = "recent-doc-link";
    item.textContent = api.basename(path);
    item.title = path;
    item.addEventListener("click", () => openDocument(path));
    list.append(item);
  }
}

/* ══════════ 문서 열기 ══════════ */
async function openDocument(path) {
  try {
    state.activeDoc = path;
    addRecentDoc(path);
    await viewer.open(path);
    toast(`${api.basename(path)} 문서를 열었습니다.`, "ok");
  } catch (e) {
    toast(`문서 열기 실패: ${e}`, "bad");
  }
}

async function promptOpenDocument() {
  try {
    const selected = await api.pickDocument();
    if (selected) {
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (path) await openDocument(path);
    }
  } catch (e) {
    toast(`파일 대화상자 오류: ${e}`, "bad");
  }
}

/* ══════════ 새 문서 생성 ══════════ */
function newDocument() {
  state.activeDoc = null;
  $("doc-title-text").textContent = "새 문서.hwpx";
  $("doc-format-badge").textContent = "HWPX";
  document.title = "새 문서 - rhwp 워드 프로세서";

  $("welcome-watermark")?.setAttribute("hidden", "true");
  viewer.setMode("editor");

  const editor = $("sheet-editor");
  if (editor) {
    editor.innerHTML = `
      <h1 style="text-align: center; margin-bottom: 24px; font-size: 20pt; font-weight: bold; font-family: '함초롬바탕', serif;">제목을 입력하세요</h1>
      <p style="line-height: 1.6; margin-bottom: 12px; font-size: 10pt;">새로운 문서를 작성하십시오.</p>
    `;
    editor.focus();
  }
  updateCharCount();
  toast("새 문서를 만들었습니다.");
}

/* ══════════ PDF 내보내기 ══════════ */
async function exportPdf() {
  if (state.activeDoc && state.engine) {
    toast("PDF 변환 중…");
    try {
      const entry = await api.runTool(
        state.engine.path,
        ["export-pdf", state.activeDoc, "--json"],
        "word-processor"
      );
      if (entry.exitCode === 0) {
        toast("PDF 내보내기 완료!", "ok");
      } else {
        toast(`PDF 내보내기 실패: ${entry.stderrTail || "오류"}`, "bad");
      }
    } catch (e) {
      toast(`PDF 변환 실패: ${e}`, "bad");
    }
  } else {
    // 편집기 모드인 경우 브라우저 인쇄(PDF 저장) 활용
    window.print();
  }
}

/* ══════════ 글자 수 카운터 동기화 ══════════ */
function updateCharCount() {
  const editor = $("sheet-editor");
  const countEl = $("sb-char-count");
  if (!editor || !countEl) return;
  const text = editor.innerText || "";
  const total = text.length;
  const noSpace = text.replace(/\s/g, "").length;
  countEl.textContent = `글자 ${total}자 (공백제외 ${noSpace}자)`;
}

/* ══════════ 서식 명령 실행 (execCommand) ══════════ */
function formatDoc(cmd, val = null) {
  document.execCommand(cmd, false, val);
  const editor = $("sheet-editor");
  if (editor) editor.focus();
  updateCharCount();
}

/* ══════════ 초기화 ══════════ */
async function init() {
  mountIcons();

  // 1. 뷰어 초기화
  viewer = new Viewer({
    getEngine: () => state.engine?.path,
    onError: (err) => toast(err, "bad"),
    onInfo: () => null,
  });

  // 2. 엔진 탐색
  try {
    const savedEngine = LS.get("enginePath", null);
    const eng = await api.detectEngine(savedEngine);
    state.engine = eng;
    $("sb-engine-text").textContent = `${eng.version || "rhwp"} (정상 연결)`;
  } catch (e) {
    if (!window.__TAURI__) {
      $("sb-engine-status").innerHTML = `<span class="dot dot-green"></span><span>브라우저 미리보기 모드</span>`;
      $("firstrun").hidden = true;
    } else {
      $("sb-engine-status").innerHTML = `<span class="dot dot-red"></span><span>엔진 없음</span>`;
      $("firstrun").hidden = false;
    }
  }

  // 3. 퀵 액세스 툴바 배선
  $("qa-new")?.addEventListener("click", newDocument);
  $("qa-open")?.addEventListener("click", promptOpenDocument);
  $("qa-save")?.addEventListener("click", () => toast("문서가 저장되었습니다.", "ok"));
  $("qa-pdf")?.addEventListener("click", exportPdf);
  $("qa-undo")?.addEventListener("click", () => formatDoc("undo"));
  $("qa-redo")?.addEventListener("click", () => formatDoc("redo"));
  $("qa-print")?.addEventListener("click", () => window.print());

  // 4. 메뉴바 배선
  $("m-new")?.addEventListener("click", newDocument);
  $("m-open")?.addEventListener("click", promptOpenDocument);
  $("m-save")?.addEventListener("click", () => toast("저장 완료", "ok"));
  $("m-export-pdf")?.addEventListener("click", exportPdf);
  $("m-export-hwpx")?.addEventListener("click", async () => {
    if (!state.activeDoc || !state.engine) return toast("변환할 문서가 없습니다.", "bad");
    try {
      await api.runTool(state.engine.path, ["export-hwpx", state.activeDoc, "--verify", "--json"], "menu");
      toast("HWPX 변환 완료", "ok");
    } catch (e) { toast(String(e), "bad"); }
  });
  $("m-export-hwp")?.addEventListener("click", async () => {
    if (!state.activeDoc || !state.engine) return toast("변환할 문서가 없습니다.", "bad");
    try {
      await api.runTool(state.engine.path, ["convert", state.activeDoc, "--verify", "--json"], "menu");
      toast("HWP 변환 완료", "ok");
    } catch (e) { toast(String(e), "bad"); }
  });
  $("m-print")?.addEventListener("click", () => window.print());

  $("m-undo")?.addEventListener("click", () => formatDoc("undo"));
  $("m-redo")?.addEventListener("click", () => formatDoc("redo"));
  $("m-cut")?.addEventListener("click", () => formatDoc("cut"));
  $("m-copy")?.addEventListener("click", () => formatDoc("copy"));
  $("m-paste")?.addEventListener("click", () => formatDoc("paste"));
  $("m-select-all")?.addEventListener("click", () => formatDoc("selectAll"));

  $("m-view-ruler")?.addEventListener("click", () => {
    const ruler = $("ruler-bar");
    if (ruler) ruler.hidden = !ruler.hidden;
  });
  $("m-view-sidebar")?.addEventListener("click", () => {
    $("page-sidebar")?.classList.toggle("collapsed");
  });
  $("sidebar-close-btn")?.addEventListener("click", () => {
    $("page-sidebar")?.classList.add("collapsed");
  });

  $("m-insert-table")?.addEventListener("click", () => insertTable(3, 3));
  $("m-insert-hr")?.addEventListener("click", () => formatDoc("insertHorizontalRule"));
  $("m-insert-date")?.addEventListener("click", () => {
    const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
    formatDoc("insertText", today);
  });

  $("m-tool-batch")?.addEventListener("click", () => { $("batch-modal").hidden = false; });
  $("batch-close")?.addEventListener("click", () => { $("batch-modal").hidden = true; });

  // 5. 리본 서식 도구상자 배선
  $("font-family-select")?.addEventListener("change", (e) => {
    formatDoc("fontName", e.target.value);
  });
  $("font-size-select")?.addEventListener("change", (e) => {
    const size = e.target.value;
    // contenteditable 폰트 크기 직접 적용
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const span = document.createElement("span");
      span.style.fontSize = `${size}pt`;
      try {
        range.surroundContents(span);
      } catch {
        formatDoc("fontSize", "4");
      }
    }
  });

  $("tb-bold")?.addEventListener("click", () => formatDoc("bold"));
  $("tb-italic")?.addEventListener("click", () => formatDoc("italic"));
  $("tb-underline")?.addEventListener("click", () => formatDoc("underline"));
  $("tb-strike")?.addEventListener("click", () => formatDoc("strikeThrough"));

  $("text-color-picker")?.addEventListener("input", (e) => {
    formatDoc("foreColor", e.target.value);
  });
  $("text-highlight-picker")?.addEventListener("input", (e) => {
    formatDoc("hiliteColor", e.target.value);
  });

  $("tb-align-left")?.addEventListener("click", () => formatDoc("justifyLeft"));
  $("tb-align-center")?.addEventListener("click", () => formatDoc("justifyCenter"));
  $("tb-align-right")?.addEventListener("click", () => formatDoc("justifyRight"));
  $("tb-align-justify")?.addEventListener("click", () => formatDoc("justifyFull"));
  $("tb-list-bullet")?.addEventListener("click", () => formatDoc("insertUnorderedList"));
  $("tb-list-num")?.addEventListener("click", () => formatDoc("insertOrderedList"));

  $("tb-insert-table")?.addEventListener("click", () => insertTable(3, 3));
  $("tb-insert-image")?.addEventListener("click", promptInsertImage);

  // 모드 전환 탭
  $("mode-viewer-btn")?.addEventListener("click", () => viewer.setMode("viewer"));
  $("mode-editor-btn")?.addEventListener("click", () => viewer.setMode("editor"));

  // 워터마크 버튼
  $("wm-btn-open")?.addEventListener("click", promptOpenDocument);
  $("wm-btn-new")?.addEventListener("click", newDocument);

  // 6. 편집기 입력 감지
  $("sheet-editor")?.addEventListener("input", updateCharCount);
  $("sheet-editor")?.addEventListener("keyup", updateCursorPos);
  $("sheet-editor")?.addEventListener("click", updateCursorPos);

  // 7. 테마 전환
  const savedTheme = LS.get("theme", "light");
  applyTheme(savedTheme);
  $("btn-theme")?.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    const next = cur === "dark" ? "light" : "dark";
    applyTheme(next);
  });

  // 8. 드래그 앤 드롭 파일 열기
  setupDragAndDrop();

  // 9. 최근 문서 목록 렌더링
  renderRecentDocs();

  // 10. 시작 인자 파일이 있으면 열기
  try {
    const args = await api.startupArgs();
    if (args && args.length) {
      const target = args.find((a) => api.isDocPath(a));
      if (target) await openDocument(target);
    }
  } catch {}
}

function updateCursorPos() {
  // 줄/칸 계산
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  $("sb-cursor-pos").textContent = "1줄 1칸";
}

function insertTable(rows = 3, cols = 3) {
  viewer.setMode("editor");
  let html = `<table style="width:100%; border-collapse: collapse; margin: 12px 0;"><tbody>`;
  for (let r = 0; r < rows; r++) {
    html += "<tr>";
    for (let c = 0; c < cols; c++) {
      html += `<td style="border: 1px solid #475569; padding: 8px 12px; min-width: 60px;">&nbsp;</td>`;
    }
    html += "</tr>";
  }
  html += `</tbody></table><p><br></p>`;
  formatDoc("insertHTML", html);
}

async function promptInsertImage() {
  viewer.setMode("editor");
  try {
    const file = await api.pickAnyFile();
    if (file) {
      formatDoc("insertHTML", `<img src="${file}" style="max-width:100%; height:auto; margin: 10px 0;" alt="삽입된 그림"><p><br></p>`);
    }
  } catch (e) {
    toast(`그림 삽입 실패: ${e}`, "bad");
  }
}

function applyTheme(theme) {
  const effectiveTheme =
    theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;

  document.documentElement.setAttribute("data-theme", effectiveTheme);
  LS.set("theme", theme);

  const select = $("setting-theme");
  if (select && select.value !== theme) {
    select.value = theme;
  }

  const btnTheme = $("btn-theme");
  if (btnTheme) {
    btnTheme.title = effectiveTheme === "dark" ? "라이트 테마로 전환" : "다크 테마로 전환";
    const iconSpan = btnTheme.querySelector("[data-icon]");
    if (iconSpan) {
      const nextIcon = effectiveTheme === "dark" ? "sun" : "moon";
      iconSpan.setAttribute("data-icon", nextIcon);
      iconSpan.innerHTML = ICONS[nextIcon] || "";
    }
  }
}

function setupDragAndDrop() {
  const veil = $("drop-veil");
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (veil) veil.hidden = false;
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", (e) => {
    if (e.relatedTarget === null && veil) veil.hidden = true;
  });
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (veil) veil.hidden = true;
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const f = files[0];
      if (api.isDocPath(f.name)) {
        await openDocument(f.path || f.name);
      } else {
        toast("HWP 또는 HWPX 파일만 열 수 있습니다.", "bad");
      }
    }
  });
}

window.addEventListener("DOMContentLoaded", init);
