"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Crop,
  Download,
  Eye,
  FileImage,
  ImagePlus,
  Lock,
  LockKeyhole,
  Layers3,
  Merge,
  Paintbrush,
  Redo2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  SwatchBook,
  Trash2,
  Undo2,
  Unlock,
  UploadCloud,
  X,
} from "lucide-react";
import {
  applyPreset,
  CleanupLevel,
  createVectorResult,
  cropSvg,
  CropBox,
  deleteColors,
  downloadPng,
  downloadText,
  extractObjectResult,
  formatBytes,
  getSeparateObjectBounds,
  getVisibleBounds,
  hexToRgb,
  highlightSvg,
  loadRaster,
  mergeResult,
  PaletteColor,
  RasterSource,
  recolorResult,
  VectorResult,
  MAX_VECTOR_OBJECTS,
} from "./vector-utils";

const steps = ["Upload", "Colors", "Edit", "Crop", "Export"];
const cleanupLevels: { value: CleanupLevel; label: string }[] = [
  { value: "none", label: "Detail" },
  { value: "light", label: "Clean" },
  { value: "medium", label: "Smooth" },
  { value: "strong", label: "Ultra" },
];
const presets = {
  original: { label: "Original palette", colors: [] },
  coastal: { label: "Coastal", colors: ["#183B4E", "#3F7C85", "#91C8C4", "#E7E2D5", "#F4A261"] },
  harvest: { label: "Warm harvest", colors: ["#3B2F2F", "#8C3B2A", "#D8763B", "#E9B872", "#F7EBD8"] },
  botanical: { label: "Botanical", colors: ["#1F3D34", "#477D62", "#8DB596", "#D8E2C6", "#F4E9D8"] },
  mono: { label: "Ink & paper", colors: ["#202725", "#59635F", "#A8AFAB", "#E1E2DC", "#FAF8F0"] },
};

type Snapshot = { palette: PaletteColor[]; pixelMap: Uint8Array };
type ViewMode = "original" | "reduced" | "vector";
type BrushTool = "protect" | "unprotect";

