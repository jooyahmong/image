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
  Pipette,
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
  downloadFavicon,
  downloadRasterFavicon,
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
  normalizeHexColor,
  PaletteColor,
  RasterSource,
  recolorResult,
  rgbToHex,
  VectorResult,
} from "./vector-utils";

const steps = {
  en: ["Upload", "Colors", "Edit", "Crop", "Export"],
  ko: ["업로드", "색상", "편집", "자르기", "내보내기"],
};
const presets = {
  original: { label: "Original palette", colors: [] },
  coastal: { label: "Coastal", colors: ["#183B4E", "#3F7C85", "#91C8C4", "#E7E2D5", "#F4A261"] },
  harvest: { label: "Warm harvest", colors: ["#3B2F2F", "#8C3B2A", "#D8763B", "#E9B872", "#F7EBD8"] },
  botanical: { label: "Botanical", colors: ["#1F3D34", "#477D62", "#8DB596", "#D8E2C6", "#F4E9D8"] },
  mono: { label: "Ink & paper", colors: ["#202725", "#59635F", "#A8AFAB", "#E1E2DC", "#FAF8F0"] },
};
const FIXED_CLEANUP: CleanupLevel = "medium";
const FIXED_ANCHOR_SIMPLIFICATION = 50;

const koreanText: Record<string, string> = {
  "High-quality solid SVG": "고품질 단색 SVG", "Number of colors": "색상 수", "Visible colors, excluding transparency": "투명도를 제외한 표시 색상",
  "Create high-quality SVG": "고품질 SVG 만들기", "Building high-quality paths…": "고품질 패스를 만드는 중…",
  "Shadows and highlights are folded into solid base colors. No gradients are created.": "그림자와 하이라이트는 원래의 단색 면으로 통합되며 그라데이션은 만들지 않습니다.", "Settings": "설정", "Original": "원본", "Reduced": "색상 축소",
  "Edit palette": "팔레트 편집", "Apply": "적용", "Select a color to highlight its exact area.": "색상을 선택해 정확한 영역을 강조 표시하세요.",
  "Choose a color": "색상 선택", "Visual picker": "화면에서 선택", "Eyedropper": "스포이드", "Exact HEX": "정확한 HEX", "RGB values": "RGB 값",
  "Quick colors": "빠른 색상", "White": "흰색", "Black": "검정", "Original color": "원래 색상", "Cancel": "취소", "Apply color": "색상 적용",
  "Live preview": "실시간 미리보기", "Valid colors appear on the artwork automatically.": "올바른 색상은 그림에 자동으로 바로 반영됩니다.", "Done": "완료",
  "You can choose visually, enter an exact HEX or RGB value, or use the eyedropper.": "화면에서 선택하거나 정확한 HEX·RGB 값을 입력하고, 스포이드도 사용할 수 있습니다.",
  "Select several to compare, merge, or delete them.": "여러 색상을 선택해 비교, 병합 또는 삭제할 수 있습니다.", "Keep-area brush": "영역 유지 브러시",
  "Brush parts of the selected color that must not be deleted.": "선택한 색상 중 삭제하면 안 되는 부분을 브러시로 지정합니다.", "Use brush": "브러시 사용", "Brush on": "브러시 켜짐",
  "Keep": "유지", "Undo brush": "브러시 취소", "Clear": "지우기", "Brush size": "브러시 크기", "Merge": "병합", "Delete selected": "선택 삭제",
  "Final crop & export": "최종 자르기 및 내보내기", "Transparent space": "투명 여백", "Auto crop": "자동 크롭", "Already fitted": "이미 맞춤",
  "Aspect ratio": "가로세로 비율", "Free": "자유", "Crop edges": "자르기 가장자리", "Reset crop": "크롭 초기화", "PNG size": "PNG 크기",
  "Separate objects": "분리된 오브젝트", "SVG": "SVG", "Save": "저장", "Close crop dialog": "자르기 창 닫기",
  "Drag to move": "드래그하여 이동", "Updating vector…": "벡터를 업데이트하는 중…", "colors": "색상", "paths": "패스", "anchors": "앵커", "cubic curves": "큐빅 곡선",
  "Private by design.": "개인정보 보호 설계.", "Nothing is uploaded or stored.": "이미지는 업로드되거나 저장되지 않습니다.",
  "Teal areas are protected and will stay when you choose Delete selected. Use the hand button above to move around while zoomed in.": "청록색 영역은 보호되어 선택 삭제를 해도 유지됩니다. 확대 상태에서는 위의 손 도구로 화면을 이동할 수 있습니다.",
  "Fit the canvas to the remaining object after deleting a background color.": "배경색을 삭제한 뒤 남은 오브젝트에 맞춰 캔버스를 조정합니다.",
  "The canvas was cropped automatically. Choose Reset crop to return to the original canvas.": "캔버스가 자동으로 크롭되었습니다. 크롭 전으로 돌아가려면 크롭 초기화를 누르세요.",
  "disconnected objects detected. Save each with its own fitted canvas.": "개의 분리된 오브젝트를 찾았습니다. 각각의 맞춤 캔버스로 저장하세요.",
  "The bright area is your final canvas. SVG paths stay fully editable.": "밝은 영역이 최종 캔버스입니다. SVG 패스는 계속 편집할 수 있습니다.",
  "Tip:": "팁:", "Likely background": "배경으로 추정", "check the highlighted area, then choose Delete selected.": "강조된 영역을 확인한 뒤 선택 삭제를 누르세요.",
  "Tip: select": "팁: 선택",
  "SVG saved successfully.": "SVG가 성공적으로 저장되었습니다.", "SVG download started.": "SVG 다운로드가 시작되었습니다.",
  "Favicon": "파비콘", "Favicon saved successfully.": "파비콘이 성공적으로 저장되었습니다.", "Favicon download started.": "파비콘 다운로드가 시작되었습니다.",
};

