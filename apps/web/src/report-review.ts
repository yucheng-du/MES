export type AutoReviewSettings = {
  revision: number;
  enabled: boolean;
  delayMinutes: number;
  maxAmount: number;
  minDurationRatio: number;
  requireFullQuantity: boolean;
  eligibleFrom: string | null;
  activatedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type AutoReviewRun = {
  id: string;
  status: "running" | "completed" | "failed" | "skipped";
  trigger: "startup" | "timer" | "manual";
  startedAt: string;
  finishedAt: string | null;
  ruleRevision: number;
  scannedCount: number;
  approvedCount: number;
  manualCount: number;
  skippedCount: number;
  errorCount: number;
  errorMessage: string | null;
};

export type AutoReviewResponse = {
  settings: AutoReviewSettings;
  summary: {
    pendingAutomatic: number;
    awaitingDelay: number;
    readyAutomatic: number;
    manualRequired: number;
    approvedAutomatically: number;
    approvedManually: number;
  };
  lastRun: AutoReviewRun | null;
};

type ReportReview = {
  id?: string;
  status?: string;
  approvalMode?: "manual" | "automatic" | null;
  autoReviewStatus?: "not_applicable" | "pending" | "manual" | "approved";
  autoReviewReasons?: string[];
  autoReviewEligibleAt?: string | null;
};

/** Final approval and manual handoff take priority over a previous automatic wait. */
export function reportReviewPresentation(report: ReportReview): {
  label: string;
  color: string;
  reasons: string[];
  eligibleAt?: string | null;
} {
  if (report.status === "approved") {
    if (report.approvalMode === "automatic")
      return { label: "自动批准", color: "green", reasons: [] };
    if (report.approvalMode === "manual")
      return { label: "人工批准", color: "cyan", reasons: [] };
    return { label: "已批准", color: "green", reasons: [] };
  }
  if (report.status === "rejected")
    return { label: "已退回", color: "red", reasons: [] };
  if (report.status !== "complete")
    return { label: "完工后检查", color: "default", reasons: [] };
  if (report.autoReviewStatus === "manual")
    return {
      label: "待人工",
      color: "gold",
      reasons: report.autoReviewReasons?.length
        ? report.autoReviewReasons
        : ["需要人工核对"],
    };
  if (report.autoReviewStatus === "pending")
    return {
      label: "待自动检查",
      color: "blue",
      reasons: [],
      eligibleAt: report.autoReviewEligibleAt,
    };
  return { label: "待审核", color: "default", reasons: [] };
}

export type AutoReviewFormValues = Pick<
  AutoReviewSettings,
  "enabled" | "delayMinutes" | "maxAmount" | "requireFullQuantity"
> & { minDurationPercent: number };

export function autoReviewFormValues(
  settings: AutoReviewSettings,
): AutoReviewFormValues {
  return {
    enabled: settings.enabled,
    delayMinutes: settings.delayMinutes,
    maxAmount: settings.maxAmount,
    minDurationPercent: Math.round(settings.minDurationRatio * 10000) / 100,
    requireFullQuantity: settings.requireFullQuantity,
  };
}

export function autoReviewPayload(
  revision: number,
  values: AutoReviewFormValues,
) {
  return {
    revision,
    enabled: values.enabled,
    delayMinutes: values.delayMinutes,
    maxAmount: values.maxAmount,
    minDurationRatio: values.minDurationPercent / 100,
    requireFullQuantity: values.requireFullQuantity,
  };
}
