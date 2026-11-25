import { describe, expect, it } from "vitest";
import type { CanvasDeadline } from "./backend";
import { canvasCompleted, canvasRemotelyCompleted, canvasSubmissionLabel } from "./canvas-status";

function canvasDdl(patch: Partial<CanvasDeadline> = {}): CanvasDeadline {
  return { instanceUrl: "https://oc.sjtu.edu.cn", userId: "42", courseId: "7", assignmentId: "9", title: "Report", courseName: "Course", description: "", dueAt: "2026-10-24T15:59:00Z", lockAt: null, htmlUrl: "", workflowState: "unsubmitted", submittedAt: null, grade: null, localCompleted: false, ...patch };
}

describe("Canvas submission completion", () => {
  it.each(["submitted", "graded", "pending_review"])("checks %s even without a submission timestamp", (workflowState) => {
    const item = canvasDdl({ workflowState });
    expect(canvasCompleted(item)).toBe(true);
    expect(canvasRemotelyCompleted(item)).toBe(true);
  });
  it("uses submission timestamps and preserves the distinction from manual completion", () => {
    expect(canvasCompleted(canvasDdl({ submittedAt: "2026-10-24T00:00:00Z" }))).toBe(true);
    const manual = canvasDdl({ localCompleted: true });
    expect(canvasCompleted(manual)).toBe(true);
    expect(canvasRemotelyCompleted(manual)).toBe(false);
    expect(canvasSubmissionLabel(manual)).toBe("未提交 · 本地已完成");
    expect(canvasCompleted(canvasDdl())).toBe(false);
    expect(canvasSubmissionLabel(canvasDdl())).toBe("未提交");
    expect(canvasCompleted(canvasDdl({ workflowState: "published" }))).toBe(false);
  });
});
