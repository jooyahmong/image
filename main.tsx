import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "./app/page";
import LandingPage from "./app/landing-page";
import ExtractElementsPage from "./app/extract-elements-page";
import BulkConvertPage from "./app/bulk-convert-page";
import "./app/globals.css";
import "./app/landing.css";
import "./app/extract-elements.css";
import "./app/bulk-convert.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("WOOJOO Image root element was not found.");
}

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const isLandingPage = pathname === "/landing";
const isExtractElementsPage = pathname === "/extract-elements";
// Hidden development route, same pattern as /extract-elements: direct URL
// access only, never linked from production nav or the landing page.
const isBulkConvertPage = pathname === "/bulk-convert";

createRoot(root).render(
  <StrictMode>
    {isLandingPage ? <LandingPage /> : isExtractElementsPage ? <ExtractElementsPage /> : isBulkConvertPage ? <BulkConvertPage /> : <Home />}
  </StrictMode>,
);