type Snapshot = { palette: PaletteColor[]; pixelMap: Uint8Array };
type ViewMode = "original" | "reduced" | "vector";
type BrushTool = "protect" | "unprotect";
type CropDragMode = "move" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type BrushPoint = { x: number; y: number; scale: number; radius: number };
type ColorEditorState = { index: number; hex: string; r: string; g: string; b: string; error: string };

function makeColorEditorState(index: number, hex: string): ColorEditorState {
  const normalized = normalizeHexColor(hex) ?? "#000000";
  const { r, g, b } = hexToRgb(normalized);
  return { index, hex: normalized, r: String(r), g: String(g), b: String(b), error: "" };
}

function colorEditorPreview(state: ColorEditorState) {
  const normalized = normalizeHexColor(state.hex);
  if (normalized) return normalized;
  const channels = [state.r, state.g, state.b].map(Number);
  return channels.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    ? rgbToHex(channels[0], channels[1], channels[2])
    : "#000000";
}

function cleanFilename(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]+/g, "-") || "vector-artwork";
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
  const [originalUpload, setOriginalUpload] = useState<{ file: File; url: string } | null>(null);
  const [result, setResult] = useState<VectorResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [colorCount, setColorCount] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("vector");
  const [selectedColors, setSelectedColors] = useState<number[]>([]);
  const [preset, setPreset] = useState<keyof typeof presets>("original");
  const [historyStatus, setHistoryStatus] = useState({ index: -1, length: 0 });
  const [cropOpen, setCropOpen] = useState(false);
  const [originalFaviconOpen, setOriginalFaviconOpen] = useState(false);
  const [crop, setCrop] = useState<CropBox>({ x: 0, y: 0, width: 1, height: 1 });
  const [autoCropApplied, setAutoCropApplied] = useState(false);
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
  const [colorEditor, setColorEditor] = useState<ColorEditorState | null>(null);
  const [eyeDropperSupported, setEyeDropperSupported] = useState(false);
  const [language, setLanguage] = useState<"en" | "ko">("en");
  const [legalOpen, setLegalOpen] = useState(false);
  useEffect(() => () => {
    if (originalUpload) URL.revokeObjectURL(originalUpload.url);
  }, [originalUpload]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("lang") === "ko") setLanguage("ko");
    setEyeDropperSupported("EyeDropper" in window);
  }, []);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("main.app-shell");
    if (!root) return;
    const reverse = Object.fromEntries(Object.entries(koreanText).map(([english, korean]) => [korean, english]));
    const convert = (value: string) => language === "ko" ? koreanText[value] ?? value : reverse[value] ?? value;
    const translate = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) node.textContent = convert(node.textContent?.trim() ?? "") || node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node as HTMLElement;
      ["aria-label", "title"].forEach((attribute) => {
        const value = element.getAttribute(attribute);
        if (value) element.setAttribute(attribute, convert(value));
      });
      element.childNodes.forEach(translate);
    };
    translate(root);
    const observer = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(translate)));
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [language]);
  const colorSliderProgress = ((colorCount - 2) / 18) * 100;
  const cleanup = FIXED_CLEANUP;
  const panEnabled = zoom > 100 && (panMode || !brushMode);

  const currentStep = cropOpen ? 4 : result ? 2 : source ? 1 : 0;
  const korean = language === "ko";
  const isOriginalExport = viewMode === "original" && !!originalUpload;
  const originalEditorColor = colorEditor && result
    ? initialPalette.current.find((color) => color.id === result.palette[colorEditor.index]?.id)
    : null;
  const normalizedEditorColor = colorEditor ? normalizeHexColor(colorEditor.hex) : null;
  const liveColorPending = !!(colorEditor && normalizedEditorColor && result?.palette[colorEditor.index]?.hex !== normalizedEditorColor);
  const setSiteLanguage = (next: "en" | "ko") => {
    setLanguage(next);
    const url = new URL(window.location.href);
    if (next === "ko") url.searchParams.set("lang", "ko"); else url.searchParams.delete("lang");
    window.history.replaceState({}, "", url);
  };

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
      setOriginalUpload({ file, url: URL.createObjectURL(file) });
      setOriginalFaviconOpen(false);
      setCropOpen(false);
      setFileName(file.name);
      setSource(loaded);
      setSourceCrop({ x: 0, y: 0, width: loaded.width, height: loaded.height });
      setResult(null);
      setColorEditor(null);
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
      const converted = createVectorResult(conversionSource, colorCount, FIXED_CLEANUP, FIXED_ANCHOR_SIMPLIFICATION);
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
  }, [colorCount, pushHistory, source, sourceCrop]);

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
    const normalized = normalizeHexColor(hex);
    if (!normalized) return;
    const rgb = hexToRgb(normalized);
    const palette = result.palette.map((color, colorIndex) => colorIndex === index ? { ...color, ...rgb, hex: normalized } : { ...color });
    await commitResult(recolorResult(result, palette, cleanup));
  }, [cleanup, commitResult, result]);

  const openColorEditor = useCallback((index: number) => {
    const color = result?.palette[index];
    if (!color || color.locked || busy) return;
    setColorEditor(makeColorEditorState(index, color.hex));
  }, [busy, result]);

  const editHexColor = useCallback((value: string) => {
    setColorEditor((current) => {
      if (!current) return null;
      const normalized = normalizeHexColor(value);
      if (!normalized) {
        return { ...current, hex: value.toUpperCase(), error: language === "ko" ? "HEX는 #FFF 또는 #FFFFFF 형식으로 입력해 주세요." : "Enter HEX as #FFF or #FFFFFF." };
      }
      const { r, g, b } = hexToRgb(normalized);
      return { ...current, hex: value.toUpperCase(), r: String(r), g: String(g), b: String(b), error: "" };
    });
  }, [language]);

  const editRgbColor = useCallback((channel: "r" | "g" | "b", value: string) => {
    setColorEditor((current) => {
      if (!current) return null;
      const clean = value.replace(/[^0-9]/g, "").slice(0, 3);
      const next = { ...current, [channel]: clean };
      const channels = [next.r, next.g, next.b].map((item) => item === "" ? Number.NaN : Number(item));
      if (channels.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
        return { ...next, error: language === "ko" ? "RGB 값은 각각 0부터 255까지 입력해 주세요." : "Enter each RGB value from 0 to 255." };
      }
      return { ...next, hex: rgbToHex(channels[0], channels[1], channels[2]), error: "" };
    });
  }, [language]);

  const setEditorColor = useCallback((hex: string) => {
    setColorEditor((current) => current ? makeColorEditorState(current.index, hex) : null);
  }, []);

  const pickScreenColor = useCallback(async () => {
    const EyeDropperConstructor = (window as typeof window & {
      EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
    }).EyeDropper;
    if (!EyeDropperConstructor) return;
    try {
      const selection = await new EyeDropperConstructor().open();
      setEditorColor(selection.sRGBHex);
    } catch (caught) {
      if (!(caught instanceof DOMException) || caught.name !== "AbortError") {
        setColorEditor((current) => current ? { ...current, error: language === "ko" ? "화면에서 색상을 가져오지 못했습니다." : "We couldn't pick that screen color." } : null);
      }
    }
  }, [language, setEditorColor]);

  useEffect(() => {
    if (!colorEditor || colorEditor.error || busy || !result) return;
    const normalized = normalizeHexColor(colorEditor.hex);
    if (!normalized || result.palette[colorEditor.index]?.hex === normalized) return;
    const timer = window.setTimeout(() => void updateColor(colorEditor.index, normalized), 160);
    return () => window.clearTimeout(timer);
  }, [busy, colorEditor, result, updateColor]);

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

  const openOriginalFavicon = useCallback(() => {
    if (!originalUpload || busy || exportState) return;
    setExportMessage("");
    setOriginalFaviconOpen(true);
  }, [busy, exportState, originalUpload]);

  const openCrop = useCallback(() => {
    if (viewMode === "original" && originalUpload) {
      openOriginalFavicon();
      return;
    }
    if (!result) return;
    const visibleBounds = getVisibleBounds(result);
    const hasTransparentOuterSpace = visibleBounds.x > 0 || visibleBounds.y > 0 ||
      visibleBounds.x + visibleBounds.width < result.width ||
      visibleBounds.y + visibleBounds.height < result.height;
    setCrop(hasTransparentOuterSpace ? visibleBounds : { x: 0, y: 0, width: result.width, height: result.height });
    setAutoCropApplied(hasTransparentOuterSpace);
    setExportMessage("");
    setSelectedObjectIndex(null);
    setCropOpen(true);
  }, [openOriginalFavicon, originalUpload, result, viewMode]);

  const resetCrop = useCallback(() => {
    if (!result) return;
    setCrop({ x: 0, y: 0, width: result.width, height: result.height });
    setAutoCropApplied(false);
  }, [result]);

  const setRatio = useCallback((ratio: number | null) => {
    if (!result) return;
    if (!ratio) {
      resetCrop();
      return;
    }
    const imageRatio = result.width / result.height;
    let width = result.width;
    let height = result.height;
    if (imageRatio > ratio) width = height * ratio;
    else height = width / ratio;
    setCrop({ x: (result.width - width) / 2, y: (result.height - height) / 2, width, height });
    setAutoCropApplied(false);
  }, [resetCrop, result]);

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
    setAutoCropApplied(hasTransparentTrim);
    setExportMessage("");
  }, [autoCropBounds, hasTransparentTrim]);

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
    setAutoCropApplied(false);
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

  const exportFavicon = useCallback(async () => {
    if (!result) return;
    setExportState("favicon");
    setExportMessage("");
    try {
      const status = await downloadFavicon(result.svg, crop);
      if (status !== "cancelled") setExportMessage(status === "saved"
        ? (korean ? "파비콘이 성공적으로 저장되었습니다." : "Favicon saved successfully.")
        : (korean ? "파비콘 다운로드가 시작되었습니다." : "Favicon download started."));
    } catch (caught) {
      setExportMessage(korean ? "파비콘 생성에 실패했습니다. 다시 시도해 주세요." : (caught instanceof Error ? caught.message : "Favicon download failed. Please try again."));
    } finally {
      setExportState("");
    }
  }, [crop, korean, result]);

  const exportOriginalFavicon = useCallback(async () => {
    if (!originalUpload) return;
    setExportState("original-favicon");
    setExportMessage("");
    try {
      const status = await downloadRasterFavicon(originalUpload.file);
      if (status !== "cancelled") setExportMessage(status === "saved"
        ? (korean ? "원본 파비콘이 저장되었습니다." : "Original favicon saved successfully.")
        : (korean ? "원본 파비콘 다운로드가 시작되었습니다." : "Original favicon download started."));
    } catch (caught) {
      setExportMessage(korean ? "파비콘 생성에 실패했습니다. 다시 시도해 주세요." : (caught instanceof Error ? caught.message : "Favicon download failed. Please try again."));
    } finally {
      setExportState("");
    }
  }, [korean, originalUpload]);

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
    <main className="app-shell" lang={language}>
      <header className="topbar">
        <a className="brand brand-logo" href="#" aria-label="WOOJOO Image home"><img src="/logo.png" alt="WOOJOO Image" /></a>
        <div className="privacy-note"><ShieldCheck size={16} /><span>{korean ? "이미지는 이 기기 안에만 머뭅니다" : "Your image stays on this device"}</span></div>
        <nav className="language-switcher" aria-label="Language selection">
          <button type="button" className={!korean ? "active" : ""} onClick={() => setSiteLanguage("en")}>ENG</button>
          <span>/</span>
          <button type="button" className={korean ? "active" : ""} onClick={() => setSiteLanguage("ko")}>한국어</button>
        </nav>
      </header>

      <section className="workflow-header">
        <div>
          <span className="eyebrow">{korean ? "래스터 이미지를 벡터로" : "RASTER TO VECTOR"}</span>
          <h1>{result ? (korean ? "벡터 팔레트를 다듬어 보세요." : "Refine your vector palette.") : (korean ? "이미지를 깨끗하고 편집 가능한 SVG로 바꾸세요." : "Turn artwork into a clean, editable SVG.")}</h1>
          <p>{result ? (korean ? "색상 견본을 눌러 모양을 다시 칠하고, 색상을 합친 뒤 자르고 내보내세요." : "Click any swatch to recolor every matching shape, merge colors, then crop and export.") : (korean ? "색상을 줄이고, 팔레트를 다듬고, 자른 뒤 내보내세요. 모든 작업은 이 기기에서 안전하게 처리됩니다." : "Reduce colors, refine your palette, crop, and export — all in one private workspace.")}</p>
        </div>
        <nav className="steps" aria-label={korean ? "변환 진행 상황" : "Conversion progress"}>
          {steps[language].map((step, index) => (
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
              <div><span className="step-label">{korean ? "1단계" : "STEP 1"}</span><h2>{korean ? "이미지 업로드" : "Upload your artwork"}</h2></div>
              {source && <button className="text-button" type="button" onClick={() => fileInput.current?.click()}><RotateCcw size={15}/> {korean ? "바꾸기" : "Replace"}</button>}
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
                <><span className="upload-icon"><UploadCloud size={28} /></span><strong>{busy ? (korean ? "이미지를 읽는 중…" : "Reading your image…") : (korean ? "이미지를 여기에 놓으세요" : "Drop your image here")}</strong><p>{korean ? "또는 클릭하여 파일을 선택하세요" : "or click to choose a file"}</p><span className="formats">PNG · JPG · WEBP · {korean ? "최대" : "up to"} 20 MB</span></>
              )}
            </div>
            <input ref={fileInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void acceptFile(event.target.files?.[0])}/>
            {error && <p className="error-message">{error}</p>}
            {originalUpload && <button className="original-favicon-shortcut text-button" type="button" disabled={busy || !!exportState} onClick={openOriginalFavicon}><FileImage size={15}/>{korean ? "변환 없이 원본 파비콘 저장" : "Save original as favicon without conversion"}</button>}
            <div className="local-processing"><LockKeyhole size={15}/><span><b>Private by design.</b> Nothing is uploaded or stored.</span></div>
          </div>

          <aside className="settings-card">
            <div className="card-heading compact"><div><span className="step-label">STEP 2</span><h2>High-quality solid SVG</h2></div></div>
            <div className="setting-row"><div><label htmlFor="color-count">Number of colors</label><small>Visible colors, excluding transparency</small></div><span className="value-box">{colorCount}</span></div>
            <input id="color-count" className="range-control" type="range" min="2" max="20" value={colorCount} style={{ background: `linear-gradient(90deg, var(--green) 0 ${colorSliderProgress}%, #e9ece8 ${colorSliderProgress}% 100%)` }} onChange={(event) => setColorCount(Number(event.target.value))}/>
            <button className="primary-button" type="button" disabled={!source || busy} onClick={() => void runConversion()}><SwatchBook size={17}/>{busy ? "Building high-quality paths…" : "Create high-quality SVG"}</button>
            <p className="button-hint">Shadows and highlights are folded into solid base colors. No gradients are created.</p>
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
            {isOriginalExport && <p className="original-favicon-hint" id="original-favicon-hint" role="status">{korean ? "원본 이미지를 SVG 변환 없이 파비콘으로 저장할 수 있어요." : "Save the original image as a favicon without converting it to SVG."}</p>}
            <div
              ref={artboardRef}
              className={`artboard ${busy ? "processing" : ""} ${panEnabled ? "pan-ready" : ""} ${isPanning ? "panning" : ""}`}
              onPointerDown={startPan}
              onPointerMove={movePan}
              onPointerUp={stopPan}
              onPointerCancel={stopPan}
            >
              <div className="zoom-stage" style={{ width: `${zoom}%`, minHeight: `${Math.round(550 * zoom / 100)}px` }}>
                {viewMode === "original" && <img style={{ maxHeight: `${Math.round(490 * zoom / 100)}px` }} src={originalUpload?.url ?? source?.previewUrl} alt="Original artwork" />}
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
                  <button className="swatch" style={{ backgroundColor: color.hex }} aria-label={`Change ${color.hex}`} type="button" disabled={color.locked || busy} onClick={() => openColorEditor(index)}><Pipette size={14}/></button>
                  <button className="color-meta" type="button" onClick={() => toggleColorSelection(index)}><strong>{color.hex}</strong><span>{color.share.toFixed(1)}% of image</span>{color.backgroundCandidate && <em>Likely background</em>}</button>
                  <div className="share-track"><i style={{ width: `${Math.max(3, color.share)}%`, backgroundColor: color.hex }}/></div>
                  <button className="lock-button" aria-label={color.locked ? `Unlock ${color.hex}` : `Lock ${color.hex}`} type="button" onClick={() => toggleLock(index)}>{color.locked ? <Lock size={14}/> : <Unlock size={14}/>}</button>
                </div>
              ))}
            </div>
            {colorEditor && result.palette[colorEditor.index] && (
              <section className="color-editor-panel" aria-labelledby="color-editor-title">
                <div className="color-editor-heading">
                  <div className="color-editor-title-wrap">
                    <span className="color-editor-preview" style={{ backgroundColor: colorEditorPreview(colorEditor) }}/>
                    <div><span className="step-label">{korean ? "색상 선택" : "Choose a color"}</span><h3 id="color-editor-title">{colorEditorPreview(colorEditor)}</h3></div>
                  </div>
                  <button aria-label="Close color editor" type="button" disabled={busy || liveColorPending} onClick={() => setColorEditor(null)}><X size={17}/></button>
                </div>
                <p className="live-color-status" aria-live="polite"><i className={busy || liveColorPending ? "updating" : ""}/><b>{korean ? "실시간 미리보기" : "Live preview"}</b>{busy || liveColorPending ? <> · {korean ? "변경 중…" : "Updating…"}</> : null}</p>

                <div className="visual-picker-row">
                  <label className="visual-color-picker">
                    <span><span className="visual-color-dot" style={{ backgroundColor: colorEditorPreview(colorEditor) }}/>{korean ? "화면에서 선택" : "Visual picker"}</span>
                    <input aria-label="Visual picker" type="color" value={colorEditorPreview(colorEditor)} disabled={busy} onChange={(event) => setEditorColor(event.target.value)}/>
                  </label>
                  {eyeDropperSupported && <button className="eyedropper-button" type="button" disabled={busy} onClick={() => void pickScreenColor()}><Pipette size={16}/>{korean ? "스포이드" : "Eyedropper"}</button>}
                </div>

                <label className="hex-color-field">
                  <span>HEX</span>
                  <div><b>#</b><input aria-label="Exact HEX" aria-invalid={!!colorEditor.error} value={colorEditor.hex.replace(/^#/, "")} maxLength={6} spellCheck={false} autoCapitalize="characters" onChange={(event) => editHexColor(`#${event.target.value}`)}/></div>
                </label>

                <fieldset className="rgb-color-fields">
                  <legend>RGB</legend>
                  <div className="rgb-input-grid">
                    {(["r", "g", "b"] as const).map((channel) => (
                      <label key={channel}><span>{channel.toUpperCase()}</span><input aria-label={`${channel.toUpperCase()} value`} inputMode="numeric" min="0" max="255" value={colorEditor[channel]} onChange={(event) => editRgbColor(channel, event.target.value)}/></label>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="quick-color-fieldset">
                  <legend>{korean ? "빠른 선택" : "Quick"}</legend>
                  <div className="quick-color-buttons">
                    <button type="button" disabled={busy} onClick={() => setEditorColor("#FFFFFF")}><i style={{ backgroundColor: "#FFFFFF" }}/>{korean ? "흰색" : "White"}</button>
                    <button type="button" disabled={busy} onClick={() => setEditorColor("#000000")}><i style={{ backgroundColor: "#000000" }}/>{korean ? "검정" : "Black"}</button>
                    {originalEditorColor && <button type="button" disabled={busy} onClick={() => setEditorColor(originalEditorColor.hex)}><i style={{ backgroundColor: originalEditorColor.hex }}/>{korean ? "원래" : "Original"}</button>}
                  </div>
                </fieldset>

                {colorEditor.error && <p className="color-editor-error" role="alert">{colorEditor.error}</p>}
                <button className="color-editor-done" type="button" disabled={busy || liveColorPending || !!colorEditor.error} onClick={() => setColorEditor(null)}><Check size={15}/>{korean ? "완료" : "Done"}</button>
              </section>
            )}
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
            <button className="primary-button export-next" type="button" onClick={openCrop} aria-describedby={isOriginalExport ? "original-favicon-hint" : undefined}>
              {isOriginalExport ? <FileImage size={17}/> : <Crop size={17}/>}
              <span>{isOriginalExport ? (korean ? "원본 파비콘 저장 (.ico)" : "Save original favicon (.ico)") : (korean ? "자르기 및 내보내기" : "Final crop & export")}</span>
            </button>
          </aside>
        </section>
      )}

      {originalFaviconOpen && originalUpload && (
        <div className="modal-backdrop" role="presentation">
          <section className="crop-modal original-favicon-modal" role="dialog" aria-modal="true" aria-labelledby="original-favicon-title">
            <div className="modal-heading"><div><span className="step-label">FAVICON</span><h2 id="original-favicon-title">{korean ? "원본 파비콘 내보내기" : "Export original favicon"}</h2></div><button aria-label={korean ? "원본 파비콘 창 닫기" : "Close original favicon dialog"} type="button" disabled={!!exportState} onClick={() => setOriginalFaviconOpen(false)}><X size={19}/></button></div>
            <div className="original-favicon-content">
              <div className="crop-preview original-favicon-preview"><img src={originalUpload.url} alt={korean ? "파비콘으로 저장할 원본 이미지 전체" : "Complete original image for favicon"}/></div>
              <p>{korean ? "색상 축소·SVG 변환·크롭 없이 원본 이미지 전체를 사용합니다." : "Uses the complete original upload, without color reduction, SVG conversion, or cropping."}</p>
              <p>{korean ? "비율과 투명도를 유지한 16·32·48px ICO 파일로 저장합니다." : "Saves a 16, 32, and 48px ICO while preserving aspect ratio and transparency."}</p>
              <div className="download-buttons"><button className="primary-download" type="button" disabled={!!exportState} onClick={() => void exportOriginalFavicon()}><FileImage size={16}/>{exportState === "original-favicon" ? (korean ? "생성 중…" : "Rendering…") : (korean ? "원본 파비콘 저장" : "Save original favicon")}</button></div>
              {exportMessage && <p className="download-message" role="status">{exportMessage}</p>}
            </div>
          </section>
        </div>
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
                  <div><label className="control-label">Transparent space</label><p>{autoCropApplied ? (korean ? "캔버스가 자동으로 크롭되었습니다. 크롭 전으로 돌아가려면 크롭 초기화를 누르세요." : "The canvas was cropped automatically. Choose Reset crop to return to the original canvas.") : "Fit the canvas to the remaining object after deleting a background color."}</p></div>
                  {autoCropApplied ? (
                    <button type="button" onClick={resetCrop}><RotateCcw size={14}/>{korean ? "크롭 초기화" : "Reset crop"}</button>
                  ) : (
                    <button type="button" disabled={!hasTransparentTrim} onClick={autoCrop}><Crop size={14}/>{hasTransparentTrim ? (korean ? "자동 크롭" : "Auto crop") : (korean ? "이미 맞춤" : "Already fitted")}</button>
                  )}
                </div>
                <label className="control-label">Aspect ratio</label>
                <div className="ratio-grid"><button type="button" onClick={() => setRatio(null)}>Free</button><button type="button" onClick={() => setRatio(1)}>1:1</button><button type="button" onClick={() => setRatio(4 / 5)}>4:5</button><button type="button" onClick={() => setRatio(3 / 2)}>3:2</button><button type="button" onClick={() => setRatio(210 / 297)}>A4</button></div>
                <div className="inset-heading"><label className="control-label">Crop edges</label><span>{Math.round(crop.width)} × {Math.round(crop.height)}</span></div>
                {(["left", "top", "right", "bottom"] as const).map((side) => {
                  const horizontal = side === "left" || side === "right";
                  const maximum = Math.max(0, Math.floor((horizontal ? result.width : result.height) * .48));
                  return <label className="inset-control" key={side}><span>{side[0].toUpperCase() + side.slice(1)}</span><input type="range" min="0" max={maximum} value={Math.min(cropInsets[side], maximum)} onChange={(event) => updateInset(side, Number(event.target.value))}/><output>{cropInsets[side]}px</output></label>;
                })}
                {!autoCropApplied && <button className="reset-crop" type="button" onClick={resetCrop}><RotateCcw size={14}/>Reset crop</button>}
                <div className="export-section">
                  <div><label className="control-label">PNG size</label><div className="scale-buttons">{[1, 2, 4].map((scale) => <button className={pngScale === scale ? "active" : ""} type="button" key={scale} onClick={() => setPngScale(scale)}>{scale}×</button>)}</div></div>
                  <p>{Math.round(crop.width * pngScale)} × {Math.round(crop.height * pngScale)} px</p>
                </div>
                <div className="download-buttons"><button className="secondary-download" type="button" disabled={!!exportState} onClick={() => void exportSvg()}><Download size={16}/>{exportState === "svg" ? (korean ? "저장 중…" : "Saving…") : "SVG"}</button><button className="primary-download" type="button" disabled={!!exportState} onClick={() => void exportPng()}><Download size={16}/>{exportState === "png" ? (korean ? "렌더링 중…" : "Rendering…") : `PNG ${pngScale}×`}</button><button className="secondary-download" type="button" disabled={!!exportState} onClick={() => void exportFavicon()}><FileImage size={16}/>{exportState === "favicon" ? (korean ? "생성 중…" : "Rendering…") : (korean ? "파비콘" : "Favicon")}</button></div>
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
      <footer className="site-footer">© {new Date().getFullYear()} WoojooLand. All rights reserved. <button type="button" onClick={() => setLegalOpen(true)}>개인정보 이용 안내</button></footer>
      {legalOpen && <div className="legal-backdrop" role="presentation"><section className="legal-modal" role="dialog" aria-modal="true" aria-labelledby="legal-title"><button className="legal-close" type="button" aria-label="닫기" onClick={() => setLegalOpen(false)}><X size={18}/></button><h2 id="legal-title">개인정보 이용 안내</h2><p>WOOJOO Image는 이미지를 서버에 업로드하거나 저장하지 않습니다. 모든 이미지 처리와 SVG 생성은 사용자의 기기에서 이루어집니다.</p><p>로그인, 결제, 회원 정보 수집 기능을 사용하지 않습니다. 브라우저 또는 호스팅 서비스의 기본 기술 로그는 서비스 운영과 보안 목적으로 처리될 수 있습니다.</p><p>문의: WoojooLand</p></section></div>}
    </main>
  );
}
