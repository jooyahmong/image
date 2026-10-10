import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  FileImage,
  FolderArchive,
  Languages,
  Loader2,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import {
  BULK_MAX_FILES,
  BULK_ZIP_FILENAME,
  buildBulkSvgFilename,
  buildBulkZip,
  bulkProgress,
  convertBulkFile,
  createBulkJobs,
  deselectAllBulkJobs,
  isBulkJobPending,
  partitionIncomingBulkFiles,
  removeBulkJob,
  resetBulkJobToQueued,
  resetFailedBulkJobsToQueued,
  runBulkQueue,
  sanitizeBulkFilenameBase,
  selectAllBulkJobs,
  toggleBulkJobSelected,
  type BulkJob,
} from "./bulk-convert-utils";
import { downloadBlob } from "./vector-utils";

type Language = "en" | "ko";

const BULK_CONCURRENCY = 2;
const BULK_COLOR_COUNT_DEFAULT = 8;
const BULK_CLEANUP = "medium" as const;
const BULK_ANCHOR_SIMPLIFICATION = 50;

const copy = {
  en: {
    back: "Image to SVG",
    privacy: "Your images stay on this device",
    eyebrow: "BULK SVG CONVERT",
    title: "Convert many images to SVG at once.",
    intro: "Upload multiple PNG, JPG, JPEG or WebP images and convert them to SVG at once. Bulk conversion currently supports SVG output only.",
    status: "Hidden development route · not linked from the live site",
    dropTitle: "Drop images here",
    dropHint: "or click to choose files",
    formats: `PNG · JPG · JPEG · WEBP · up to ${BULK_MAX_FILES} files`,
    addMore: "Add more",
    clearAll: "Clear all",
    selectAll: "Select all",
    deselectAll: "Deselect all",
    jobsEmpty: "No images yet. Drop some above to get started.",
    tooManyType: (count: number) => `${count} file${count === 1 ? "" : "s"} skipped: not a supported image type.`,
    tooManyOverflow: (count: number) => `${count} file${count === 1 ? "" : "s"} skipped: the ${BULK_MAX_FILES}-file limit was reached.`,
    settingsTitle: "SVG settings",
    colorCountLabel: "Number of colors",
    convertAll: "Convert All",
    converting: "Converting…",
    cancel: "Cancel",
    progress: (done: number, total: number) => `${done} / ${total} converted`,
    failedCount: (count: number) => `${count} failed`,
    retry: "Retry",
    retryFailed: "Retry Failed",
    downloadSvg: "Download SVG",
    downloadAll: "Download All ZIP",
    remove: "Remove",
    statusQueued: "Queued",
    statusConverting: "Converting",
    statusDone: "Done",
    statusFailed: "Failed",
  },
  ko: {
    back: "이미지를 SVG로",
    privacy: "이미지는 이 기기 안에만 머뭅니다",
    eyebrow: "일괄 SVG 변환",
    title: "여러 이미지를 한 번에 SVG로 변환하세요.",
    intro: "여러 PNG, JPG, JPEG, WebP 이미지를 한 번에 SVG로 변환할 수 있습니다. 현재 일괄 변환은 SVG 저장만 지원합니다.",
    status: "숨겨진 개발 경로 · 실제 서비스에는 연결되어 있지 않습니다",
    dropTitle: "이미지를 여기에 놓으세요",
    dropHint: "또는 클릭하여 파일을 선택하세요",
    formats: `PNG · JPG · JPEG · WEBP · 최대 ${BULK_MAX_FILES}개`,
    addMore: "더 추가",
    clearAll: "전체 지우기",
    selectAll: "전체 선택",
    deselectAll: "전체 해제",
    jobsEmpty: "아직 이미지가 없습니다. 위에 이미지를 올려 시작하세요.",
    tooManyType: (count: number) => `${count}개 파일을 건너뛰었습니다: 지원하지 않는 이미지 형식입니다.`,
    tooManyOverflow: (count: number) => `${count}개 파일을 건너뛰었습니다: 최대 ${BULK_MAX_FILES}개 제한에 도달했습니다.`,
    settingsTitle: "SVG 설정",
    colorCountLabel: "색상 수",
    convertAll: "전체 변환",
    converting: "변환 중…",
    cancel: "취소",
    progress: (done: number, total: number) => `${done} / ${total}개 변환됨`,
    failedCount: (count: number) => `${count}개 실패`,
    retry: "재시도",
    retryFailed: "실패 항목 재시도",
    downloadSvg: "SVG 다운로드",
    downloadAll: "전체 ZIP 다운로드",
    remove: "삭제",
    statusQueued: "대기 중",
    statusConverting: "변환 중",
    statusDone: "완료",
    statusFailed: "실패",
  },
};

