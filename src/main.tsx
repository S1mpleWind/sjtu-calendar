import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Widget from "./Widget";

const widgetWindow = new URLSearchParams(window.location.search).get("window") === "widget";
if (widgetWindow) document.body.classList.add("widget-window");
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {widgetWindow ? <Widget /> : <App />}
  </React.StrictMode>,
);
