// rhwp-desk — 워드 프로세서 A4 페이지 뷰어 엔진
// HWP/HWPX 문서의 각 페이지를 고해상도 SVG 벡터로 A4 용지 캔버스에 렌더링.

import { renderPage, basename } from "./api.js";

const $ = (id) => document.getElementById(id);

export class Viewer {
  constructor({ getEngine, onError, onInfo }) {
    this.getEngine = getEngine;
    this.onError = onError;
    this.onInfo = onInfo;
    this.doc = null;
    this.page = 1;
    this.pageCount = 0;
    this.zoom = 1;
    this.cache = new Map(); // `${doc}#${page}` -> svg

    // 페이지 이동 버튼
    $("tb-prev-page")?.addEventListener("click", () => this.go(this.page - 1));
    $("tb-next-page")?.addEventListener("click", () => this.go(this.page + 1));
    $("m-page-prev")?.addEventListener("click", () => this.go(this.page - 1));
    $("m-page-next")?.addEventListener("click", () => this.go(this.page + 1));

    // 줌 컨트롤
    $("sb-zoom-in")?.addEventListener("click", () => this.setZoom(this.zoom + 0.1));
    $("sb-zoom-out")?.addEventListener("click", () => this.setZoom(this.zoom - 0.1));
    $("sb-zoom-fit-width")?.addEventListener("click", () => this.fitWidth());
    $("m-view-fit-width")?.addEventListener("click", () => this.fitWidth());
    $("m-view-100")?.addEventListener("click", () => this.setZoom(1.0));
    $("sb-zoom-slider")?.addEventListener("input", (e) => {
      this.setZoom(parseInt(e.target.value, 10) / 100);
    });

    // 키보드 단축키
    window.addEventListener("keydown", (e) => {
      if (document.activeElement?.getAttribute("contenteditable") === "true") return;
      if (e.key === "PageDown" || (e.altKey && e.key === "ArrowDown")) {
        e.preventDefault();
        this.go(this.page + 1);
      } else if (e.key === "PageUp" || (e.altKey && e.key === "ArrowUp")) {
        e.preventDefault();
        this.go(this.page - 1);
      }
    });

    // 창 리사이즈 감지
    window.addEventListener("resize", () => {
      this.drawRuler();
    });
    this.drawRuler();
  }

  /** 눈금자 눈금 렌더링 (A4 가로 21cm 기준) */
  drawRuler() {
    const ticksContainer = $("ruler-ticks");
    if (!ticksContainer) return;
    ticksContainer.innerHTML = "";
    const sheet = $("a4-sheet");
    const sheetRect = sheet ? sheet.getBoundingClientRect() : null;
    const sheetLeft = sheetRect ? sheetRect.left : 250;
    const sheetWidth = sheetRect ? sheetRect.width : 794;

    const cmPx = sheetWidth / 21; // 21cm for A4 width
    for (let cm = 0; cm <= 21; cm++) {
      const x = sheetLeft + cm * cmPx;
      const mark = document.createElement("div");
      mark.className = "ruler-tick-mark cm";
      mark.style.left = `${x}px`;

      const label = document.createElement("span");
      label.className = "ruler-tick-label";
      label.textContent = String(cm);
      label.style.left = `${x}px`;

      ticksContainer.append(mark, label);

      if (cm < 21) {
        for (let mm = 1; mm < 10; mm++) {
          const subMark = document.createElement("div");
          subMark.className = "ruler-tick-mark mm";
          subMark.style.left = `${x + (mm * cmPx) / 10}px`;
          ticksContainer.append(subMark);
        }
      }
    }

    // 마진 마커 위치 맞춤 (좌 20mm, 우 20mm)
    const marginPx = 2 * cmPx;
    const mLeft = $("ruler-margin-left");
    const mRight = $("ruler-margin-right");
    if (mLeft) mLeft.style.left = `${sheetLeft + marginPx}px`;
    if (mRight) mRight.style.left = `${sheetLeft + sheetWidth - marginPx}px`;
  }

  /** HWP/HWPX 문서 열기 */
  async open(docPath, page = 1) {
    this.doc = docPath;
    this.page = page;

    // 제목 업데이트
    const name = basename(docPath);
    $("doc-title-text").textContent = name;
    const ext = name.split(".").pop().toUpperCase();
    $("doc-format-badge").textContent = ext;
    document.title = `${name} - rhwp 워드 프로세서`;

    // 뷰어 모드로 전환
    this.setMode("viewer");
    $("welcome-watermark")?.setAttribute("hidden", "true");

    await this.load();
    this.renderThumbnails();
  }

