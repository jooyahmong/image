import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "./app/page";
import LandingPage from "./app/landing-page";
import "./app/globals.css";
import "./app/landing.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("WOOJOO Image root element was not found.");
}

const isLandingPage = window.location.pathname.replace(/\/+$/, "") === "/landing";

createRoot(root).render(
  <StrictMode>
    {isLandingPage ? <LandingPage /> : <Home />}
  </StrictMode>,
);
