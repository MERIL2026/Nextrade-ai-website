import React, { useState } from 'react';
import { motion } from 'motion/react';
import { FINTECH_EASE } from '../lib/motionPrimitives';

interface SparklineProps {
  values: number[];
  positive?: boolean;
  monochrome?: boolean;
  strokeOverride?: string;
  width?: number;
  height?: number;
  className?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  values,
  positive = true,
  monochrome = false,
  strokeOverride,
  width = 112,
  height = 36,
  className = '',
}) => {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 3;

  const points = values.map((val, idx) => {
    const x =
      values.length === 1 ? width / 2 : (idx / (values.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((val - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const strokeColor = strokeOverride
    ? strokeOverride
    : monochrome
      ? '#080B12'
      : positive
        ? '#16A34A'
        : '#DC2626';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(' ')}
      />
    </svg>
  );
};

interface InteractiveChartProps {
  data: { label: string; price: number }[];
  currency: 'INR' | 'USD';
  positive: boolean;
  height?: number;
}

export const InteractivePriceChart: React.FC<InteractiveChartProps> = ({
  data,
  currency,
  positive,
  height = 220,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data.length) {
    return (
      <div className="h-[220px] flex items-center justify-center text-sm text-[#667085]">
        No price series available
      </div>
    );
  }

  const width = 640;
  const padTop = 18;
  const padBottom = 26;
  const padX = 12;

  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const coords = data.map((d, i) => {
    const x =
      data.length === 1
        ? width / 2
        : padX + (i / (data.length - 1)) * (width - padX * 2);
    const y =
      padTop + ((max - d.price) / range) * (height - padTop - padBottom);
    return { x, y, ...d };
  });

  const linePath = coords
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(' ');

  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(
    height - padBottom
  ).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(height - padBottom).toFixed(1)} Z`;

  const activePoint = hoverIdx !== null ? coords[hoverIdx] : coords[coords.length - 1];
  const strokeColor = positive ? '#16A34A' : '#DC2626';
  const currencyPrefix = currency === 'INR' ? '₹' : '$';

  return (
    <div className="relative w-full select-none">
      <div className="flex items-center justify-between text-xs text-[#667085] mb-2 tabular-nums">
        <span>
          {hoverIdx !== null ? `Point: ${activePoint.label}` : `Latest: ${activePoint.label}`}
        </span>
        <span className="font-mono font-semibold text-[#080B12]">
          {currencyPrefix}
          {activePoint.price.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible"
        role="img"
        aria-label="Interactive price movement chart"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={`chart-fill-${positive ? 'up' : 'down'}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.14" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {[0.2, 0.5, 0.8].map((ratio) => {
          const y = padTop + ratio * (height - padTop - padBottom);
          return (
            <line
              key={ratio}
              x1={padX}
              x2={width - padX}
              y1={y}
              y2={y}
              stroke="#E4E8F2"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
          );
        })}

        <motion.path
          key={`area-${linePath}`}
          d={areaPath}
          fill={`url(#chart-fill-${positive ? 'up' : 'down'})`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.42, ease: FINTECH_EASE }}
        />
        <motion.path
          key={`line-${linePath}`}
          d={linePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0.5 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.48, ease: FINTECH_EASE }}
        />

        <motion.line
          animate={{ x1: activePoint.x, x2: activePoint.x }}
          transition={{ duration: 0.12, ease: FINTECH_EASE }}
          y1={padTop}
          y2={height - padBottom}
          stroke="#CBD5E1"
          strokeWidth="1"
        />
        <motion.circle
          animate={{ cx: activePoint.x, cy: activePoint.y }}
          transition={{ duration: 0.12, ease: FINTECH_EASE }}
          r="4.5"
          fill="#FFFFFF"
          stroke={strokeColor}
          strokeWidth="2"
        />

        {coords.map((pt, i) => {
          if (i !== 0 && i !== Math.floor(coords.length / 2) && i !== coords.length - 1) {
            return null;
          }
          return (
            <text
              key={pt.label + i}
              x={pt.x}
              y={height - 6}
              textAnchor={i === 0 ? 'start' : i === coords.length - 1 ? 'end' : 'middle'}
              fill="#667085"
              fontSize="11"
              fontFamily="JetBrains Mono, monospace"
            >
              {pt.label}
            </text>
          );
        })}

        {coords.map((pt, i) => {
          const sliceWidth = (width - padX * 2) / coords.length;
          return (
            <rect
              key={`hit-${i}`}
              x={pt.x - sliceWidth / 2}
              y={0}
              width={sliceWidth}
              height={height}
              fill="transparent"
              className="cursor-crosshair"
              onMouseEnter={() => setHoverIdx(i)}
            />
          );
        })}
      </svg>
    </div>
  );
};
