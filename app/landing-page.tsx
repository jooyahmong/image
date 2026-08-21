import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Crop,
  Download,
  ImageIcon,
  Layers3,
  LockKeyhole,
  Palette,
  Scissors,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  WandSparkles,
} from "lucide-react";

type Language = "en" | "ko";

const copy = {
  en: {
    nav: ["Features", "How it works", "Privacy"],
    navLinks: ["#features", "#workflow", "#privacy"],
    open: "Open editor",
    eyebrow: "RASTER TO VECTOR",
    title: "Turn simple images into clean, editable SVGs.",
    intro: "Upload your artwork, reduce colors, remove unwanted backgrounds, refine every shape, and export — all in one private workspace.",
    primary: "Start vectorizing",
    secondary: "See how it works",
    proof: ["Free to use", "No sign-up", "Runs on your device"],
    benefitEyebrow: "BUILT FOR SIMPLE ARTWORK",
    benefitTitle: "From upload to polished vector in four clear steps.",
    benefitIntro: "Made for icons, stickers, clipart, simple illustrations, lettering, and other flat artwork.",
    workflow: [
      { step: "01", title: "Crop before you trace", text: "Upload PNG, JPG, or WEBP and select only the area you need. Start without unnecessary whitespace." },
      { step: "02", title: "Tune colors and curves", text: "Choose the color count, smoothness, and anchor simplification that best fits your artwork." },
      { step: "03", title: "Edit the palette precisely", text: "Merge similar colors, remove a background, recolor shapes, or protect fine details with the brush." },
      { step: "04", title: "Auto-crop and export", text: "Fit the canvas to the finished artwork and save grouped, fill-only SVG paths or transparent PNG files." },
    ],
    featureEyebrow: "WHY WOOJOO IMAGE",
    featureTitle: "The essentials, without the heavyweight editor.",
    features: [
      { title: "Editable output", text: "Download real SVG paths that remain easy to edit in vector design tools." },
      { title: "Object-by-object export", text: "Detect disconnected objects and save each one on its own fitted canvas." },
      { title: "Background removal", text: "Highlight likely background colors, inspect the result, and delete only what you choose." },
      { title: "Fast local processing", text: "Your artwork is processed in the browser without an upload queue or account." },
    ],
    privacyEyebrow: "PRIVATE BY DESIGN",
    privacyTitle: "Your image stays on this device.",
    privacyText: "WOOJOO Image does not upload or store your artwork. Color reduction, vector tracing, palette editing, cropping, and export happen locally in your browser.",
    privacyItems: ["No account", "No image storage", "No paid API", "No hidden user charge"],
    finalTitle: "Ready to make a cleaner SVG?",
    finalText: "Open the editor, drop in an image, and create your first vector for free.",
    faqTitle: "Common questions",
    faqs: [
      ["What images work best?", "Icons, stickers, clipart, lettering, logos, and flat illustrations with clear color areas produce the cleanest results."],
      ["Is WOOJOO Image free?", "Yes. There is no sign-up, subscription, export fee, or paid feature in the current version."],
      ["Are my images uploaded?", "No. Image processing happens inside your browser and the artwork is not uploaded or stored by WOOJOO Image."],
      ["Can I keep editing the SVG?", "Yes. Exports use editable SVG paths grouped by color, with strokes converted to filled shapes for wider compatibility."],
    ],
    copyright: "All rights reserved.",
  },
  ko: {
    nav: ["주요 기능", "사용 방법", "개인정보 보호"],
    navLinks: ["#features", "#workflow", "#privacy"],
    open: "편집기 열기",
    eyebrow: "래스터에서 벡터로",
    title: "단순한 이미지를 깔끔하고 편집 가능한 SVG로.",
    intro: "이미지를 올리고, 색상을 줄이고, 불필요한 배경을 지우고, 모양을 다듬어 내보내기까지 한곳에서 완성하세요.",
    primary: "무료로 시작하기",
    secondary: "사용 방법 보기",
    proof: ["무료 사용", "가입 불필요", "내 기기에서 처리"],
    benefitEyebrow: "단순한 이미지에 최적화",
    benefitTitle: "업로드부터 벡터 완성까지, 네 단계면 충분해요.",
    benefitIntro: "아이콘, 스티커, 클립아트, 단순 일러스트, 레터링처럼 색상 면이 분명한 이미지에 잘 맞습니다.",
    workflow: [
      { step: "01", title: "올리면서 바로 크롭", text: "PNG, JPG, WEBP 이미지를 올리고 필요한 영역만 먼저 선택하세요. 불필요한 여백 없이 시작할 수 있어요." },
      { step: "02", title: "색상과 곡선 조절", text: "작품에 맞춰 색상 수, 부드러움, 앵커 단순화 정도를 직접 조절하세요." },
      { step: "03", title: "팔레트를 정확하게 수정", text: "비슷한 색을 합치고, 배경을 지우고, 색을 바꾸거나 브러시로 섬세한 영역을 보호할 수 있어요." },
      { step: "04", title: "자동 크롭 후 내보내기", text: "완성된 오브젝트에 캔버스를 자동으로 맞추고, 그룹화된 면 중심 SVG 또는 투명 PNG로 저장하세요." },
    ],
    featureEyebrow: "WOOJOO IMAGE를 쓰는 이유",
    featureTitle: "무거운 편집기 없이 필요한 기능만 간단하게.",
    features: [
      { title: "계속 편집 가능한 결과", text: "벡터 편집 도구에서 다시 손볼 수 있는 실제 SVG 패스로 저장합니다." },
      { title: "오브젝트별 저장", text: "떨어져 있는 오브젝트를 감지해 각각 맞춤 캔버스로 따로 저장할 수 있습니다." },
      { title: "선택적인 배경 제거", text: "배경으로 추정되는 색상을 강조해 확인한 뒤 원하는 색만 삭제할 수 있습니다." },
      { title: "빠른 기기 내 처리", text: "업로드 대기나 계정 없이 브라우저에서 바로 이미지가 처리됩니다." },
    ],
    privacyEyebrow: "개인정보 보호 설계",
    privacyTitle: "이미지는 사용자의 기기에만 머뭅니다.",
    privacyText: "WOOJOO Image는 작품을 서버에 업로드하거나 저장하지 않습니다. 색상 축소, 벡터 변환, 팔레트 수정, 크롭, 내보내기까지 모두 브라우저 안에서 처리됩니다.",
    privacyItems: ["회원가입 없음", "이미지 저장 없음", "유료 API 없음", "사용자 숨은 과금 없음"],
    finalTitle: "더 깔끔한 SVG를 만들어 볼까요?",
    finalText: "편집기를 열고 이미지를 올려 첫 번째 벡터를 무료로 만들어 보세요.",
    faqTitle: "자주 묻는 질문",
    faqs: [
      ["어떤 이미지에 가장 잘 맞나요?", "아이콘, 스티커, 클립아트, 레터링, 로고, 단순 일러스트처럼 색상 영역이 분명한 이미지에서 가장 깔끔한 결과가 나옵니다."],
      ["정말 무료인가요?", "네. 현재 버전에는 회원가입, 구독, 내보내기 비용 또는 유료 기능이 없습니다."],
      ["이미지가 서버로 올라가나요?", "아니요. 이미지 처리는 브라우저 안에서 이루어지며 WOOJOO Image가 작품을 업로드하거나 저장하지 않습니다."],
      ["내보낸 SVG를 다시 편집할 수 있나요?", "네. 색상별로 그룹화된 편집 가능한 SVG 패스로 저장하며, 호환성을 위해 선은 면으로 변환됩니다."],
    ],
    copyright: "모든 권리 보유.",
  },
} as const;

