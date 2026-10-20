import { invoke } from "@tauri-apps/api/core";

export interface BackendStatus {
  database: "sqlite";
  schemaVersion: number;
}

export function getBackendStatus(): Promise<BackendStatus> {
  return invoke<BackendStatus>("get_backend_status");
}
