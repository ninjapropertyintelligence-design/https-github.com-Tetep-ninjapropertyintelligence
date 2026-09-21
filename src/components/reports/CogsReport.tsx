"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";

export interface CogsLineView {
  metricType: string;
  quantity: number;
  costMicros: number | null;
  unpriced: boolean;
}

export interface CogsPropertyView {
  propertyId: string;
  propertyName: string;
  lines: CogsLineView[];
  costMicros: number;
  hasUnpricedUsage: boolean;
}

export interface CogsReportView {
  periodStart: string;
  periodEnd: string;
  currency: string;
  properties: CogsPropertyView[];
  unattributed: { lines: CogsLineView[]; costMicros: number; hasUnpricedUsage: boolean };
  totalCostMicros: number;
  hasUnpricedUsage: boolean;
}

const METRIC_LABEL: Record<string, string> = {
  STORAGE_STANDARD_GB_MONTH: "Storage — standard (GB-months)",
  STORAGE_IA_GB_MONTH: "Storage — infrequent access (GB-months)",
  STORAGE_ARCHIVE_GB_MONTH: "Storage — archive (GB-months)",
  STORAGE_DEEP_ARCHIVE_GB_MONTH: "Storage — deep archive (GB-months)",
  BANDWIDTH_GB: "Bandwidth (GB)",
  PROCESSING_JOB: "Photogrammetry jobs",
  AI_REQUEST: "AI requests",
  AI_INPUT_TOKENS: "AI input tokens",
  AI_OUTPUT_TOKENS: "AI output tokens",
  MATTERPORT_ALLOCATION: "Matterport allocation",
  GEOCODING_REQUEST: "Geocoding requests",
  DOCUMENT_INDEX_JOB: "Document indexing jobs",
  REPORT_GENERATION: "Report generation",
  DB_USAGE: "Database usage",
};

function money(micros: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    // Input costs are routinely fractions of a cent; rounding to 2 decimals
    // would show most of this report as $0.00.
    maximumFractionDigits: 4,
  }).format(micros / 1_000_000);
}

function quantity(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(3).replace(/\.?0+$/, "");
}

/**
 * Property-level cost of goods sold (spec §50).
 *
 * Two things this deliberately does NOT do:
 *
 *  - It does not spread unattributed overhead across properties. Some costs
 *    genuinely belong to no single property; dividing them up would invent a
 *    per-property precision that was never measured. They get their own line.
 *  - It does not render unpriced usage as $0.00. Usage with no configured
 *    rate is shown as "not priced", because zero reads as free and free is
 *    the one thing it definitely is not.
 */
export function CogsReport({ report }: { report: CogsReportView }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {report.hasUnpricedUsage ? (
        <div className="rounded-lg border border-border px-4 py-3 text-sm">
          <p className="font-medium text-foreground">This total is a floor, not a total.</p>
          <p className="mt-0.5 text-muted">
            Some metered usage in this period has no configured rate, so its cost is unknown and is
            excluded from the figures below. Set the missing rates to complete the picture.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Cost to serve"
          subtitle={`${new Date(report.periodStart).toLocaleDateString()} – ${new Date(
            report.periodEnd,
          ).toLocaleDateString()}`}
        />
        <CardBody className="space-y-1 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-muted">
              Total{report.hasUnpricedUsage ? " (priced usage only)" : ""}
            </span>
            <span className="text-lg font-semibold text-foreground">
              {money(report.totalCostMicros, report.currency)}
            </span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="By property" subtitle="Highest cost first. Select a property for its breakdown." />
        <CardBody className="p-0">
          {report.properties.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">
              No usage was attributed to a property in this period.
            </p>
          ) : (
            <ul>
              {report.properties.map((p) => (
                <li key={p.propertyId} className="border-b border-border last:border-0">
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === p.propertyId ? null : p.propertyId)}
                    className="flex w-full items-center justify-between px-5 py-2.5 text-left text-sm hover:bg-background"
                  >
                    <span className="font-medium text-foreground">
                      {p.propertyName}
                      {p.hasUnpricedUsage ? (
                        <span className="ml-2 text-xs font-normal text-muted">(has unpriced usage)</span>
                      ) : null}
                    </span>
                    <span className="font-medium text-foreground">
                      {money(p.costMicros, report.currency)}
                    </span>
                  </button>
                  {expanded === p.propertyId ? <Lines lines={p.lines} currency={report.currency} /> : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Organization overhead"
          subtitle="Metered consumption that belongs to no single property — reported on its own rather than divided up."
        />
        <CardBody className="p-0">
          {report.unattributed.lines.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">No unattributed usage in this period.</p>
          ) : (
            <>
              <Lines lines={report.unattributed.lines} currency={report.currency} />
              <div className="flex items-center justify-between border-t border-border px-5 py-2.5 text-sm">
                <span className="text-muted">Overhead total</span>
                <span className="font-medium text-foreground">
                  {money(report.unattributed.costMicros, report.currency)}
                </span>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Lines({ lines, currency }: { lines: CogsLineView[]; currency: string }) {
  return (
    <ul className="bg-background">
      {lines.map((line) => (
        <li
          key={line.metricType}
          className="flex items-center justify-between border-b border-border px-5 py-2 text-sm last:border-0"
        >
          <div>
            <p className="text-foreground">{METRIC_LABEL[line.metricType] ?? line.metricType}</p>
            <p className="text-xs text-muted">{quantity(line.quantity)} units</p>
          </div>
          <span className={line.costMicros === null ? "text-xs text-muted" : "text-foreground"}>
            {line.costMicros === null ? "not priced" : money(line.costMicros, currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}
