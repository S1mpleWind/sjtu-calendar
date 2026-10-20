import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("desktop bootstrap screen", () => {
  afterEach(() => cleanup());
  beforeEach(() => invoke.mockReset());

  it("shows the SQLite schema version returned by the Rust command", async () => {
    invoke.mockResolvedValue({ database: "sqlite", schemaVersion: 1 });
    render(<App />);

    await userEvent.setup().click(screen.getByRole("button", { name: "检查本地存储" }));

    expect(await screen.findByRole("status")).toHaveTextContent("SQLite 已连接 · 迁移版本 1");
    expect(invoke).toHaveBeenCalledWith("get_backend_status");
  });

});
