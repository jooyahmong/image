import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
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
  UploadCloud,
} from "lucide-react";
import { detectExtractElements, validateExtractElementsFile, type ExtractedElement } from "./extract-elements-utils";

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
    reviewHint: "This early fast-path detector works best on flat artwork with a transparent, white, or near-white background.",
    selectAll: "Select all",
    deselectAll: "Deselect all",
    selectedCount: (selected: number, total: number) => `${selected} / ${total} selected`,
    elementLabel: "Element",
    noElementsTitle: "No separate elements found",
    noElementsText: "Try an image with a plain white or transparent background around each shape.",
    nextTitle: "What comes next",
    nextIntro: "The next development phase connects export and content-based filenames to this workspace.",
    exportTitle: "Export only what you need",
    exportText: "Choose PNG, JPG, SVG, or CSV, then download selected items or one ZIP.",
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
    reviewHint: "이 초기 감지 기능은 투명하거나 흰색·거의 흰색 배경의 단순한 이미지에서 가장 잘 작동합니다.",
    selectAll: "전체 선택",
    deselectAll: "전체 해제",
    selectedCount: (selected: number, total: number) => `${selected} / ${total}개 선택됨`,
    elementLabel: "요소",
    noElementsTitle: "분리된 요소를 찾지 못했습니다",
    noElementsText: "각 모양 주위에 흰색이나 투명한 배경이 있는 이미지를 사용해 보세요.",
    nextTitle: "다음 단계에서 할 일",
    nextIntro: "다음 개발 단계에서 이 작업 공간에 내보내기와 콘텐츠 기반 파일명 기능을 연결합니다.",
    exportTitle: "필요한 형식만 내보내기",
    exportText: "PNG, JPG, SVG, CSV를 선택해 필요한 항목이나 전체 ZIP을 저장합니다.",
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [detecting, setDetecting] = useState(false);
  const [detectionError, setDetectionError] = useState("");
  const content = copy[language];
  const elementsRef = useRef<ExtractedElement[]>([]);
  elementsRef.current = elements;

  useEffect(() => () => {
    if (upload) URL.revokeObjectURL(upload.url);
  }, [upload]);

  useEffect(() => () => {
    elementsRef.current.forEach((element) => URL.revokeObjectURL(element.previewUrl));
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
    setElements([]);
    setSelectedIds(new Set());
    setDetectionError("");
    setDetecting(true);
    try {
      const detected = await detectExtractElements(file);
      setElements(detected);
      setSelectedIds(new Set(detected.map((element) => element.id)));
    } catch {
      setDetectionError(content.detectionError);
    } finally {
      setDetecting(false);
    }
  }, [content.detectionError]);

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

  const selectAll = () => setSelectedIds(new Set(elements.map((element) => element.id)));
  const deselectAll = () => setSelectedIds(new Set());
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
          <div className="extract-format-preview" aria-hidden="true"><span><Pencil size={15} />filename_01</span><span><Download size={15} />PNG</span><span>JPG</span><span>SVG</span><span>CSV</span></div>
        </aside>
      </section>

      {upload && !detecting && (
        <section className="extract-review">
          <div className="extract-review-heading">
            <div><span>{content.reviewLabel}</span><h2>{content.reviewTitle}</h2><p>{content.reviewHint}</p></div>
            {elements.length > 0 && (
              <div className="extract-review-controls">
                <span className="extract-review-count">{content.selectedCount(selectedIds.size, elements.length)}</span>
                <button type="button" onClick={selectAll}><Check size={14} />{content.selectAll}</button>
                <button type="button" onClick={deselectAll}>{content.deselectAll}</button>
              </div>
            )}
          </div>

          {detectionError ? (
            <p className="extract-error" role="alert">{detectionError}</p>
          ) : elements.length === 0 ? (
            <div className="extract-empty-state"><ImageOff size={22} /><strong>{content.noElementsTitle}</strong><p>{content.noElementsText}</p></div>
          ) : (
            <div className="extract-element-grid" role="list">
              {elements.map((element, index) => {
                const selected = selectedIds.has(element.id);
                return (
                  <article className={`extract-element-card ${selected ? "selected" : ""}`} key={element.id} role="listitem">
                    <button
                      type="button"
                      className="extract-element-checkbox"
                      aria-pressed={selected}
                      aria-label={`${content.elementLabel} ${index + 1}`}
                      onClick={() => toggleElement(element.id)}
                    >
                      {selected && <Check size={13} />}
                    </button>
                    <div className="extract-element-preview"><img src={element.previewUrl} alt={`${content.elementLabel} ${index + 1}`} /></div>
                    <span className="extract-element-name">{content.elementLabel} {index + 1}</span>
                    <span className="extract-element-size">{element.width}×{element.height}</span>
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
