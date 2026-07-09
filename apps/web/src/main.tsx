import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

if (import.meta.env.MODE === "development") {
  await import("./mocks");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