export default function BulkConvertPage() {
  const [language, setLanguage] = useState<Language>(() => (new URLSearchParams(window.location.search).get("lang") === "ko" ? "ko" : "en"));
  const [jobs, setJobs] = useState<BulkJob[]>([]);
  const [colorCount, setColorCount] = useState(BULK_COLOR_COUNT_DEFAULT);
  const [isConverting, setIsConverting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [skipNotice, setSkipNotice] = useState("");

  const content = copy[language];
  const fileInput = useRef<HTMLInputElement>(null);
  const nextJobId = useRef(1);
  const jobsRef = useRef<BulkJob[]>([]);
  const cancelRef = useRef(false);
  const objectUrlsRef = useRef(new Map<number, string>());

  jobsRef.current = jobs;

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    // Thumbnails are a cheap `createObjectURL` per file (the browser
    // decodes only what it actually renders), never the full
    // loadRaster/createVectorResult pipeline -- that only ever runs once,
    // for real, at convert time, and never stores its result beyond
    // `{ svg, width, height }`.
    const urls = objectUrlsRef.current;
    for (const job of jobs) {
      if (!urls.has(job.id)) urls.set(job.id, URL.createObjectURL(job.file));
    }
    for (const id of [...urls.keys()]) {
      if (!jobs.some((job) => job.id === id)) {
        URL.revokeObjectURL(urls.get(id)!);
        urls.delete(id);
      }
    }
  }, [jobs]);

  useEffect(() => () => {
    for (const url of objectUrlsRef.current.values()) URL.revokeObjectURL(url);
  }, []);

  const changeLanguage = (next: Language) => {
    setLanguage(next);
    const url = new URL(window.location.href);
    if (next === "ko") url.searchParams.set("lang", "ko");
    else url.searchParams.delete("lang");
    window.history.replaceState(null, "", url);
  };

  const addFiles = useCallback((incoming: FileList | File[] | null) => {
    if (!incoming || incoming.length === 0) return;
    const files = Array.from(incoming);
    const { accepted, rejectedType, overflow } = partitionIncomingBulkFiles(files, jobsRef.current.length);
    if (accepted.length > 0) {
      const added = createBulkJobs(accepted, nextJobId.current);
      nextJobId.current += added.length;
      setJobs((current) => [...current, ...added]);
    }
    const notices: string[] = [];
    if (rejectedType.length > 0) notices.push(content.tooManyType(rejectedType.length));
    if (overflow.length > 0) notices.push(content.tooManyOverflow(overflow.length));
    setSkipNotice(notices.join(" "));
  }, [content]);

  const clearAll = () => {
    setJobs([]);
    setSkipNotice("");
  };

  const runConversion = useCallback(async (targetJobs: BulkJob[]) => {
    cancelRef.current = false;
    setIsConverting(true);
    await runBulkQueue(targetJobs, {
      concurrency: BULK_CONCURRENCY,
      isCancelled: () => cancelRef.current,
      convert: (job) => convertBulkFile(job.file, colorCount, BULK_CLEANUP, BULK_ANCHOR_SIMPLIFICATION),
      onJobUpdate: (updated) => {
        setJobs((current) => current.map((job) => (job.id === updated.id ? updated : job)));
      },
    });
    setIsConverting(false);
  }, [colorCount]);

  const convertAll = () => {
    const pending = jobsRef.current.filter(isBulkJobPending);
    if (pending.length === 0) return;
    void runConversion(pending);
  };

  const cancelConversion = () => {
    cancelRef.current = true;
  };

  const retryJob = (id: number) => {
    setJobs((current) => resetBulkJobToQueued(current, id));
    const job = jobsRef.current.find((candidate) => candidate.id === id);
    if (job) void runConversion([{ ...job, status: "queued", error: null }]);
  };

  const retryFailed = () => {
    setJobs((current) => resetFailedBulkJobsToQueued(current));
    const failed = jobsRef.current.filter((job) => job.status === "failed").map((job) => ({ ...job, status: "queued" as const, error: null }));
    if (failed.length > 0) void runConversion(failed);
  };

  const usedFilenamesRef = useRef(new Set<string>());

  const downloadJobSvg = async (job: BulkJob) => {
    if (!job.svg) return;
    const baseName = sanitizeBulkFilenameBase(job.name.replace(/\.[^.]+$/, ""));
    const filename = buildBulkSvgFilename(baseName, usedFilenamesRef.current);
    const status = await downloadBlob(new Blob([job.svg], { type: "image/svg+xml" }), filename, "SVG artwork");
    if (status !== "cancelled") usedFilenamesRef.current.add(filename.toLowerCase());
  };

  const downloadAllZip = async () => {
    const entries = jobs.filter((job) => job.selected && job.status === "done" && job.svg).map((job) => ({ name: job.name, svg: job.svg as string }));
    if (entries.length === 0) return;
    const zipBytes = buildBulkZip(entries);
    await downloadBlob(new Blob([zipBytes as Uint8Array<ArrayBuffer>], { type: "application/zip" }), BULK_ZIP_FILENAME, "ZIP archive");
  };

  const progress = bulkProgress(jobs);
  const hasFailed = jobs.some((job) => job.status === "failed");
  const hasDownloadable = jobs.some((job) => job.selected && job.status === "done");

  return (
    <main className="bulk-page" lang={language}>
      <header className="bulk-topbar">
        <a className="bulk-brand" href={language === "ko" ? "/?lang=ko" : "/"} aria-label={content.back}>
          <img src="/logo.png" alt="WOOJOO Image" />
        </a>
        <a className="bulk-back" href={language === "ko" ? "/?lang=ko" : "/"}><ArrowLeft size={17} />{content.back}</a>
        <div className="bulk-privacy"><LockKeyhole size={16} />{content.privacy}</div>
        <nav className="bulk-language" aria-label={language === "ko" ? "언어 선택" : "Language selection"}>
          <button type="button" className={language === "en" ? "active" : ""} onClick={() => changeLanguage("en")}>ENG</button>
          <span>/</span>
          <button type="button" className={language === "ko" ? "active" : ""} onClick={() => changeLanguage("ko")}>한국어</button>
        </nav>
      </header>

      <section className="bulk-heading">
        <span className="bulk-eyebrow"><Languages size={13} />{content.eyebrow}</span>
        <h1>{content.title}</h1>
        <p>{content.intro}</p>
        <span className="bulk-route-status">{content.status}</span>
      </section>

      <section
        className={`bulk-dropzone ${dragging ? "dragging" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={content.dropTitle}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInput.current?.click(); }}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
      >
        <span className="bulk-upload-icon"><UploadCloud size={28} /></span>
        <strong>{content.dropTitle}</strong>
        <p>{content.dropHint}</p>
        <span className="bulk-formats">{content.formats}</span>
      </section>
      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }}
      />
      {skipNotice && <p className="bulk-skip-notice" role="alert">{skipNotice}</p>}

      {jobs.length > 0 && (
        <>
          <section className="bulk-settings">
            <h2>{content.settingsTitle}</h2>
            <div className="bulk-setting-row">
              <label htmlFor="bulk-color-count">{content.colorCountLabel}</label>
              <input id="bulk-color-count" type="range" min="2" max="20" value={colorCount} onChange={(event) => setColorCount(Number(event.target.value))} />
              <span className="bulk-color-count-value">{colorCount}</span>
            </div>
          </section>

          <section className="bulk-toolbar">
            <div className="bulk-toolbar-group">
              <button type="button" onClick={() => setJobs(selectAllBulkJobs(jobs))}><Check size={14} />{content.selectAll}</button>
              <button type="button" onClick={() => setJobs(deselectAllBulkJobs(jobs))}>{content.deselectAll}</button>
              <button type="button" onClick={() => fileInput.current?.click()}><UploadCloud size={14} />{content.addMore}</button>
              <button type="button" onClick={clearAll}><Trash2 size={14} />{content.clearAll}</button>
            </div>
            <div className="bulk-toolbar-group">
              {!isConverting ? (
                <button type="button" className="bulk-primary" disabled={!jobs.some(isBulkJobPending)} onClick={convertAll}><Loader2 size={14} />{content.convertAll}</button>
              ) : (
                <button type="button" className="bulk-primary" onClick={cancelConversion}><XCircle size={14} />{content.cancel}</button>
              )}
              {hasFailed && !isConverting && <button type="button" onClick={retryFailed}><RefreshCw size={14} />{content.retryFailed}</button>}
              <button type="button" disabled={!hasDownloadable} onClick={() => void downloadAllZip()}><FolderArchive size={14} />{content.downloadAll}</button>
            </div>
          </section>

          <section className="bulk-progress">
            {isConverting && <Loader2 size={15} className="bulk-spin" />}
            <span>{content.progress(progress.done, progress.total)}</span>
            {progress.failed > 0 && <span className="bulk-progress-failed">{content.failedCount(progress.failed)}</span>}
          </section>

          <section className="bulk-job-list">
            {jobs.map((job) => (
              <article className={`bulk-job-row bulk-job-${job.status}`} key={job.id}>
                <input
                  type="checkbox"
                  checked={job.selected}
                  onChange={() => setJobs(toggleBulkJobSelected(jobs, job.id))}
                  aria-label={job.name}
                />
                <span className="bulk-job-thumb">
                  <img src={objectUrlsRef.current.get(job.id)} alt="" onLoad={(event) => {
                    const img = event.currentTarget;
                    if (job.width == null) setJobs((current) => current.map((candidate) => (candidate.id === job.id && candidate.width == null ? { ...candidate, width: img.naturalWidth, height: img.naturalHeight } : candidate)));
                  }} />
                </span>
                <span className="bulk-job-name">
                  <FileImage size={14} />
                  <b>{job.name}</b>
                  {job.width != null && job.height != null && <small>{job.width} × {job.height}</small>}
                </span>
                <span className={`bulk-job-status bulk-status-${job.status}`}>
                  {job.status === "converting" && <Loader2 size={13} className="bulk-spin" />}
                  {job.status === "queued" && content.statusQueued}
                  {job.status === "converting" && content.statusConverting}
                  {job.status === "done" && <><Check size={13} />{content.statusDone}</>}
                  {job.status === "failed" && content.statusFailed}
                </span>
                <span className="bulk-job-actions">
                  {job.status === "done" && <button type="button" onClick={() => void downloadJobSvg(job)}><Download size={13} />{content.downloadSvg}</button>}
                  {job.status === "failed" && <button type="button" onClick={() => retryJob(job.id)}><RefreshCw size={13} />{content.retry}</button>}
                  <button type="button" aria-label={content.remove} onClick={() => setJobs(removeBulkJob(jobs, job.id))}><X size={14} /></button>
                </span>
              </article>
            ))}
          </section>
        </>
      )}

      {jobs.length === 0 && <p className="bulk-empty"><RotateCcw size={14} />{content.jobsEmpty}</p>}
    </main>
  );
}
