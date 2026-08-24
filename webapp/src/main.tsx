import React from "react";
import ReactDOM from "react-dom/client";
import App from "./AppNext";
import { installClientTelemetry } from "./telemetry";
import "./styles.css";

installClientTelemetry();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
