import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Combine,
  Download,
  FileImage,
  FolderArchive,
  ImageOff,
  ImagePlus,
  Languages,
  Loader2,
  LockKeyhole,
  Pencil,
  RotateCcw,
  Undo2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  buildInitialCards,
  collectMergedPreviewUrls,
  detectExtractElements,
  isExportCandidate,
  planMerge,
  applyMerge,
  undoMerge as undoMergeInCards,
  renameCard,
  toggleCardExcluded,
  renderCombinedPreview,
  validateExtractElementsFile,
  type ExtractedElement,
  type RasterSourceData,
  type ReviewCard,
  type UnsupportedReason,
} from "./extract-elements-utils";
import {
  buildExportFilename,
  exportCardAsJpgBlob,
  exportCardAsPngBlob,
  exportCardAsSvgString,
  sanitizeFilenameBase,
} from "./extract-elements-export";
import { downloadBlob } from "./vector-utils";

type ExportFormat = "png" | "jpg" | "svg";

type Language = "en" | "ko";
type UploadedImage = { file: File; url: string };

const copy = {
  en: {
    back: "Image to SVG",
    privacy: "Your image stays on this device",
    eyebrow: "EXTRACT ELEMENTS",
    title: "Separate one image into reusable assets.",
    intro: "Start with one image. Review each detected element, rename it, and choose the formats you want to export.",
    steps: ["Upload", "Review", "Export"],
    uploadLabel: "STEP 1",
    uploadTitle: "Upload one image",
    replace: "Replace",
    drop: "Drop your image here",
    choose: "or click to choose a file",
    formats: "PNG · JPG · JPEG · WEBP · up to 10 MB",
    reading: "Reading your image…",
    ready: "Ready for element detection",
    detecting: "Detecting elements…",
    detectionError: "Couldn't detect elements in that image. Try a different file.",
    reviewLabel: "STEP 2",
    reviewTitle: "Review detected elements",
    reviewHint: "This early fast-path detector works best on flat artwork with a transparent, white, off-white, or cream background.",
    limitationNote: "Known limitation: elements that touch or overlap may be merged into one, and an overlapping object can't yet be split back into separate complete shapes.",
    selectAll: "Select all",
    deselectAll: "Deselect all",
    selectedCount: (selected: number, total: number) => `${selected} / ${total} selected`,
    elementLabel: "Element",
    mergeSelected: "Merge selected",
    mergedDefaultName: "Merged element",
    mergedFromLabel: (count: number) => `Merged from ${count} elements`,
    undoMerge: "Undo merge",
    resetExtraction: "Reset extraction",
    exclude: "Exclude",
    restore: "Restore",
    excludedBadge: "Excluded",
    rename: "Rename",
    saveName: "Save name",
    cancelRename: "Cancel",
    emptyNameHint: "Name can't be empty.",
    unsupportedTitle: "Not suited for automatic separation",
    unsupportedMessage: "This image may not be suitable for automatic element extraction.\nTry an image with separated elements and a simple background.",
    exportHint: "Select a card to enable its PNG, JPG, and SVG downloads below.",
    exportPng: "Download PNG",
    exportJpg: "Download JPG",
    exportSvg: "Download SVG",
    exportError: "Couldn't export this file. Try again.",
    nextTitle: "What comes next",
    nextIntro: "The next development phase adds content-based filenames, keywords, CSV metadata, and a ZIP of everything at once.",
    exportTitle: "Batch export, still to come",
    exportText: "CSV metadata and a Download All ZIP for every selected asset at once.",
    filenameTitle: "English or Korean metadata",
    filenameText: "Generate editable filenames, titles, and keywords in your preferred language.",
    status: "Hidden development route · not linked from the live site",
    typeError: "Choose a PNG, JPG, JPEG, or WebP image.",
    sizeError: "Choose an image smaller than 10 MB.",
  },
  ko: {
    back: "이미지를 SVG로",
    privacy: "이미지는 이 기기 안에만 머뭅니다",
    eyebrow: "요소 추출",
    title: "한 장의 이미지에서 재사용할 요소를 분리하세요.",
    intro: "이미지 한 장으로 시작해 감지된 요소를 각각 확인하고, 이름과 내보낼 형식을 선택할 수 있습니다.",
    steps: ["업로드", "검토", "내보내기"],
    uploadLabel: "1단계",
    uploadTitle: "이미지 한 장 업로드",
    replace: "바꾸기",
    drop: "이미지를 여기에 놓으세요",
    choose: "또는 클릭하여 파일을 선택하세요",
    formats: "PNG · JPG · JPEG · WEBP · 최대 10 MB",
    reading: "이미지를 읽는 중…",
    ready: "요소 감지 준비 완료",
    detecting: "요소를 감지하는 중…",
    detectionError: "이 이미지에서 요소를 감지하지 못했습니다. 다른 파일을 시도해 주세요.",
    reviewLabel: "2단계",
    reviewTitle: "감지된 요소 확인",
    reviewHint: "이 초기 감지 기능은 투명하거나 흰색·오프화이트·크림색 배경의 단순한 이미지에서 가장 잘 작동합니다.",
    limitationNote: "알려진 한계: 서로 닿거나 겹치는 요소는 하나로 합쳐질 수 있으며, 겹친 오브젝트는 아직 완전한 개별 도형으로 다시 분리할 수 없습니다.",
    selectAll: "전체 선택",
    deselectAll: "전체 해제",
    selectedCount: (selected: number, total: number) => `${selected} / ${total}개 선택됨`,
    elementLabel: "요소",
    mergeSelected: "선택한 요소 합치기",
    mergedDefaultName: "합쳐진 요소",
    mergedFromLabel: (count: number) => `${count}개 요소를 합침`,
    undoMerge: "합치기 취소",
    resetExtraction: "추출 결과 초기화",
    exclude: "제외",
    restore: "복원",
    excludedBadge: "제외됨",
    rename: "이름 바꾸기",
    saveName: "이름 저장",
    cancelRename: "취소",
    emptyNameHint: "이름을 비워둘 수 없습니다.",
    unsupportedTitle: "자동 분리에 적합하지 않음",
    unsupportedMessage: "이 이미지는 자동 요소 분리에 적합하지 않을 수 있습니다.\n요소가 서로 떨어져 있고 배경이 단순한 이미지를 사용해 주세요.",
    exportHint: "카드를 선택하면 아래 PNG·JPG·SVG 다운로드가 활성화됩니다.",
    exportPng: "PNG 다운로드",
    exportJpg: "JPG 다운로드",
    exportSvg: "SVG 다운로드",
    exportError: "이 파일을 내보내지 못했습니다. 다시 시도해 주세요.",
    nextTitle: "다음 단계에서 할 일",
    nextIntro: "다음 개발 단계에서는 콘텐츠 기반 파일명, 키워드, CSV 메타데이터, 한 번에 받는 ZIP을 추가합니다.",
    exportTitle: "일괄 내보내기, 아직 준비 중",
    exportText: "선택한 모든 에셋을 한 번에 받는 CSV 메타데이터와 전체 ZIP 다운로드가 다음에 추가됩니다.",
    filenameTitle: "영어 또는 한국어 메타데이터",
    filenameText: "선택한 언어로 파일명, 제목, 키워드를 만들고 직접 수정할 수 있습니다.",
    status: "숨김 개발 경로 · 운영 사이트에는 연결되지 않음",
    typeError: "PNG, JPG, JPEG 또는 WebP 이미지를 선택해 주세요.",
    sizeError: "10 MB보다 작은 이미지를 선택해 주세요.",
  },
} as const;

