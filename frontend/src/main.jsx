import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { OFFLINE } from "./config/offline";
import "./styles.css";
createRoot(document.getElementById("root")).render(<React.StrictMode><ErrorBoundary text={{ error_title: OFFLINE.title, error_body: OFFLINE.body, retry: OFFLINE.retry }} onRetry={() => window.location.reload()}><App /></ErrorBoundary></React.StrictMode>);