function cleanFilename(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]+/g, "-") || "vector-artwork";
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const protectionCanvas = useRef<HTMLCanvasElement>(null);
  const protectedMask = useRef(new Uint8Array());
  const brushing = useRef(false);
  const lastBrushPoint = useRef<{ x: number; y: number } | null>(null);
  const history = useRef<Snapshot[]>([]);
  const historyIndex = useRef(-1);
  const initialPalette = useRef<PaletteColor[]>([]);
  const [source, setSource] = useState<RasterSource | null>(null);
  const [result, setResult] = useState<VectorResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [colorCount, setColorCount] = useState(8);
  const [cleanup, setCleanup] = useState<CleanupLevel>("strong");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("vector");
  const [selectedColors, setSelectedColors] = useState<number[]>([]);
  const [preset, setPreset] = useState<keyof typeof presets>("original");
  const [historyStatus, setHistoryStatus] = useState({ index: -1, length: 0 });
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState<CropBox>({ x: 0, y: 0, width: 1, height: 1 });
  const [pngScale, setPngScale] = useState(2);
  const [exportState, setExportState] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [brushMode, setBrushMode] = useState(false);
  const [brushTool, setBrushTool] = useState<BrushTool>("protect");
  const [brushSize, setBrushSize] = useState(42);
  const [protectedCount, setProtectedCount] = useState(0);
  const [maskRevision, setMaskRevision] = useState(0);
  const [selectedObjectIndex, setSelectedObjectIndex] = useState<number | null>(null);

  const currentStep = cropOpen ? 4 : result ? 2 : source ? 1 : 0;

  const clearProtection = useCallback(() => {
    protectedMask.current = new Uint8Array(result?.pixelMap.length ?? 0);
    setProtectedCount(0);
    setMaskRevision((current) => current + 1);
  }, [result?.pixelMap.length]);

  const pushHistory = useCallback((next: VectorResult) => {
    const snapshots = history.current.slice(0, historyIndex.current + 1);
    snapshots.push({ palette: next.palette.map((color) => ({ ...color })), pixelMap: next.pixelMap.slice() });
    history.current = snapshots.slice(-30);
    historyIndex.current = history.current.length - 1;
    setHistoryStatus({ index: historyIndex.current, length: history.current.length });
  }, []);

  const acceptFile = useCallback(async (file?: File) => {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const loaded = await loadRaster(file);
      setFileName(file.name);
      setSource(loaded);
      setResult(null);
      history.current = [];
      historyIndex.current = -1;
      setHistoryStatus({ index: -1, length: 0 });
      setSelectedColors([]);
      setBrushMode(false);
      protectedMask.current = new Uint8Array();
      setProtectedCount(0);
      setMaskRevision((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't read this image.");
    } finally {
      setBusy(false);
    }
  }, []);

  const runConversion = useCallback(async () => {
    if (!source) return;
    setBusy(true);
    setError("");
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    try {
      const converted = createVectorResult(source, colorCount, cleanup);
      setResult(converted);
      initialPalette.current = converted.palette.map((color) => ({ ...color }));
      history.current = [];
      historyIndex.current = -1;
      pushHistory(converted);
      setViewMode("vector");
      setPreset("original");
      protectedMask.current = new Uint8Array(converted.pixelMap.length);
      setProtectedCount(0);
      setBrushMode(false);
      setMaskRevision((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Vector conversion failed.");
    } finally {
      setBusy(false);
    }
  }, [cleanup, colorCount, pushHistory, source]);

  const commitResult = useCallback(async (next: VectorResult) => {
    setBusy(true);
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    setResult(next);
    pushHistory(next);
    setBusy(false);
  }, [pushHistory]);

  const updateColor = useCallback(async (index: number, hex: string) => {
    if (!result || result.palette[index]?.locked) return;
    const rgb = hexToRgb(hex);
    const palette = result.palette.map((color, colorIndex) => colorIndex === index ? { ...color, ...rgb, hex: hex.toUpperCase() } : { ...color });
    await commitResult(recolorResult(result, palette, cleanup));
  }, [cleanup, commitResult, result]);

  const toggleLock = useCallback((index: number) => {
    if (!result) return;
    const palette = result.palette.map((color, colorIndex) => colorIndex === index ? { ...color, locked: !color.locked } : color);
    const next = { ...result, palette };
    setResult(next);
    pushHistory(next);
  }, [pushHistory, result]);

  const mergeSelected = useCallback(async () => {
    if (!result || selectedColors.length < 2) return;
    await commitResult(mergeResult(result, selectedColors, cleanup));
    setSelectedColors([]);
    clearProtection();
  }, [cleanup, clearProtection, commitResult, result, selectedColors]);

  const deleteSelected = useCallback(async () => {
    if (!result || !selectedColors.length || selectedColors.length >= result.palette.length) return;
    await commitResult(deleteColors(result, selectedColors, cleanup, protectedMask.current));
    setSelectedColors([]);
    setBrushMode(false);
    clearProtection();
  }, [cleanup, clearProtection, commitResult, result, selectedColors]);

  const toggleColorSelection = useCallback((index: number) => {
    setViewMode("vector");
    setBrushMode(false);
    setSelectedColors((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index]);
  }, []);

  const renderProtectionPatch = useCallback((minX: number, minY: number, maxX: number, maxY: number) => {
    if (!result || !protectionCanvas.current) return;
    const context = protectionCanvas.current.getContext("2d");
    if (!context) return;
    const width = Math.max(1, maxX - minX + 1);
    const height = Math.max(1, maxY - minY + 1);
    const patch = context.createImageData(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourcePixel = (minY + y) * result.width + minX + x;
        if (!protectedMask.current[sourcePixel]) continue;
        const offset = (y * width + x) * 4;
        patch.data[offset] = 29;
        patch.data[offset + 1] = 151;
        patch.data[offset + 2] = 116;
        patch.data[offset + 3] = 145;
      }
    }
    context.putImageData(patch, minX, minY);
  }, [result]);

  const brushAt = useCallback((x: number, y: number) => {
    if (!result || !selectedColors.length) return;
    const selected = new Set(selectedColors);
    const radius = Math.max(2, brushSize / 2);
    const minX = Math.max(0, Math.floor(x - radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxX = Math.min(result.width - 1, Math.ceil(x + radius));
    const maxY = Math.min(result.height - 1, Math.ceil(y + radius));
    let countDelta = 0;

    for (let pixelY = minY; pixelY <= maxY; pixelY += 1) {
      for (let pixelX = minX; pixelX <= maxX; pixelX += 1) {
        const dx = pixelX - x;
        const dy = pixelY - y;
        if (dx * dx + dy * dy > radius * radius) continue;
        const pixel = pixelY * result.width + pixelX;
        if (!selected.has(result.pixelMap[pixel])) continue;
        const nextValue = brushTool === "protect" ? 1 : 0;
        if (protectedMask.current[pixel] === nextValue) continue;
        protectedMask.current[pixel] = nextValue;
        countDelta += nextValue ? 1 : -1;
      }
    }
    if (countDelta) setProtectedCount((current) => Math.max(0, current + countDelta));
    renderProtectionPatch(minX, minY, maxX, maxY);
  }, [brushSize, brushTool, renderProtectionPatch, result, selectedColors]);

  const pointerToImage = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!result || !previewRef.current) return null;
    const bounds = previewRef.current.getBoundingClientRect();
    const imageRatio = result.width / result.height;
    const boxRatio = bounds.width / bounds.height;
    const renderedWidth = imageRatio > boxRatio ? bounds.width : bounds.height * imageRatio;
    const renderedHeight = imageRatio > boxRatio ? bounds.width / imageRatio : bounds.height;
    const left = bounds.left + (bounds.width - renderedWidth) / 2;
    const top = bounds.top + (bounds.height - renderedHeight) / 2;
    const x = ((event.clientX - left) / renderedWidth) * result.width;
    const y = ((event.clientY - top) / renderedHeight) * result.height;
    if (x < 0 || y < 0 || x >= result.width || y >= result.height) return null;
    return { x, y };
  }, [result]);

  const continueBrush = useCallback((point: { x: number; y: number }) => {
    const previous = lastBrushPoint.current;
    if (!previous) {
      brushAt(point.x, point.y);
      lastBrushPoint.current = point;
      return;
    }
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(2, brushSize / 5)));
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      brushAt(previous.x + (point.x - previous.x) * progress, previous.y + (point.y - previous.y) * progress);
    }
    lastBrushPoint.current = point;
  }, [brushAt, brushSize]);

  const startBrush = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!brushMode) return;
    const point = pointerToImage(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    brushing.current = true;
    lastBrushPoint.current = null;
    continueBrush(point);
  }, [brushMode, continueBrush, pointerToImage]);

  const moveBrush = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!brushing.current) return;
    const point = pointerToImage(event);
    if (point) continueBrush(point);
  }, [continueBrush, pointerToImage]);

  const stopBrush = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    brushing.current = false;
    lastBrushPoint.current = null;
  }, []);

  useEffect(() => {
    const canvas = protectionCanvas.current;
    if (!canvas || !result) return;
    canvas.width = result.width;
    canvas.height = result.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, result.width, result.height);
    renderProtectionPatch(0, 0, result.width - 1, result.height - 1);
  }, [maskRevision, renderProtectionPatch, result, viewMode]);

  const applyChosenPreset = useCallback(async () => {
    if (!result) return;
    if (preset === "original") {
      const restored = result.palette.map((color) => {
        const original = initialPalette.current.find((item) => item.id === color.id);
        return color.locked || !original ? color : ({ ...color, ...original, locked: color.locked });
      });
      await commitResult(recolorResult(result, restored, cleanup));
      return;
    }
    await commitResult(applyPreset(result, presets[preset].colors, cleanup));
  }, [cleanup, commitResult, preset, result]);

  const restoreHistory = useCallback((direction: -1 | 1) => {
    if (!result) return;
    const nextIndex = historyIndex.current + direction;
    const snapshot = history.current[nextIndex];
    if (!snapshot) return;
    historyIndex.current = nextIndex;
    setHistoryStatus({ index: nextIndex, length: history.current.length });
    const restoredBase = { ...result, pixelMap: snapshot.pixelMap.slice() };
    setResult(recolorResult(restoredBase, snapshot.palette.map((color) => ({ ...color })), cleanup));
    setSelectedColors([]);
    clearProtection();
  }, [cleanup, clearProtection, result]);

  const openCrop = useCallback(() => {
    if (!result) return;
    setCrop({ x: 0, y: 0, width: result.width, height: result.height });
    setExportMessage("");
    setSelectedObjectIndex(null);
    setCropOpen(true);
  }, [result]);

  const setRatio = useCallback((ratio: number | null) => {
    if (!result) return;
    if (!ratio) {
      setCrop({ x: 0, y: 0, width: result.width, height: result.height });
      return;
    }
    const imageRatio = result.width / result.height;
    let width = result.width;
    let height = result.height;
    if (imageRatio > ratio) width = height * ratio;
    else height = width / ratio;
    setCrop({ x: (result.width - width) / 2, y: (result.height - height) / 2, width, height });
  }, [result]);

  const autoCropBounds = useMemo(() => result ? getVisibleBounds(result) : null, [result]);
  const separateObjects = useMemo(() => result && cropOpen ? getSeparateObjectBounds(result) : [], [cropOpen, result]);
  const selectedObjectResult = useMemo(() => {
    if (!result || selectedObjectIndex === null || !separateObjects[selectedObjectIndex]) return null;
    return extractObjectResult(result, separateObjects[selectedObjectIndex], cleanup);
  }, [cleanup, result, selectedObjectIndex, separateObjects]);
  const hasTransparentTrim = useMemo(() => !!result && !!autoCropBounds && (
    autoCropBounds.x > 0 || autoCropBounds.y > 0 ||
    autoCropBounds.x + autoCropBounds.width < result.width ||
    autoCropBounds.y + autoCropBounds.height < result.height
  ), [autoCropBounds, result]);

  const autoCrop = useCallback(() => {
    if (!autoCropBounds) return;
    setCrop(autoCropBounds);
    setExportMessage("Transparent outer area cropped automatically.");
  }, [autoCropBounds]);

  const cropInsets = useMemo(() => result ? {
    left: Math.round(crop.x),
    top: Math.round(crop.y),
    right: Math.max(0, Math.round(result.width - crop.x - crop.width)),
    bottom: Math.max(0, Math.round(result.height - crop.y - crop.height)),
  } : { left: 0, top: 0, right: 0, bottom: 0 }, [crop, result]);

  const updateInset = useCallback((side: "left" | "top" | "right" | "bottom", value: number) => {
    if (!result) return;
    const next = { ...cropInsets, [side]: value };
    const width = Math.max(1, result.width - next.left - next.right);
    const height = Math.max(1, result.height - next.top - next.bottom);
    setCrop({ x: next.left, y: next.top, width, height });
  }, [cropInsets, result]);

  const exportSvg = useCallback(async () => {
    if (!result) return;
    setExportState("svg");
    setExportMessage("");
    try {
      const status = await downloadText(cropSvg(result.svg, crop), `${cleanFilename(fileName)}.svg`, "image/svg+xml");
      if (status !== "cancelled") setExportMessage(status === "saved" ? "SVG saved successfully." : "SVG download started.");
    } catch (caught) {
      setExportMessage(caught instanceof Error ? caught.message : "SVG download failed. Please try again.");
    } finally {
      setExportState("");
    }
  }, [crop, fileName, result]);

  const exportPng = useCallback(async () => {
    if (!result) return;
    setExportState("png");
    setExportMessage("");
    try {
      const status = await downloadPng(result.svg, crop, pngScale, `${cleanFilename(fileName)}-${pngScale}x.png`);
      if (status !== "cancelled") setExportMessage(status === "saved" ? `PNG ${pngScale}× saved successfully.` : `PNG ${pngScale}× download started.`);
    } catch (caught) {
      setExportMessage(caught instanceof Error ? caught.message : "PNG download failed. Please try again.");
    } finally {
      setExportState("");
    }
  }, [crop, fileName, pngScale, result]);

  const exportObjectSvg = useCallback(async (objectCrop: (typeof separateObjects)[number], index: number) => {
    if (!result) return;
    const state = `object-svg-${index}`;
    setExportState(state);
    setExportMessage("");
    try {
      const isolated = extractObjectResult(result, objectCrop, cleanup);
      const status = await downloadText(isolated.svg, `${cleanFilename(fileName)}-object-${index + 1}.svg`, "image/svg+xml");
      if (status !== "cancelled") setExportMessage(`Object ${index + 1} SVG ${status === "saved" ? "saved" : "download started"}.`);
    } catch (caught) {
      setExportMessage(caught instanceof Error ? caught.message : `Object ${index + 1} SVG download failed.`);
    } finally {
      setExportState("");
    }
  }, [cleanup, fileName, result]);

  const exportObjectPng = useCallback(async (objectCrop: (typeof separateObjects)[number], index: number) => {
    if (!result) return;
    const state = `object-png-${index}`;
    setExportState(state);
    setExportMessage("");
    try {
      const isolated = extractObjectResult(result, objectCrop, cleanup);
      const isolatedCrop = { x: 0, y: 0, width: isolated.width, height: isolated.height };
      const status = await downloadPng(isolated.svg, isolatedCrop, pngScale, `${cleanFilename(fileName)}-object-${index + 1}-${pngScale}x.png`);
      if (status !== "cancelled") setExportMessage(`Object ${index + 1} PNG ${status === "saved" ? "saved" : "download started"}.`);
    } catch (caught) {
      setExportMessage(caught instanceof Error ? caught.message : `Object ${index + 1} PNG download failed.`);
    } finally {
      setExportState("");
    }
  }, [cleanup, fileName, pngScale, result]);

  const previewSvg = useMemo(() => result ? highlightSvg(result.svg, selectedColors) : "", [result, selectedColors]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="WOOJOO Path home">
          <span className="brand-mark"><Sparkles size={18} strokeWidth={2.4} /></span>
          <span>WOOJOO Path</span>
          <em>by Jookland</em>
        </a>
        <div className="privacy-note"><ShieldCheck size={16} /><span>Your image stays on this device</span></div>
        <span className="beta-badge">MVP BETA</span>
      </header>

      <section className="workflow-header">
        <div>
          <span className="eyebrow">RASTER TO VECTOR</span>
          <h1>{result ? "Refine your vector palette." : "Turn artwork into a clean, editable SVG."}</h1>
          <p>{result ? "Click any swatch to recolor every matching shape, merge colors, then crop and export." : "Reduce colors, refine your palette, crop, and export — all in one private workspace."}</p>
        </div>
        <nav className="steps" aria-label="Conversion progress">
          {steps.map((step, index) => (
            <div className={`step ${index <= currentStep ? "active" : ""}`} key={step}>
              <span>{index < currentStep ? <Check size={13} /> : index + 1}</span><b>{step}</b>
            </div>
          ))}
        </nav>
      </section>

      {!result ? (
        <section className="workspace-grid">
          <div className="canvas-card">
            <div className="card-heading">
              <div><span className="step-label">STEP 1</span><h2>Upload your artwork</h2></div>
              {source && <button className="text-button" type="button" onClick={() => fileInput.current?.click()}><RotateCcw size={15}/> Replace</button>}
            </div>
            <button
              className={`dropzone ${isDragging ? "dragging" : ""} ${source ? "has-image" : ""}`}
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => { event.preventDefault(); setIsDragging(false); void acceptFile(event.dataTransfer.files[0]); }}
            >
              {source ? (
                <><span className="checkerboard"><img src={source.previewUrl} alt={`Preview of ${fileName}`} /></span><span className="file-pill"><ImagePlus size={15}/>{fileName}<small>{source.width} × {source.height}px</small></span></>
              ) : (
                <><span className="upload-icon"><UploadCloud size={28} /></span><strong>{busy ? "Reading your image…" : "Drop your image here"}</strong><p>or click to choose a file</p><span className="formats">PNG · JPG · WEBP · up to 20 MB</span></>
              )}
            </button>
            <input ref={fileInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void acceptFile(event.target.files?.[0])}/>
            {error && <p className="error-message">{error}</p>}
            <div className="local-processing"><LockKeyhole size={15}/><span><b>Private by design.</b> Nothing is uploaded or stored.</span></div>
          </div>

          <aside className="settings-card">
            <div className="card-heading compact"><div><span className="step-label">STEP 2</span><h2>Vector settings</h2></div></div>
            <div className="setting-row"><div><label htmlFor="color-count">Number of colors</label><small>Visible colors, excluding transparency</small></div><span className="value-box">{colorCount}</span></div>
            <input id="color-count" className="range-control" type="range" min="2" max="20" value={colorCount} onChange={(event) => setColorCount(Number(event.target.value))}/>
            <div className="setting-row"><div><label>Vector smoothness</label><small>Fewer anchors joined with smooth Bézier curves</small></div></div>
            <div className="segmented">{cleanupLevels.map((level) => <button className={cleanup === level.value ? "selected" : ""} type="button" key={level.value} onClick={() => setCleanup(level.value)}>{level.label}</button>)}</div>
            <div className="tip-card"><Sparkles size={16}/><p><b>Tip:</b> Ultra removes small detail while keeping rounded contours curved. Choose Smooth when small eyes or lettering must remain.</p></div>
            <button className="primary-button" type="button" disabled={!source || busy} onClick={() => void runConversion()}><SwatchBook size={17}/>{busy ? "Building your palette…" : "Reduce colors & vectorize"}</button>
            <p className="button-hint">Transparent outer edges are trimmed automatically.</p>
          </aside>
        </section>
      ) : (
        <section className="editor-grid">
          <div className="preview-card">
            <div className="editor-toolbar">
              <button className="back-button" type="button" onClick={() => setResult(null)}><ArrowLeft size={16}/> Settings</button>
              <div className="view-tabs" role="tablist" aria-label="Preview mode">
                {(["original", "reduced", "vector"] as ViewMode[]).map((mode) => <button className={viewMode === mode ? "active" : ""} type="button" role="tab" key={mode} onClick={() => setViewMode(mode)}>{mode === "original" ? "Original" : mode === "reduced" ? "Reduced" : "SVG"}</button>)}
              </div>
              <span className="zoom-label">FIT</span>
            </div>
            <div className={`artboard ${busy ? "processing" : ""}`}>
              {viewMode === "original" && <img src={source?.previewUrl} alt="Original artwork" />}
              {viewMode === "reduced" && <img src={result.previewUrl} alt="Color-reduced artwork" />}
              {viewMode === "vector" && (
                <div ref={previewRef} className={`svg-preview ${selectedColors.length ? "showing-selection" : ""} ${brushMode ? "brush-active" : ""}`} aria-label="SVG preview">
                  <div className="svg-artwork" dangerouslySetInnerHTML={{ __html: previewSvg }} />
                  <canvas
                    ref={protectionCanvas}
                    className="protection-canvas"
                    aria-label="Brush over highlighted color areas to exclude them from deletion"
                    onPointerDown={startBrush}
                    onPointerMove={moveBrush}
                    onPointerUp={stopBrush}
                    onPointerCancel={stopBrush}
                  />
                </div>
              )}
              {!!selectedColors.length && !busy && <span className="selection-badge"><Eye size={14}/>{selectedColors.length} color{selectedColors.length > 1 ? "s" : ""} highlighted</span>}
              {busy && <span className="processing-badge"><Sparkles size={15}/> Updating vector…</span>}
            </div>
            <div className="stats-bar">
              <span><SwatchBook size={16}/><b>{result.palette.length}</b> colors</span>
              <span><Merge size={16}/><b>{result.pathCount}/{MAX_VECTOR_OBJECTS}</b> objects max</span>
              <span><Sparkles size={16}/><b>{result.nodeCount.toLocaleString()}</b> nodes</span>
              <span><FileImage size={16}/><b>{formatBytes(result.fileSize)}</b> SVG</span>
              <span><Layers3 size={16}/><b>Dominant base</b> gap fill</span>
              <span className="dimension-stat">{result.width} × {result.height}px</span>
            </div>
          </div>

          <aside className="palette-card">
            <div className="palette-heading">
              <div><span className="step-label">STEP 3</span><h2>Edit palette</h2></div>
              <div className="history-buttons">
                <button aria-label="Undo" type="button" disabled={historyStatus.index <= 0} onClick={() => restoreHistory(-1)}><Undo2 size={15}/></button>
                <button aria-label="Redo" type="button" disabled={historyStatus.index >= historyStatus.length - 1} onClick={() => restoreHistory(1)}><Redo2 size={15}/></button>
              </div>
            </div>
            <div className="preset-row">
              <div className="select-wrap"><select aria-label="Palette preset" value={preset} onChange={(event) => setPreset(event.target.value as keyof typeof presets)}>{Object.entries(presets).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select><ChevronDown size={14}/></div>
              <button className="secondary-button" type="button" onClick={() => void applyChosenPreset()}>Apply</button>
            </div>
            <p className="palette-help"><b>Select a color to highlight its exact area.</b> Select several to compare, merge, or delete them.</p>
            <div className="palette-list">
              {result.palette.map((color, index) => (
                <div className={`palette-item ${selectedColors.includes(index) ? "selected" : ""}`} key={color.id}>
                  <button className="select-dot" aria-label={`${selectedColors.includes(index) ? "Hide" : "Highlight"} ${color.hex} area`} type="button" onClick={() => toggleColorSelection(index)}>{selectedColors.includes(index) ? <Check size={11}/> : <Eye size={11}/>}</button>
                  <label className="swatch" style={{ backgroundColor: color.hex }} aria-label={`Change ${color.hex}`}><input type="color" value={color.hex} disabled={color.locked || busy} onChange={(event) => void updateColor(index, event.target.value)}/></label>
                  <button className="color-meta" type="button" onClick={() => toggleColorSelection(index)}><strong>{color.hex}</strong><span>{color.share.toFixed(1)}% of image</span>{color.backgroundCandidate && <em>Likely background</em>}</button>
                  <div className="share-track"><i style={{ width: `${Math.max(3, color.share)}%`, backgroundColor: color.hex }}/></div>
                  <button className="lock-button" aria-label={color.locked ? `Unlock ${color.hex}` : `Lock ${color.hex}`} type="button" onClick={() => toggleLock(index)}>{color.locked ? <Lock size={14}/> : <Unlock size={14}/>}</button>
                </div>
              ))}
            </div>
            <div className={`brush-panel ${brushMode ? "active" : ""}`}>
              <div className="brush-heading">
                <div><strong>Keep-area brush</strong><span>Brush parts of the selected color that must not be deleted.</span></div>
                <button className={brushMode ? "active" : ""} type="button" disabled={!selectedColors.length || busy} onClick={() => { setViewMode("vector"); setBrushMode((current) => !current); }}><Paintbrush size={14}/>{brushMode ? "Brush on" : "Use brush"}</button>
              </div>
              {brushMode && (
                <>
                  <div className="brush-tools">
                    <button className={brushTool === "protect" ? "active" : ""} type="button" onClick={() => setBrushTool("protect")}>Keep</button>
                    <button className={brushTool === "unprotect" ? "active" : ""} type="button" onClick={() => setBrushTool("unprotect")}>Undo brush</button>
                    <button type="button" disabled={!protectedCount} onClick={clearProtection}>Clear</button>
                  </div>
                  <label className="brush-size"><span>Brush size</span><input type="range" min="8" max="180" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))}/><output>{brushSize}px</output></label>
                  <p><i/> Teal areas are protected and will stay when you choose Delete selected. Drag across the preview with your mouse or finger.</p>
                </>
              )}
            </div>
            <div className="palette-actions">
              <button className="merge-button" type="button" disabled={selectedColors.length < 2 || busy} onClick={() => void mergeSelected()}><Merge size={16}/>Merge {selectedColors.length || "selected"}</button>
              <button className="delete-button" type="button" disabled={!selectedColors.length || selectedColors.length >= result.palette.length || busy || selectedColors.every((index) => result.palette[index]?.locked)} onClick={() => void deleteSelected()}><Trash2 size={15}/>Delete selected</button>
            </div>
            {result.palette.some((color) => color.backgroundCandidate) && <p className="background-tip">Tip: select <b>Likely background</b>, check the highlighted area, then choose Delete selected.</p>}
            <button className="primary-button export-next" type="button" onClick={openCrop}><Crop size={17}/>Final crop & export</button>
          </aside>
        </section>
      )}

      {cropOpen && result && (
        <div className="modal-backdrop" role="presentation">
          <section className="crop-modal" role="dialog" aria-modal="true" aria-labelledby="crop-title">
            <div className="modal-heading"><div><span className="step-label">STEP 4 & 5</span><h2 id="crop-title">Final crop & export</h2></div><button aria-label="Close crop dialog" type="button" onClick={() => setCropOpen(false)}><X size={19}/></button></div>
            <div className="crop-layout">
              <div className="crop-preview-wrap">
                <div className="crop-preview">
                  <div className={`crop-canvas ${selectedObjectResult ? "object-isolated-preview" : ""}`} style={{ aspectRatio: `${selectedObjectResult?.width ?? result.width} / ${selectedObjectResult?.height ?? result.height}`, width: (selectedObjectResult?.width ?? result.width) / (selectedObjectResult?.height ?? result.height) >= 4 / 3 ? "100%" : "auto", height: (selectedObjectResult?.width ?? result.width) / (selectedObjectResult?.height ?? result.height) >= 4 / 3 ? "auto" : "100%" }}>
                    <div className="crop-svg" dangerouslySetInnerHTML={{ __html: selectedObjectResult?.svg ?? result.svg }}/>
                    {!selectedObjectResult && (
                      <div className="crop-frame" style={{ left: `${(crop.x / result.width) * 100}%`, top: `${(crop.y / result.height) * 100}%`, width: `${(crop.width / result.width) * 100}%`, height: `${(crop.height / result.height) * 100}%` }}/>
                    )}
                    {selectedObjectResult && <span className="object-preview-badge"><Eye size={13}/>Object {(selectedObjectIndex ?? 0) + 1}</span>}
                  </div>
                </div>
                <p>{selectedObjectResult ? <>Only Object {(selectedObjectIndex ?? 0) + 1} is shown. <button type="button" onClick={() => setSelectedObjectIndex(null)}>Show all</button></> : "The bright area is your final canvas. SVG paths stay fully editable."}</p>
              </div>
              <div className="crop-controls">
                <div className="auto-crop-panel">
                  <div><label className="control-label">Transparent space</label><p>Fit the canvas to the remaining object after deleting a background color.</p></div>
                  <button type="button" disabled={!hasTransparentTrim} onClick={autoCrop}><Crop size={14}/>{hasTransparentTrim ? "Auto crop" : "Already fitted"}</button>
                </div>
                <label className="control-label">Aspect ratio</label>
                <div className="ratio-grid"><button type="button" onClick={() => setRatio(null)}>Free</button><button type="button" onClick={() => setRatio(1)}>1:1</button><button type="button" onClick={() => setRatio(4 / 5)}>4:5</button><button type="button" onClick={() => setRatio(3 / 2)}>3:2</button><button type="button" onClick={() => setRatio(210 / 297)}>A4</button></div>
                <div className="inset-heading"><label className="control-label">Crop edges</label><span>{Math.round(crop.width)} × {Math.round(crop.height)}</span></div>
                {(["left", "top", "right", "bottom"] as const).map((side) => {
                  const horizontal = side === "left" || side === "right";
                  const maximum = Math.max(0, Math.floor((horizontal ? result.width : result.height) * .48));
                  return <label className="inset-control" key={side}><span>{side[0].toUpperCase() + side.slice(1)}</span><input type="range" min="0" max={maximum} value={Math.min(cropInsets[side], maximum)} onChange={(event) => updateInset(side, Number(event.target.value))}/><output>{cropInsets[side]}px</output></label>;
                })}
                <button className="reset-crop" type="button" onClick={() => setRatio(null)}><RotateCcw size={14}/>Reset crop</button>
                <div className="export-section">
                  <div><label className="control-label">PNG size</label><div className="scale-buttons">{[1, 2, 4].map((scale) => <button className={pngScale === scale ? "active" : ""} type="button" key={scale} onClick={() => setPngScale(scale)}>{scale}×</button>)}</div></div>
                  <p>{Math.round(crop.width * pngScale)} × {Math.round(crop.height * pngScale)} px</p>
                </div>
                <div className="download-buttons"><button className="secondary-download" type="button" disabled={!!exportState} onClick={() => void exportSvg()}><Download size={16}/>{exportState === "svg" ? "Saving…" : "SVG"}</button><button className="primary-download" type="button" disabled={!!exportState} onClick={() => void exportPng()}><Download size={16}/>{exportState === "png" ? "Rendering…" : `PNG ${pngScale}×`}</button></div>
                {separateObjects.length > 1 && (
                  <div className="object-export-panel">
                    <div className="object-export-heading"><div><label className="control-label">Separate objects</label><p>{separateObjects.length} disconnected objects detected. Save each with its own fitted canvas.</p></div><Layers3 size={17}/></div>
                    <div className="object-export-list">
                      {separateObjects.map((objectCrop, index) => (
                        <div className={`object-export-row ${selectedObjectIndex === index ? "selected" : ""}`} key={`${objectCrop.x}-${objectCrop.y}-${index}`}>
                          <button className="object-preview-button" type="button" aria-pressed={selectedObjectIndex === index} onClick={() => setSelectedObjectIndex((current) => current === index ? null : index)}><b>{index + 1}</b><span>Object {index + 1}<small>{Math.round(objectCrop.width)} × {Math.round(objectCrop.height)}</small></span><Eye size={13}/></button>
                          <button type="button" disabled={!!exportState} onClick={() => void exportObjectSvg(objectCrop, index)}>{exportState === `object-svg-${index}` ? "Saving…" : "SVG"}</button>
                          <button type="button" disabled={!!exportState} onClick={() => void exportObjectPng(objectCrop, index)}>{exportState === `object-png-${index}` ? "Rendering…" : `PNG ${pngScale}×`}</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {exportMessage && <p className={`download-message ${exportMessage.toLowerCase().includes("failed") ? "error" : ""}`} role="status">{exportMessage}</p>}
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