export default function ExtractElementsPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [language, setLanguage] = useState<Language>(() => new URLSearchParams(window.location.search).get("lang") === "ko" ? "ko" : "en");
  const [upload, setUpload] = useState<UploadedImage | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [elements, setElements] = useState<ExtractedElement[]>([]);
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [detecting, setDetecting] = useState(false);
  const [detectionError, setDetectionError] = useState("");
  const [unsupportedReason, setUnsupportedReason] = useState<UnsupportedReason | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [exportErrors, setExportErrors] = useState<Record<string, string>>({});
  const content = copy[language];
  const elementsRef = useRef<ExtractedElement[]>([]);
  const cardsRef = useRef<ReviewCard[]>([]);
  const sourceRef = useRef<RasterSourceData | null>(null);
  const labelsRef = useRef<Int32Array | null>(null);
  const nextMergedIdRef = useRef(100000);
  const usedExportFilenamesRef = useRef<Set<string>>(new Set());
  elementsRef.current = elements;
  cardsRef.current = cards;

  useEffect(() => () => {
    if (upload) URL.revokeObjectURL(upload.url);
  }, [upload]);

  useEffect(() => () => {
    elementsRef.current.forEach((element) => URL.revokeObjectURL(element.previewUrl));
    cardsRef.current.forEach((card) => collectMergedPreviewUrls(card).forEach((url) => URL.revokeObjectURL(url)));
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === "ko" ? "요소 추출 | WOOJOO Image" : "Extract Elements | WOOJOO Image";
  }, [language]);

  const changeLanguage = (next: Language) => {
    setLanguage(next);
    const url = new URL(window.location.href);
    if (next === "ko") url.searchParams.set("lang", "ko"); else url.searchParams.delete("lang");
    window.history.replaceState({}, "", url);
  };

  const runDetection = useCallback(async (file: File) => {
    elementsRef.current.forEach((element) => URL.revokeObjectURL(element.previewUrl));
    cardsRef.current.forEach((card) => collectMergedPreviewUrls(card).forEach((url) => URL.revokeObjectURL(url)));
    setElements([]);
    setCards([]);
    setSelectedIds(new Set());
    setDetectionError("");
    setUnsupportedReason(null);
    setEditingId(null);
    sourceRef.current = null;
    labelsRef.current = null;
    nextMergedIdRef.current = 100000;
    usedExportFilenamesRef.current = new Set();
    setExportErrors({});
    setDetecting(true);
    try {
      const outcome = await detectExtractElements(file);
      if (outcome.status === "unsupported") {
        setUnsupportedReason(outcome.reason);
      } else {
        sourceRef.current = outcome.source;
        labelsRef.current = outcome.labels;
        setElements(outcome.elements);
        setCards(buildInitialCards(outcome.elements, content.elementLabel));
        setSelectedIds(new Set(outcome.elements.map((element) => element.id)));
      }
    } catch {
      setDetectionError(content.detectionError);
    } finally {
      setDetecting(false);
    }
  }, [content.detectionError, content.elementLabel]);

  const acceptFile = (file?: File) => {
    if (!file) return;
    setError("");
    const validation = validateExtractElementsFile(file);
    if (validation) {
      setError(validation === "type" ? content.typeError : content.sizeError);
      return;
    }
    setUpload({ file, url: URL.createObjectURL(file) });
    void runDetection(file);
  };

  const toggleElement = (id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(cards.map((card) => card.id)));
  const deselectAll = () => setSelectedIds(new Set());

  const mergeSelected = useCallback(async () => {
    const source = sourceRef.current;
    const labels = labelsRef.current;
    if (!source || !labels) return;
    const plan = planMerge(cards, selectedIds);
    if (!plan) return;

    const previewUrl = await renderCombinedPreview(source, labels, plan.bounds, plan.memberIds);
    const mergedId = nextMergedIdRef.current;
    nextMergedIdRef.current += 1;

    setCards((current) => applyMerge(current, plan.members, mergedId, previewUrl, content.mergedDefaultName));
    setSelectedIds(new Set([mergedId]));
  }, [cards, selectedIds, content.mergedDefaultName]);

  const undoMerge = (mergedId: number) => {
    const merged = cards.find((card) => card.id === mergedId);
    if (!merged?.mergedFrom) return;
    URL.revokeObjectURL(merged.previewUrl);
    setCards((current) => undoMergeInCards(current, mergedId));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(mergedId);
      return next;
    });
  };

  const resetExtraction = () => {
    cards.forEach((card) => collectMergedPreviewUrls(card).forEach((url) => URL.revokeObjectURL(url)));
    setCards(buildInitialCards(elements, content.elementLabel));
    setSelectedIds(new Set(elements.map((element) => element.id)));
    setEditingId(null);
  };

  const toggleExcluded = (id: number) => {
    setCards((current) => toggleCardExcluded(current, id));
  };

  const startRename = (card: ReviewCard) => {
    setEditingId(card.id);
    setEditingValue(card.name);
  };

  const commitRename = (id: number) => {
    setCards((current) => renameCard(current, id, editingValue).cards);
    setEditingId(null);
  };

  const exportCard = async (card: ReviewCard, format: ExportFormat) => {
    const source = sourceRef.current;
    const labels = labelsRef.current;
    if (!source || !labels || !isExportCandidate(card, selectedIds)) return;
    const key = `${card.id}-${format}`;
    setExportErrors((current) => { const next = { ...current }; delete next[key]; return next; });
    setExportingKey(key);
    try {
      const baseName = sanitizeFilenameBase(card.name);
      if (format === "png") {
        const blob = await exportCardAsPngBlob(source, labels, card);
        const filename = buildExportFilename(baseName, "png", usedExportFilenamesRef.current);
        const status = await downloadBlob(blob, filename, "PNG image");
        if (status !== "cancelled") usedExportFilenamesRef.current.add(filename.toLowerCase());
      } else if (format === "jpg") {
        const blob = await exportCardAsJpgBlob(source, labels, card);
        const filename = buildExportFilename(baseName, "jpg", usedExportFilenamesRef.current);
        const status = await downloadBlob(blob, filename, "JPG image");
        if (status !== "cancelled") usedExportFilenamesRef.current.add(filename.toLowerCase());
      } else {
        const svg = exportCardAsSvgString(source, labels, card);
        const filename = buildExportFilename(baseName, "svg", usedExportFilenamesRef.current);
        const status = await downloadBlob(new Blob([svg], { type: "image/svg+xml" }), filename, "SVG artwork");
        if (status !== "cancelled") usedExportFilenamesRef.current.add(filename.toLowerCase());
      }
    } catch {
      setExportErrors((current) => ({ ...current, [key]: content.exportError }));
    } finally {
      setExportingKey(null);
    }
  };

  const activeStepIndex = upload ? 1 : 0;

  return (
    <main className="extract-page" lang={language}>
      <header className="extract-topbar">
        <a className="extract-brand" href={language === "ko" ? "/?lang=ko" : "/"} aria-label={content.back}>
          <img src="/logo.png" alt="WOOJOO Image" />
        </a>
        <a className="extract-back" href={language === "ko" ? "/?lang=ko" : "/"}><ArrowLeft size={17} />{content.back}</a>
        <div className="extract-privacy"><LockKeyhole size={16} />{content.privacy}</div>
        <nav className="extract-language" aria-label={language === "ko" ? "언어 선택" : "Language selection"}>
          <button type="button" className={language === "en" ? "active" : ""} onClick={() => changeLanguage("en")}>ENG</button>
          <span>/</span>
          <button type="button" className={language === "ko" ? "active" : ""} onClick={() => changeLanguage("ko")}>한국어</button>
        </nav>
      </header>

      <section className="extract-heading">
        <div>
          <span className="extract-eyebrow">{content.eyebrow}</span>
          <h1>{content.title}</h1>
          <p>{content.intro}</p>
        </div>
        <ol className="extract-steps" aria-label={language === "ko" ? "요소 추출 진행 단계" : "Extract Elements progress"}>
          {content.steps.map((step, index) => <li className={index === activeStepIndex ? "active" : ""} key={step}><span>{index + 1}</span>{step}</li>)}
        </ol>
      </section>

      <section className="extract-workspace">
        <article className="extract-upload-card">
          <div className="extract-card-heading">
            <div><span>{content.uploadLabel}</span><h2>{content.uploadTitle}</h2></div>
            {upload && <button type="button" onClick={() => fileInput.current?.click()}><RotateCcw size={16} />{content.replace}</button>}
          </div>
          <div
            className={`extract-dropzone ${dragging ? "dragging" : ""} ${upload ? "has-image" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={content.uploadTitle}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInput.current?.click(); }}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); acceptFile(event.dataTransfer.files[0]); }}
          >
            {upload ? (
              <>
                <div className="extract-image-preview"><img src={upload.url} alt={upload.file.name} /></div>
                <div className="extract-file-info"><FileImage size={18} /><span><b>{upload.file.name}</b><small>{(upload.file.size / 1024 / 1024).toFixed(2)} MB</small></span><em><Check size={15} />{content.ready}</em></div>
              </>
            ) : (
              <>
                <span className="extract-upload-icon"><UploadCloud size={30} /></span>
                <strong>{content.drop}</strong>
                <p>{content.choose}</p>
                <span className="extract-formats">{content.formats}</span>
              </>
            )}
          </div>
          <input ref={fileInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => acceptFile(event.target.files?.[0])} />
          {error && <p className="extract-error" role="alert">{error}</p>}
          {detecting && <p className="extract-detecting"><Loader2 size={16} className="extract-spin" />{content.detecting}</p>}
        </article>

        <aside className="extract-next-card">
          <div className="extract-next-heading"><span><ImagePlus size={20} /></span><div><h2>{content.nextTitle}</h2><p>{content.nextIntro}</p></div></div>
          <div className="extract-next-list">
            <article><span><FolderArchive size={19} /></span><div><h3>{content.exportTitle}</h3><p>{content.exportText}</p></div></article>
            <article><span><Languages size={19} /></span><div><h3>{content.filenameTitle}</h3><p>{content.filenameText}</p></div></article>
          </div>
          <div className="extract-format-preview" aria-hidden="true"><span><FolderArchive size={15} />Download All (ZIP)</span><span>CSV</span></div>
        </aside>
      </section>

      {upload && !detecting && (
        <section className="extract-review">
          <div className="extract-review-heading">
            <div>
              <span>{content.reviewLabel}</span><h2>{content.reviewTitle}</h2><p>{content.reviewHint}</p>
              <p className="extract-review-limitation">{content.limitationNote}</p>
              <p className="extract-review-limitation">{content.exportHint}</p>
            </div>
            {cards.length > 0 && (
              <div className="extract-review-controls">
                <span className="extract-review-count">{content.selectedCount(selectedIds.size, cards.length)}</span>
                <button type="button" onClick={selectAll}><Check size={14} />{content.selectAll}</button>
                <button type="button" onClick={deselectAll}>{content.deselectAll}</button>
                <button type="button" disabled={selectedIds.size < 2} onClick={() => void mergeSelected()}><Combine size={14} />{content.mergeSelected}</button>
                <button type="button" onClick={resetExtraction}><RotateCcw size={14} />{content.resetExtraction}</button>
              </div>
            )}
          </div>

          {detectionError ? (
            <p className="extract-error" role="alert">{detectionError}</p>
          ) : unsupportedReason || cards.length === 0 ? (
            <div className="extract-unsupported-state" role="status">
              <ImageOff size={22} />
              <strong>{content.unsupportedTitle}</strong>
              {content.unsupportedMessage.split("\n").map((line) => <p key={line}>{line}</p>)}
            </div>
          ) : (
            <div className="extract-element-grid" role="list">
              {cards.map((card) => {
                const selected = selectedIds.has(card.id);
                const editing = editingId === card.id;
                return (
                  <article className={`extract-element-card ${selected ? "selected" : ""} ${card.excluded ? "excluded" : ""}`} key={card.id} role="listitem">
                    <button
                      type="button"
                      className="extract-element-checkbox"
                      aria-pressed={selected}
                      aria-label={`${content.elementLabel} ${card.name}`}
                      onClick={() => toggleElement(card.id)}
                    >
                      {selected && <Check size={13} />}
                    </button>
                    {card.excluded && <span className="extract-excluded-badge">{content.excludedBadge}</span>}
                    <div className="extract-element-preview"><img src={card.previewUrl} alt={card.name} /></div>

                    {editing ? (
                      <div className="extract-element-rename">
                        <input
                          className="extract-element-name-input"
                          value={editingValue}
                          autoFocus
                          onChange={(event) => setEditingValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitRename(card.id);
                            if (event.key === "Escape") setEditingId(null);
                          }}
                        />
                        <button type="button" aria-label={content.saveName} onClick={() => commitRename(card.id)}><Check size={13} /></button>
                        <button type="button" aria-label={content.cancelRename} onClick={() => setEditingId(null)}><X size={13} /></button>
                      </div>
                    ) : (
                      <button type="button" className="extract-element-name" onClick={() => startRename(card)} aria-label={content.rename}>
                        {card.name}<Pencil size={11} />
                      </button>
                    )}

                    <span className="extract-element-size">{card.width}×{card.height}</span>

                    {card.mergedFrom && (
                      <div className="extract-element-merge-info">
                        <span>{content.mergedFromLabel(card.mergedFrom.length)}</span>
                        <button type="button" onClick={() => undoMerge(card.id)}><Undo2 size={12} />{content.undoMerge}</button>
                      </div>
                    )}

                    <button type="button" className="extract-element-exclude" onClick={() => toggleExcluded(card.id)}>
                      {card.excluded ? content.restore : content.exclude}
                    </button>

                    <div className="extract-element-export-row">
                      {(["png", "jpg", "svg"] as const).map((format) => {
                        const key = `${card.id}-${format}`;
                        const label = format === "png" ? content.exportPng : format === "jpg" ? content.exportJpg : content.exportSvg;
                        return (
                          <button
                            key={format}
                            type="button"
                            disabled={!isExportCandidate(card, selectedIds) || exportingKey === key}
                            aria-label={label}
                            title={label}
                            onClick={() => void exportCard(card, format)}
                          >
                            {exportingKey === key ? <Loader2 size={12} className="extract-spin" /> : <Download size={12} />}
                            {format.toUpperCase()}
                          </button>
                        );
                      })}
                    </div>
                    {exportErrors[`${card.id}-png`] || exportErrors[`${card.id}-jpg`] || exportErrors[`${card.id}-svg`] ? (
                      <p className="extract-element-export-error">{content.exportError}</p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      <footer className="extract-status"><span />{content.status}</footer>
    </main>
  );
}
