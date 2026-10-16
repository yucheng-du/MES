import assert from "node:assert/strict";
import test from "node:test";
import {
  autoReviewFormValues,
  autoReviewPayload,
  reportReviewPresentation,
  type AutoReviewSettings,
} from "./report-review";

test("manual handoff shows its actual reasons and never presents a stale automatic deadline", () => {
  const view = reportReviewPresentation({
    status: "complete",
    autoReviewStatus: "manual",
    autoReviewReasons: ["曾退回后重新提交", "该工单有报废记录"],
    autoReviewEligibleAt: "2026-10-15T10:00:00Z",
  });
  assert.equal(view.label, "待人工");
  assert.deepEqual(view.reasons, ["曾退回后重新提交", "该工单有报废记录"]);
  assert.equal(view.eligibleAt, undefined);
});

test("final human decision takes precedence over automatic check state", () => {
  assert.equal(
    reportReviewPresentation({
      status: "approved",
      approvalMode: "manual",
      autoReviewStatus: "approved",
    }).label,
    "人工批准",
  );
  assert.equal(
    reportReviewPresentation({
      status: "rejected",
      autoReviewStatus: "pending",
    }).label,
    "已退回",
  );
  assert.equal(
    reportReviewPresentation({ status: "approved", approvalMode: "automatic" })
      .label,
    "自动批准",
  );
});

test("percentage editing preserves the backend ratio and sends only editable settings", () => {
  const settings: AutoReviewSettings = {
    revision: 7,
    enabled: true,
    delayMinutes: 5,
    maxAmount: 2000,
    minDurationRatio: 0.125,
    requireFullQuantity: false,
    eligibleFrom: "2026-10-15T10:00:00Z",
    activatedAt: "2026-10-15T10:00:00Z",
    updatedAt: null,
    updatedBy: null,
  };
  const values = autoReviewFormValues(settings);
  assert.equal(values.minDurationPercent, 12.5);
  assert.deepEqual(autoReviewPayload(settings.revision, values), {
    revision: 7,
    enabled: true,
    delayMinutes: 5,
    maxAmount: 2000,
    minDurationRatio: 0.125,
    requireFullQuantity: false,
  });
  assert.equal(
    autoReviewPayload(7, { ...values, minDurationPercent: 0 }).minDurationRatio,
    0,
  );
});
