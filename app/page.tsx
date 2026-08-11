"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useMemo, useRef, useState } from "react";
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
  formatBytes,
  hexToRgb,
  highlightSvg,
  loadRaster,
  mergeResult,
  PaletteColor,
  RasterSource,
  recolorResult,
  VectorResult,
} from "./vector-utils";

const steps = ["Upload", "Colors", "Edit", "Crop", "Export"];
const cleanupLevels: { value: CleanupLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "light", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "strong", label: "Strong" },
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

function cleanFilename(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]+/g, "-") || "vector-artwork";
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const history = useRef<Snapshot[]>([]);
  const historyIndex = useRef(-1);
  const initialPalette = useRef<PaletteColor[]>([]);
  const [source, setSource] = useState<RasterSource | null>(null);
  const [result, setResult] = useState<VectorResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [colorCount, setColorCount] = useState(8);
  const [cleanup, setCleanup] = useState<CleanupLevel>("medium");
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
  const [exportState, setExportState] = useState<"" | "svg" | "png">("");
  const [exportMessage, setExportMessage] = useState("");

  const currentStep = cropOpen ? 4 : result ? 2 : source ? 1 : 0;

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
  }, [cleanup, commitResult, result, selectedColors]);

  const deleteSelected = useCallback(async () => {
    if (!result || !selectedColors.length || selectedColors.length >= result.palette.length) return;
    await commitResult(deleteColors(result, selectedColors, cleanup));
    setSelectedColors([]);
  }, [cleanup, commitResult, result, selectedColors]);

  const toggleColorSelection = useCallback((index: number) => {
    setViewMode("vector");
    setSelectedColors((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index]);
  }, []);

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
  }, [cleanup, result]);

  const openCrop = useCallback(() => {
    if (!result) return;
    setCrop({ x: 0, y: 0, width: result.width, height: result.height });
    setExportMessage("");
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

  const previewSvg = useMemo(() => result ? highlightSvg(result.svg, selectedColors) : "", [result, selectedColors]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Jookland Vector Studio home">
          <span className="brand-mark"><Sparkles size={18} strokeWidth={2.4} /></span>
          <span>Vector Studio</span>
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
            <div className="setting-row"><div><label>Clean up</label><small>Remove tiny speckles and short paths</small></div></div>
            <div className="segmented">{cleanupLevels.map((level) => <button className={cleanup === level.value ? "selected" : ""} type="button" key={level.value} onClick={() => setCleanup(level.value)}>{level.label}</button>)}</div>
            <div className="tip-card"><Sparkles size={16}/><p><b>Tip:</b> Use Medium for AI illustrations. Strong cleanup may remove tiny eyes or text.</p></div>
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
              {viewMode === "vector" && <div className={`svg-preview ${selectedColors.length ? "showing-selection" : ""}`} aria-label="SVG preview" dangerouslySetInnerHTML={{ __html: previewSvg }} />}
              {!!selectedColors.length && !busy && <span className="selection-badge"><Eye size={14}/>{selectedColors.length} color{selectedColors.length > 1 ? "s" : ""} highlighted</span>}
              {busy && <span className="processing-badge"><Sparkles size={15}/> Updating vector…</span>}
            </div>
            <div className="stats-bar">
              <span><SwatchBook size={16}/><b>{result.palette.length}</b> colors</span>
              <span><Merge size={16}/><b>{result.pathCount.toLocaleString()}</b> paths</span>
              <span><FileImage size={16}/><b>{formatBytes(result.fileSize)}</b> SVG</span>
              <span><Layers3 size={16}/><b>Largest first</b> layers</span>
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
                  <div className="crop-canvas" style={{ aspectRatio: `${result.width} / ${result.height}`, width: result.width / result.height >= 4 / 3 ? "100%" : "auto", height: result.width / result.height >= 4 / 3 ? "auto" : "100%" }}>
                    <div className="crop-svg" dangerouslySetInnerHTML={{ __html: result.svg }}/>
                    <div className="crop-frame" style={{ left: `${(crop.x / result.width) * 100}%`, top: `${(crop.y / result.height) * 100}%`, width: `${(crop.width / result.width) * 100}%`, height: `${(crop.height / result.height) * 100}%` }}/>
                  </div>
                </div>
                <p>The bright area is your final canvas. SVG paths stay fully editable.</p>
              </div>
              <div className="crop-controls">
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
                {exportMessage && <p className={`download-message ${exportMessage.toLowerCase().includes("failed") ? "error" : ""}`} role="status">{exportMessage}</p>}
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
