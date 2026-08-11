"use client";

import { useCallback, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ImagePlus,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from "lucide-react";

const steps = ["Upload", "Colors", "Edit", "Crop", "Export"];

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const acceptFile = useCallback((file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    setFileName(file.name);
    setPreview(URL.createObjectURL(file));
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Jookland Vector Studio home">
          <span className="brand-mark"><Sparkles size={18} strokeWidth={2.4} /></span>
          <span>Vector Studio</span>
          <em>by Jookland</em>
        </a>
        <div className="privacy-note">
          <ShieldCheck size={16} />
          <span>Your image stays on this device</span>
        </div>
        <button className="language-button" type="button">EN <ChevronDown size={14} /></button>
      </header>

      <section className="workflow-header">
        <div>
          <span className="eyebrow">RASTER TO VECTOR</span>
          <h1>Turn artwork into a clean, editable SVG.</h1>
          <p>Reduce colors, refine your palette, crop, and export — all in one private workspace.</p>
        </div>
        <nav className="steps" aria-label="Conversion progress">
          {steps.map((step, index) => (
            <div className={`step ${index === 0 ? "active" : ""}`} key={step}>
              <span>{index === 0 ? <Check size={13} /> : index + 1}</span>
              <b>{step}</b>
            </div>
          ))}
        </nav>
      </section>

      <section className="workspace-grid">
        <div className="canvas-card">
          <div className="card-heading">
            <div>
              <span className="step-label">STEP 1</span>
              <h2>Upload your artwork</h2>
            </div>
            {preview && <button className="text-button" type="button" onClick={() => fileInput.current?.click()}><RotateCcw size={15}/> Replace</button>}
          </div>

          <button
            className={`dropzone ${isDragging ? "dragging" : ""} ${preview ? "has-image" : ""}`}
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              acceptFile(event.dataTransfer.files[0]);
            }}
          >
            {preview ? (
              <>
                <span className="checkerboard">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt={`Preview of ${fileName}`} />
                </span>
                <span className="file-pill"><ImagePlus size={15}/>{fileName}</span>
              </>
            ) : (
              <>
                <span className="upload-icon"><UploadCloud size={28} /></span>
                <strong>Drop your image here</strong>
                <p>or click to choose a file</p>
                <span className="formats">PNG · JPG · WEBP · up to 20 MB</span>
              </>
            )}
          </button>
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => acceptFile(event.target.files?.[0])}
          />
          <div className="local-processing"><LockKeyhole size={15}/><span><b>Private by design.</b> Nothing is uploaded or stored.</span></div>
        </div>

        <aside className="settings-card">
          <div className="card-heading compact">
            <div>
              <span className="step-label">NEXT</span>
              <h2>Vector settings</h2>
            </div>
          </div>
          <div className="setting-row disabled-row">
            <div><label>Number of colors</label><small>Choose 2–20 colors</small></div>
            <span className="value-box">8</span>
          </div>
          <div className="fake-slider"><i /></div>
          <div className="setting-row disabled-row">
            <div><label>Clean up</label><small>Remove tiny speckles</small></div>
          </div>
          <div className="segmented disabled-row"><button>None</button><button>Light</button><button className="selected">Medium</button><button>Strong</button></div>
          <button className="primary-button" type="button" disabled={!preview}>
            <Sparkles size={17}/> Continue to colors
          </button>
          <p className="button-hint">Transparent edges will be trimmed automatically.</p>
        </aside>
      </section>
    </main>
  );
}
