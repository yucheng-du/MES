# Automatic production-report approval

[简体中文](AUTO-REVIEW.zh-CN.md) · English

Automatic approval applies to completed production reports and their piecework pay. The server periodically checks eligible reports, posts approved pay, and refers exceptions to a manual queue with specific reasons. Closing the web application or Android client does not stop background checks.

## Settings and defaults

Administrators and production managers configure this feature under **Report Approval → Automatic approval settings**. Saved settings take effect immediately and persist in the database.

| Setting                                            | Default   | Meaning                                                                                                                                                     |
| -------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic approval                                 | Enabled   | Disabling stops automatic approvals; manual review remains available                                                                                        |
| Delay                                              | 5 minutes | Measured from report completion; the report is checked after the delay                                                                                      |
| Amount limit per report                            | CNY 2,000 | Uses the work order's snapshot rate; larger amounts require manual review                                                                                   |
| Minimum duration ratio                             | 0%        | Standard-time checks are off by default. At 10%, actual processing time below `standard minutes per unit × completed quantity × 10%` requires manual review |
| Require received and completed quantities to match | Off       | Normal partial completion is allowed by default; enabling this rule refers mismatches for manual review                                                     |

The server checks every 60 seconds and checks due reports at startup. **Check now** follows the same rules and does not bypass the delay or disabled setting. With the default delay, eligible reports are normally handled within the next minute after five minutes have elapsed.

Initial activation and reactivation record an eligibility boundary. Reports completed before that boundary remain for manual review; enabling the feature does not approve the existing backlog. Changes to the delay, amount limit, or other rules affect new reports that have not already been referred for manual review. Reports already in the manual queue stay there.

## Reports requiring manual review

- Reports manually rejected and then resubmitted; historical rejection records are also recognized from the audit log.
- A closed work order, a disabled operator, or pending or approved scrap on the same work order.
- Zero completed quantity, invalid quantities, or invalid start/completion times.
- An amount above the configured limit, or failure to meet enabled quantity-matching or minimum-duration checks.
- Historical reports completed before activation.
- Execution conflicts that cannot be resolved automatically, such as duplicate pay sources, invalid amounts, or business constraints in the database.

Referral to manual review does not reject the report back to the worker or reverse recorded physical completion. Managers or quality inspectors can review the reasons and approve or reject the report. Pay is created only on approval, so normal reports no longer require individual manual clicks.

## Execution and traceability

The report list distinguishes automatic approvals, manual approvals, reports waiting for automatic checks, and reports requiring manual review. It displays the reasons for referral. The settings panel shows queue totals and the latest run result. Automatic approval records the system as the source, along with the rule revision and run ID; manual approval records the actual reviewer.

Automatic and manual approval share a transaction for each report. The report state, pay entry, and audit record commit together. Repeated runs, multiple server instances, and concurrent manual review cannot create duplicate pay. Temporary connection failures, timeouts, and deadlocks are recorded as execution failures, and unsuccessful reports are checked again after recovery. Confirmed pay-source or business-constraint conflicts go to manual review. Neither class of error is treated as an approval.

Disabling is coordinated with approval transactions: an in-progress transaction completes first, and after the disable request succeeds, subsequent reports cannot be automatically approved using the previous settings.

This feature does not automatically approve scrap, quality inspections, or other management records. Those retain their own ownership and review workflows.