  /** 페이지 이동 */
  async go(page) {
    if (!this.doc) return;
    const p = Math.min(Math.max(1, page), this.pageCount || 1);
    if (p === this.page && $("sheet-svg-host")?.firstChild) return;
    this.page = p;
    await this.load();
    this.updateThumbnailsActive();
  }

  /** 페이지 렌더링 로드 */
  async load() {
    const host = $("sheet-svg-host");
    if (!host) return;

    const key = `${this.doc}#${this.page}`;
    this.updatePageIndicators();

    try {
      let svg = this.cache.get(key);
      if (!svg) {
        host.style.opacity = ".5";
        const engine = this.getEngine();
        if (!engine) {
          throw new Error("rhwp 엔진이 설정되지 않았습니다.");
        }
        const res = await renderPage(engine, this.doc, this.page);
        svg = res.svg;
        this.pageCount = res.pageCount;
        this.cache.set(key, svg);
        if (this.cache.size > 30) this.cache.delete(this.cache.keys().next().value);
      }

      host.innerHTML = svg;
      host.style.opacity = "1";
      this.updatePageIndicators();

      // SVG 원본 비율에 맞춰 줌 적용
      this.applyZoom();
      this.drawRuler();
    } catch (e) {
      host.style.opacity = "1";
      this.onError?.(String(e));
    }
  }

  /** 페이지 번호 인디케이터 동기화 */
  updatePageIndicators() {
    const total = this.pageCount || 1;
    $("tb-current-page").textContent = this.page;
    $("tb-total-pages").textContent = total;
    $("sb-page-info").textContent = `${this.page} / ${total} 쪽`;
  }

  /** 좌측 페이지 썸네일 리스트 생성 */
  renderThumbnails() {
    const list = $("thumbnail-list");
    if (!list) return;
    list.innerHTML = "";

    const total = Math.max(1, this.pageCount);
    for (let i = 1; i <= total; i++) {
      const item = document.createElement("div");
      item.className = `thumb-item ${i === this.page ? "active" : ""}`;
      item.dataset.page = String(i);

      const sheet = document.createElement("div");
      sheet.className = "thumb-sheet";
      sheet.textContent = String(i);

      const label = document.createElement("span");
      label.className = "thumb-label";
      label.textContent = `${i} 쪽`;

      item.append(sheet, label);
      item.addEventListener("click", () => this.go(i));
      list.append(item);
    }
  }

  updateThumbnailsActive() {
    const items = document.querySelectorAll(".thumb-item");
    items.forEach((it) => {
      const p = parseInt(it.dataset.page, 10);
      it.classList.toggle("active", p === this.page);
    });
  }

  /** 줌 배율 설정 */
  setZoom(z) {
    this.zoom = Math.min(2.5, Math.max(0.4, z));
    this.applyZoom();
  }

  fitWidth() {
    const canvas = $("page-canvas");
    const sheet = $("a4-sheet");
    if (!canvas || !sheet) return;
    const avail = canvas.clientWidth - 80;
    const targetZoom = avail / 794;
    this.setZoom(targetZoom);
  }

  applyZoom() {
    const wrapper = $("sheet-zoom-wrapper");
    if (wrapper) {
      wrapper.style.transform = `scale(${this.zoom})`;
    }
    const percent = Math.round(this.zoom * 100);
    $("sb-zoom-val").textContent = `${percent}%`;
    const slider = $("sb-zoom-slider");
    if (slider) slider.value = percent;
    setTimeout(() => this.drawRuler(), 50);
  }

  /** 뷰어 모드 vs 편집기 모드 전환 */
  setMode(mode) {
    const svgHost = $("sheet-svg-host");
    const editor = $("sheet-editor");
    const vBtn = $("mode-viewer-btn");
    const eBtn = $("mode-editor-btn");

    if (mode === "editor") {
      svgHost.hidden = true;
      editor.hidden = false;
      vBtn?.classList.remove("active");
      eBtn?.classList.add("active");
      editor.focus();
    } else {
      svgHost.hidden = false;
      editor.hidden = true;
      vBtn?.classList.add("active");
      eBtn?.classList.remove("active");
    }
    this.drawRuler();
  }

  /** 캐시 무효화 */
  invalidate(docPath) {
    for (const k of [...this.cache.keys()]) {
      if (k.startsWith(docPath + "#")) this.cache.delete(k);
    }
  }
}
