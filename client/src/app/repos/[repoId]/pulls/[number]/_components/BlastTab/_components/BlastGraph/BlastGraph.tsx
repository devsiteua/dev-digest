"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import {
  COLUMN_X,
  JUNCTION_X,
  MIN_HEIGHT,
  NODE_HEIGHT,
  ROW_PITCH,
  VIEW_WIDTH,
} from "./constants";
import { column, edgePath, truncate } from "./helpers";
import { s } from "./styles";

interface BlastGraphProps {
  /** The symbol the graph is drawn for, or null when nothing has callers. */
  subject: DownstreamImpact | null;
}

/**
 * The graph drill-in: one changed symbol, its callers, and the endpoints
 * downstream of them — the design's `BlastRadiusGraph`, with one deliberate
 * difference.
 *
 * The design draws an edge from two arbitrary caller nodes to every endpoint,
 * which its fixture can afford because nothing depends on it. Real data cannot:
 * `endpoints_affected` is computed per SYMBOL, over everything downstream of all
 * of that symbol's callers together, so the server does not know — and this
 * component must not imply — which individual caller leads to which route.
 * The edges therefore converge on one junction before fanning out, which says
 * "downstream of these callers" and claims nothing more.
 */
export function BlastGraph({ subject }: BlastGraphProps) {
  const t = useTranslations("blast");

  if (!subject || subject.callers.length === 0) {
    return <div style={s.empty}>{t("graph.empty")}</div>;
  }

  const callers = subject.callers;
  const endpoints = subject.endpoints_affected;
  const rows = Math.max(callers.length, endpoints.length, 1);
  const height = Math.max(MIN_HEIGHT, rows * ROW_PITCH + NODE_HEIGHT);

  const root = { x: COLUMN_X.root, y: height / 2, label: `${subject.symbol}()` };
  const callerNodes = column(callers.map((c) => c.name), COLUMN_X.callers, height);
  const endpointNodes = column(endpoints, COLUMN_X.endpoints, height);
  const junction = { x: JUNCTION_X, y: height / 2 };

  return (
    <div style={s.scroller}>
      <svg
        width={VIEW_WIDTH}
        height={height}
        role="img"
        aria-label={t("graph.ariaLabel")}
        style={s.svg}
      >
        {callerNodes.map((node, i) => (
          <path
            key={`root-${i}`}
            d={edgePath(root, node)}
            fill="none"
            stroke="var(--border-strong)"
            strokeWidth={1.5}
          />
        ))}
        {endpointNodes.length > 0 &&
          callerNodes.map((node, i) => (
            <path
              key={`junction-${i}`}
              d={edgePath(node, junction)}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1.25}
            />
          ))}
        {endpointNodes.map((node, i) => (
          <path
            key={`endpoint-${i}`}
            d={edgePath(junction, node)}
            fill="none"
            stroke="var(--border)"
            strokeWidth={1.25}
          />
        ))}

        <Node node={root} width={110} stroke="var(--accent)" />
        {callerNodes.map((node, i) => (
          <Node key={i} node={node} width={130} stroke="var(--border-strong)" />
        ))}
        {endpointNodes.map((node, i) => (
          <Node key={i} node={node} width={160} stroke="var(--accent)" />
        ))}
      </svg>

      <div style={s.legend}>
        <span>● {t("legend.symbol")}</span>
        <span>● {t("legend.callers")}</span>
        <span>● {t("legend.endpoints")}</span>
      </div>
    </div>
  );
}

function Node({
  node,
  width,
  stroke,
}: {
  node: { x: number; y: number; label: string };
  width: number;
  stroke: string;
}) {
  return (
    <g transform={`translate(${node.x - width / 2},${node.y - NODE_HEIGHT / 2})`}>
      <rect
        width={width}
        height={NODE_HEIGHT}
        rx={6}
        fill="var(--bg-elevated)"
        stroke={stroke}
        strokeWidth={1.25}
      />
      <text
        x={width / 2}
        y={17}
        textAnchor="middle"
        fontSize={11}
        fontFamily="JetBrains Mono, monospace"
        fill="var(--text-primary)"
      >
        {truncate(node.label, width)}
      </text>
    </g>
  );
}
