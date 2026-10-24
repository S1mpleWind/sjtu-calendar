import type { CanvasDeadline } from "./backend";

export function canvasRemotelyCompleted(item: CanvasDeadline) {
  return !!item.submittedAt || ["submitted", "graded", "pending_review"].includes(item.workflowState ?? "");
}

export function canvasCompleted(item: CanvasDeadline) {
  return item.localCompleted || canvasRemotelyCompleted(item);
}

export function canvasSubmissionLabel(item: CanvasDeadline) {
  if (item.workflowState === "graded") return "已评分";
  if (item.workflowState === "pending_review") return "已提交（待审核）";
  if (canvasRemotelyCompleted(item)) return "已提交";
  return item.localCompleted ? "未提交 · 本地已完成" : "未提交";
}
