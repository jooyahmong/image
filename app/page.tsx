"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Crop,
  Download,
  Eye,
  FileImage,
  Hand,
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
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  applyPreset,
  CleanupLevel,
  createVectorResult,
  cropRasterSource,
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
} from "./vector-utils";

const steps = ["Upload", "Colors", "Edit", "Crop", "Export"];
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
type CropDragMode = "move" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type BrushPoint = { x: number; y: number; scale: number; radius: number };

function cleanFilename(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]+/g, "-") || "vector-artwork";
}

function smoothnessToCleanup(value: number): CleanupLevel {
  if (value <= 0) return "none";
  if (value < 35) return "light";
  if (value < 75) return "medium";
  return "strong";
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const sourceCropStage = useRef<HTMLSpanElement>(null);
  const sourceCropDrag = useRef<{
    mode: CropDragMode;
    startClientX: number;
    startClientY: number;
    startCrop: CropBox;
    renderedWidth: number;
    renderedHeight: number;
  } | null>(null);
  const panDrag = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);
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
  const [smoothness, setSmoothness] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("vector");
  const [selectedColors, setSelectedColors] = useState<number[]>([]);
  const [preset, setPreset] = useState<keyof typeof presets>("original");
  const [historyStatus, setHistoryStatus] = useState({ index: -1, length: 0 });
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState<CropBox>({ x: 0, y: 0, width: 1, height: 1 });
  const [sourceCrop, setSourceCrop] = useState<CropBox>({ x: 0, y: 0, width: 1, height: 1 });
  const [zoom, setZoom] = useState(100);
  const [panMode, setPanMode] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [pngScale, setPngScale] = useState(2);
  const [exportState, setExportState] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [brushMode, setBrushMode] = useState(false);
  const [brushTool, setBrushTool] = useState<BrushTool>("protect");
  const [brushSize, setBrushSize] = useState(42);
  const [brushCursor, setBrushCursor] = useState<BrushPoint | null>(null);
  const [protectedCount, setProtectedCount] = useState(0);
  const [maskRevision, setMaskRevision] = useState(0);
  const [selectedObjectIndex, setSelectedObjectIndex] = useState<number | null>(null);
  const colorSliderProgress = ((colorCount - 2) / 18) * 100;
  const smoothnessProgress = smoothness;
  const cleanup = smoothnessToCleanup(smoothness);
  const panEnabled = zoom > 100 && (panMode || !brushMode);

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
      setSourceCrop({ x: 0, y: 0, width: loaded.width, height: loaded.height });
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
      const fullCrop = sourceCrop.x === 0 && sourceCrop.y === 0 && sourceCrop.width === source.width && sourceCrop.height === source.height;
      const conversionSource = fullCrop ? source : cropRasterSource(source, sourceCrop);
      const converted = createVectorResult(conversionSource, colorCount, cleanup);
      setSource(conversionSource);
      setSourceCrop({ x: 0, y: 0, width: conversionSource.width, height: conversionSource.height });
      setResult(converted);
      initialPalette.current = converted.palette.map((color) => ({ ...color }));
      history.current = [];
      historyIndex.current = -1;
      pushHistory(converted);
      setViewMode("vector");
      setZoom(100);
      setPanMode(false);
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
  }, [cleanup, colorCount, pushHistory, source, sourceCrop]);

  const startSourceCropDrag = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!source || !sourceCropStage.current) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const mode = (target.dataset.cropHandle as CropDragMode | undefined) ?? "move";
    const bounds = sourceCropStage.current.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    sourceCropDrag.current = {
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCrop: { ...sourceCrop },
      renderedWidth: Math.max(1, bounds.width),
      renderedHeight: Math.max(1, bounds.height),
    };
  }, [source, sourceCrop]);

  const moveSourceCropDrag = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!source || !sourceCropDrag.current) return;
    event.preventDefault();
    const drag = sourceCropDrag.current;
    const dx = ((event.clientX - drag.startClientX) / drag.renderedWidth) * source.width;
    const dy = ((event.clientY - drag.startClientY) / drag.renderedHeight) * source.height;
    const minimumWidth = Math.max(12, source.width * .03);
    const minimumHeight = Math.max(12, source.height * .03);
    const startLeft = drag.startCrop.x;
    const startTop = drag.startCrop.y;
    const startRight = drag.startCrop.x + drag.startCrop.width;
    const startBottom = drag.startCrop.y + drag.startCrop.height;

    if (drag.mode === "move") {
      setSourceCrop({
        ...drag.startCrop,
        x: Math.max(0, Math.min(source.width - drag.startCrop.width, startLeft + dx)),
        y: Math.max(0, Math.min(source.height - drag.startCrop.height, startTop + dy)),
      });
      return;
    }

    let left = startLeft;
    let top = startTop;
    let right = startRight;
    let bottom = startBottom;
    if (drag.mode.includes("w")) left = Math.max(0, Math.min(startRight - minimumWidth, startLeft + dx));
    if (drag.mode.includes("e")) right = Math.min(source.width, Math.max(startLeft + minimumWidth, startRight + dx));
    if (drag.mode.includes("n")) top = Math.max(0, Math.min(startBottom - minimumHeight, startTop + dy));
    if (drag.mode.includes("s")) bottom = Math.min(source.height, Math.max(startTop + minimumHeight, startBottom + dy));
    setSourceCrop({ x: left, y: top, width: right - left, height: bottom - top });
  }, [source]);

  const stopSourceCropDrag = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    sourceCropDrag.current = null;
  }, []);

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

  const brushAt = useCallback((x: number, y: number, radius: number) => {
    if (!result || !selectedColors.length) return;
    const selected = new Set(selectedColors);
    const imageRadius = Math.max(.5, radius);
    const minX = Math.max(0, Math.floor(x - imageRadius));
    const minY = Math.max(0, Math.floor(y - imageRadius));
    const maxX = Math.min(result.width - 1, Math.ceil(x + imageRadius));
    const maxY = Math.min(result.height - 1, Math.ceil(y + imageRadius));
    let countDelta = 0;

    for (let pixelY = minY; pixelY <= maxY; pixelY += 1) {
      for (let pixelX = minX; pixelX <= maxX; pixelX += 1) {
        const dx = pixelX - x;
        const dy = pixelY - y;
        if (dx * dx + dy * dy > imageRadius * imageRadius) continue;
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
  }, [brushTool, renderProtectionPatch, result, selectedColors]);

  const pointerToImage = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!result || !previewRef.current) return null;
    const svg = previewRef.current.querySelector<SVGSVGElement>(".svg-artwork svg");
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const x = point.x;
    const y = point.y;
    if (x < 0 || y < 0 || x >= result.width || y >= result.height) return null;
    const scale = Math.max(.0001, Math.hypot(matrix.a, matrix.b));
    return { x, y, scale, radius: (brushSize / 2) / scale };
  }, [brushSize, result]);

  const continueBrush = useCallback((point: BrushPoint) => {
    const previous = lastBrushPoint.current;
    if (!previous) {
      brushAt(point.x, point.y, point.radius);
      lastBrushPoint.current = point;
      return;
    }
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(.5, point.radius / 2.5)));
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      brushAt(
        previous.x + (point.x - previous.x) * progress,
        previous.y + (point.y - previous.y) * progress,
        point.radius,
      );
    }
    lastBrushPoint.current = point;
  }, [brushAt]);

  const startBrush = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!brushMode) return;
    const point = pointerToImage(event);
    if (!point) return;
    setBrushCursor(point);
    event.currentTarget.setPointerCapture(event.pointerId);
    brushing.current = true;
    lastBrushPoint.current = null;
    continueBrush(point);
  }, [brushMode, continueBrush, pointerToImage]);

  const moveBrush = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pointerToImage(event);
    setBrushCursor(point);
    if (brushing.current && point) continueBrush(point);
  }, [continueBrush, pointerToImage]);

  const stopBrush = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    brushing.current = false;
    lastBrushPoint.current = null;
  }, []);

  const leaveBrush = useCallback(() => {
    if (!brushing.current) setBrushCursor(null);
  }, []);

  const syncProtectionOverlay = useCallback(() => {
    const preview = previewRef.current;
    const canvas = protectionCanvas.current;
    const svg = preview?.querySelector<SVGSVGElement>(".svg-artwork svg");
    if (!preview || !canvas || !svg) return;
    const previewBounds = preview.getBoundingClientRect();
    const svgBounds = svg.getBoundingClientRect();
    canvas.style.left = `${svgBounds.left - previewBounds.left}px`;
    canvas.style.top = `${svgBounds.top - previewBounds.top}px`;
    canvas.style.width = `${svgBounds.width}px`;
    canvas.style.height = `${svgBounds.height}px`;
  }, []);

  useLayoutEffect(() => {
    if (!result || viewMode !== "vector") return;
    const preview = previewRef.current;
    const svg = preview?.querySelector<SVGSVGElement>(".svg-artwork svg");
    if (!preview || !svg) return;
    syncProtectionOverlay();
    const observer = new ResizeObserver(syncProtectionOverlay);
    observer.observe(preview);
    observer.observe(svg);
    window.addEventListener("resize", syncProtectionOverlay);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncProtectionOverlay);
    };
  }, [result, syncProtectionOverlay, viewMode, zoom]);

  const startPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const artboard = artboardRef.current;
    if (!artboard || !panEnabled || busy) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panDrag.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: artboard.scrollLeft,
      startScrollTop: artboard.scrollTop,
    };
    setIsPanning(true);
  }, [busy, panEnabled]);

  const movePan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const artboard = artboardRef.current;
    const drag = panDrag.current;
    if (!artboard || !drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    artboard.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startClientX);
    artboard.scrollTop = drag.startScrollTop - (event.clientY - drag.startClientY);
  }, []);

  const stopPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panDrag.current || panDrag.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    panDrag.current = null;
    setIsPanning(false);
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

  const previewSvg = useMemo(() => {
    if (!result) return "";
    const highlighted = highlightSvg(result.svg, selectedColors);
    if (!brushMode || panMode || viewMode !== "vector" || !brushCursor) return highlighted;
    const outline = 1 / brushCursor.scale;
    const cursor = `<g aria-hidden="true" pointer-events="none" data-brush-cursor="true"><circle cx="${brushCursor.x}" cy="${brushCursor.y}" r="${brushCursor.radius}" fill="none" stroke="#fff" stroke-width="${outline * 3}"/><circle cx="${brushCursor.x}" cy="${brushCursor.y}" r="${brushCursor.radius}" fill="none" stroke="#111" stroke-width="${outline}" stroke-opacity=".9"/></g>`;
    return highlighted.replace(/<\/svg>\s*$/, `${cursor}</svg>`);
  }, [brushCursor, brushMode, panMode, result, selectedColors, viewMode]);

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
            <div
              className={`dropzone ${isDragging ? "dragging" : ""} ${source ? "has-image" : ""}`}
              role="button"
              tabIndex={source ? -1 : 0}
              aria-label={source ? "Drag the crop frame to choose the area to vectorize" : "Choose an image to vectorize"}
              onClick={() => { if (!source) fileInput.current?.click(); }}
              onKeyDown={(event) => { if (!source && (event.key === "Enter" || event.key === " ")) fileInput.current?.click(); }}
              onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => { event.preventDefault(); setIsDragging(false); void acceptFile(event.dataTransfer.files[0]); }}
            >
              {source ? (
                <>
                  <span className="checkerboard source-crop-checkerboard">
                    <span ref={sourceCropStage} className="source-crop-stage" style={{
                      aspectRatio: `${source.width} / ${source.height}`,
                      width: source.width / source.height >= 4 / 3 ? "92%" : "auto",
                      height: source.width / source.height >= 4 / 3 ? "auto" : "310px",
                    }}>
                      <img src={source.previewUrl} alt={`Preview of ${fileName}`} />
                      <span
                        className="source-crop-frame"
                        style={{
                          left: `${(sourceCrop.x / source.width) * 100}%`,
                          top: `${(sourceCrop.y / source.height) * 100}%`,
                          width: `${(sourceCrop.width / source.width) * 100}%`,
                          height: `${(sourceCrop.height / source.height) * 100}%`,
                        }}
                        onPointerDown={startSourceCropDrag}
                        onPointerMove={moveSourceCropDrag}
                        onPointerUp={stopSourceCropDrag}
                        onPointerCancel={stopSourceCropDrag}
                      >
                        {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((handle) => <i className={`crop-handle crop-handle-${handle}`} data-crop-handle={handle} key={handle}/>) }
                        <b className="source-crop-size">{Math.round(sourceCrop.width)} × {Math.round(sourceCrop.height)}</b>
                      </span>
                    </span>
                  </span>
                  <span className="crop-instruction"><Crop size={14}/>Drag the frame, edges, or corners to choose the area</span>
                  <span className="file-pill"><ImagePlus size={15}/>{fileName}<small>{source.width} × {source.height}px</small></span>
                </>
              ) : (
                <><span className="upload-icon"><UploadCloud size={28} /></span><strong>{busy ? "Reading your image…" : "Drop your image here"}</strong><p>or click to choose a file</p><span className="formats">PNG · JPG · WEBP · up to 20 MB</span></>
              )}
            </div>
            <input ref={fileInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void acceptFile(event.target.files?.[0])}/>
            {error && <p className="error-message">{error}</p>}
            <div className="local-processing"><LockKeyhole size={15}/><span><b>Private by design.</b> Nothing is uploaded or stored.</span></div>
          </div>

          <aside className="settings-card">
            <div className="card-heading compact"><div><span className="step-label">STEP 2</span><h2>Vector settings</h2></div></div>
            <div className="setting-row"><div><label htmlFor="color-count">Number of colors</label><small>Visible colors, excluding transparency</small></div><span className="value-box">{colorCount}</span></div>
            <input id="color-count" className="range-control" type="range" min="2" max="20" value={colorCount} style={{ background: `linear-gradient(90deg, var(--green) 0 ${colorSliderProgress}%, #e9ece8 ${colorSliderProgress}% 100%)` }} onChange={(event) => setColorCount(Number(event.target.value))}/>
            <div className="setting-row"><div><label htmlFor="smoothness">Smoothness</label><small>Label cleanup, tracing size, and curve simplification</small></div><span className="value-box">{smoothness}</span></div>
            <input id="smoothness" className="range-control smoothness-range" type="range" min="0" max="100" value={smoothness} style={{ background: `linear-gradient(90deg, var(--green) 0 ${smoothnessProgress}%, #e9ece8 ${smoothnessProgress}% 100%)` }} onChange={(event) => setSmoothness(Number(event.target.value))}/>
            <div className="range-labels" aria-hidden="true"><span>Precise</span><span>Balanced</span><span>Smooth</span></div>
            <div className="tip-card"><Sparkles size={16}/><p><b>Balanced (50):</b> uses one 3×3 label pass, fits curves on an 800–1200px working grid, and removes disconnected fragments below 0.05% of the artwork.</p></div>
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
                {(["original", "reduced", "vector"] as ViewMode[]).map((mode) => <button className={viewMode === mode ? "active" : ""} type="button" role="tab" key={mode} onClick={() => { setBrushCursor(null); setViewMode(mode); }}>{mode === "original" ? "Original" : mode === "reduced" ? "Reduced" : "SVG"}</button>)}
              </div>
              <div className="zoom-controls" aria-label="Preview zoom and pan controls">
                <button className={panMode ? "active" : ""} type="button" aria-label={panMode ? "Return to brush tool" : "Use hand tool to move the canvas"} aria-pressed={panMode} disabled={zoom <= 100} onClick={() => { setBrushCursor(null); setPanMode((current) => !current); }}><Hand size={15}/></button>
                <button type="button" aria-label="Zoom out" disabled={zoom <= 50} onClick={() => setZoom((current) => Math.max(50, current - 25))}><ZoomOut size={15}/></button>
                <button className="zoom-value" type="button" aria-label="Reset zoom to 100 percent" onClick={() => { setBrushCursor(null); setZoom(100); setPanMode(false); }}>{zoom}%</button>
                <button type="button" aria-label="Zoom in" disabled={zoom >= 400} onClick={() => setZoom((current) => Math.min(400, current + 25))}><ZoomIn size={15}/></button>
              </div>
            </div>
            <div
              ref={artboardRef}
              className={`artboard ${busy ? "processing" : ""} ${panEnabled ? "pan-ready" : ""} ${isPanning ? "panning" : ""}`}
              onPointerDown={startPan}
              onPointerMove={movePan}
              onPointerUp={stopPan}
              onPointerCancel={stopPan}
            >
              <div className="zoom-stage" style={{ width: `${zoom}%`, minHeight: `${Math.round(550 * zoom / 100)}px` }}>
                {viewMode === "original" && <img style={{ maxHeight: `${Math.round(490 * zoom / 100)}px` }} src={source?.previewUrl} alt="Original artwork" />}
                {viewMode === "reduced" && <img style={{ maxHeight: `${Math.round(490 * zoom / 100)}px` }} src={result.previewUrl} alt="Color-reduced artwork" />}
                {viewMode === "vector" && (
                  <div ref={previewRef} style={{ height: `${Math.round(490 * zoom / 100)}px` }} className={`svg-preview ${selectedColors.length ? "showing-selection" : ""} ${brushMode && !panMode ? "brush-active" : ""}`} aria-label="SVG preview">
                    <div className="svg-artwork" dangerouslySetInnerHTML={{ __html: previewSvg }} />
                    <canvas
                      ref={protectionCanvas}
                      className="protection-canvas"
                      aria-label="Brush directly over highlighted color areas to exclude them from deletion"
                      onPointerDown={startBrush}
                      onPointerMove={moveBrush}
                      onPointerUp={stopBrush}
                      onPointerCancel={stopBrush}
                      onPointerLeave={leaveBrush}
                    />
                  </div>
                )}
              </div>
              {!!selectedColors.length && !busy && <span className="selection-badge"><Eye size={14}/>{selectedColors.length} color{selectedColors.length > 1 ? "s" : ""} highlighted</span>}
              {panEnabled && !isPanning && !busy && <span className="pan-hint"><Hand size={13}/> Drag to move</span>}
              {busy && <span className="processing-badge"><Sparkles size={15}/> Updating vector…</span>}
            </div>
            <div className="stats-bar">
              <span><SwatchBook size={16}/><b>{result.palette.length}</b> colors</span>
              <span><Merge size={16}/><b>{result.pathCount.toLocaleString()}</b> paths</span>
              <span><Sparkles size={16}/><b>{result.nodeCount.toLocaleString()}</b> anchors</span>
              <span><FileImage size={16}/><b>{formatBytes(result.fileSize)}</b> SVG</span>
              <span><Layers3 size={16}/><b>{result.curveRatio}%</b> cubic curves</span>
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
                <button className={brushMode ? "active" : ""} type="button" disabled={!selectedColors.length || busy} onClick={() => { setBrushCursor(null); setViewMode("vector"); setPanMode(false); setBrushMode((current) => !current); }}><Paintbrush size={14}/>{brushMode ? "Brush on" : "Use brush"}</button>
              </div>
              {brushMode && (
                <>
                  <div className="brush-tools">
                    <button className={brushTool === "protect" ? "active" : ""} type="button" onClick={() => setBrushTool("protect")}>Keep</button>
                    <button className={brushTool === "unprotect" ? "active" : ""} type="button" onClick={() => setBrushTool("unprotect")}>Undo brush</button>
                    <button type="button" disabled={!protectedCount} onClick={clearProtection}>Clear</button>
                  </div>
                  <label className="brush-size"><span>Brush size</span><input type="range" min="8" max="180" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))}/><output>{brushSize}px</output></label>
                  <p><i/> Teal areas are protected and will stay when you choose Delete selected. Use the hand button above to move around while zoomed in.</p>
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