const icons = [Scissors, WandSparkles, Palette, Download];
const featureIcons = [Sparkles, Layers3, Crop, LockKeyhole];

export default function LandingPage() {
  const [language, setLanguage] = useState<Language>(() => new URLSearchParams(window.location.search).get("lang") === "ko" ? "ko" : "en");
  const content = copy[language];
  const editorUrl = language === "ko" ? "/?lang=ko" : "/";
  const media = useMemo(() => ({
    hero: `/landing/hero-${language}.png`,
    workflow: ["upload", "settings", "palette", "export"].map((name) => `/landing/${name}-${language}.png`),
  }), [language]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === "ko" ? "WOOJOO Image | 간단한 이미지 벡터 변환" : "WOOJOO Image | Simple image to SVG converter";
    document.querySelector('meta[name="description"]')?.setAttribute("content", language === "ko"
      ? "이미지를 기기 안에서 색상 축소, 배경 제거, 팔레트 수정, 자동 크롭 후 편집 가능한 SVG로 변환하세요."
      : "Reduce colors, remove backgrounds, edit palettes, auto-crop, and export clean SVG artwork privately in your browser.");
  }, [language]);

  const changeLanguage = (next: Language) => {
    setLanguage(next);
    const url = new URL(window.location.href);
    if (next === "ko") url.searchParams.set("lang", "ko"); else url.searchParams.delete("lang");
    window.history.replaceState({}, "", url);
  };

  return (
    <main className="landing-page">
      <header className="landing-nav">
        <a className="landing-logo" href={language === "ko" ? "/landing?lang=ko" : "/landing"} aria-label="WOOJOO Image landing page">
          <img src="/logo.png" alt="WOOJOO Image" width="338" height="93" />
        </a>
        <nav aria-label={language === "ko" ? "주요 메뉴" : "Primary navigation"}>
          {content.nav.map((item, index) => <a href={content.navLinks[index]} key={item}>{item}</a>)}
        </nav>
        <div className="landing-nav-actions">
          <div className="landing-language" aria-label={language === "ko" ? "언어 선택" : "Choose language"}>
            <button className={language === "en" ? "active" : ""} type="button" onClick={() => changeLanguage("en")}>ENG</button>
            <span>/</span>
            <button className={language === "ko" ? "active" : ""} type="button" onClick={() => changeLanguage("ko")}>한국어</button>
          </div>
          <a className="landing-nav-cta" href={editorUrl}>{content.open}<ArrowRight size={16} /></a>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="landing-eyebrow">{content.eyebrow}</span>
          <h1>{content.title}</h1>
          <p>{content.intro}</p>
          <div className="landing-hero-actions">
            <a className="landing-button primary" href={editorUrl}>{content.primary}<ArrowRight size={19} /></a>
            <a className="landing-button secondary" href="#workflow">{content.secondary}</a>
          </div>
          <ul className="landing-proof" aria-label={language === "ko" ? "서비스 특징" : "Service highlights"}>
            {content.proof.map((item) => <li key={item}><Check size={15} />{item}</li>)}
          </ul>
        </div>
        <div className={`landing-hero-visual ${language}`}>
          <div className="landing-visual-tag"><ShieldCheck size={18} />{language === "ko" ? "이미지는 서버에 업로드되지 않아요" : "Your image never leaves this device"}</div>
          <img src={media.hero} alt={language === "ko" ? "WOOJOO Image 한국어 사용 화면" : "WOOJOO Image editor on mobile"} width={language === "ko" ? 1080 : 1179} height={language === "ko" ? 1350 : 2556} fetchPriority="high" />
          <div className="landing-floating-card"><Sparkles size={18} /><span><b>SVG</b>{language === "ko" ? "편집 가능한 벡터" : "Editable vector paths"}</span></div>
        </div>
      </section>

      <section className="landing-trust" aria-label={language === "ko" ? "지원 기능" : "Supported features"}>
        <span><UploadCloud size={20} />PNG · JPG · WEBP</span>
        <span><Palette size={20} />{language === "ko" ? "색상 축소 및 수정" : "Color reduction & editing"}</span>
        <span><Crop size={20} />{language === "ko" ? "자동 크롭" : "Automatic crop"}</span>
        <span><Download size={20} />SVG · PNG</span>
      </section>

      <section className="landing-intro" id="features">
        <span className="landing-eyebrow">{content.benefitEyebrow}</span>
        <div>
          <h2>{content.benefitTitle}</h2>
          <p>{content.benefitIntro}</p>
        </div>
      </section>

      <section className="landing-workflow" id="workflow">
        {content.workflow.map((item, index) => {
          const Icon = icons[index];
          return (
            <article className="landing-workflow-card" key={item.step}>
              <div className="landing-workflow-copy">
                <span>{item.step}</span>
                <Icon size={23} />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
              <div className="landing-workflow-media">
                <img src={media.workflow[index]} alt={item.title} width={language === "ko" ? 1080 : 1179} height={language === "ko" ? 1350 : 2556} loading="lazy" />
              </div>
            </article>
          );
        })}
      </section>

      <section className="landing-feature-section">
        <div className="landing-section-heading">
          <span className="landing-eyebrow">{content.featureEyebrow}</span>
          <h2>{content.featureTitle}</h2>
        </div>
        <div className="landing-feature-grid">
          {content.features.map((item, index) => {
            const Icon = featureIcons[index];
            return <article key={item.title}><span><Icon size={23} /></span><h3>{item.title}</h3><p>{item.text}</p></article>;
          })}
        </div>
      </section>

      <section className="landing-privacy" id="privacy">
        <div className="landing-privacy-icon"><ShieldCheck size={42} /></div>
        <div>
          <span className="landing-eyebrow">{content.privacyEyebrow}</span>
          <h2>{content.privacyTitle}</h2>
          <p>{content.privacyText}</p>
          <ul>{content.privacyItems.map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul>
        </div>
      </section>

      <section className="landing-faq">
        <div className="landing-section-heading"><span className="landing-eyebrow">FAQ</span><h2>{content.faqTitle}</h2></div>
        <div className="landing-faq-list">
          {content.faqs.map(([question, answer], index) => <details key={question} open={index === 0}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}
        </div>
      </section>

      <section className="landing-final-cta">
        <ImageIcon size={36} />
        <h2>{content.finalTitle}</h2>
        <p>{content.finalText}</p>
        <a className="landing-button light" href={editorUrl}>{content.primary}<ArrowRight size={19} /></a>
      </section>

      <footer className="landing-footer">
        <a className="landing-logo" href={language === "ko" ? "/landing?lang=ko" : "/landing"}><img src="/logo.png" alt="WOOJOO Image" width="338" height="93" loading="lazy" /></a>
        <p>© {new Date().getFullYear()} WoojooLand. {content.copyright}</p>
        <div><a href="#privacy">{language === "ko" ? "개인정보 이용 안내" : "Privacy"}</a><a href={editorUrl}>{content.open}</a></div>
      </footer>
    </main>
  );
}
