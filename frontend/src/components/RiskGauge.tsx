import React, { useState, useEffect, useMemo } from 'react';
import { RiskScore, LiquidationPrediction } from '../risk/riskEngine';

interface RiskGaugeProps {
  riskScore?: RiskScore;
  liquidationPrediction?: LiquidationPrediction;
  size?: number;
  className?: string;
}

interface GaugeConfig {
  centerX: number;
  centerY: number;
  radius: number;
  startAngle: number;
  endAngle: number;
  strokeWidth: number;
}

export default function Component({ 
  riskScore, 
  liquidationPrediction,
  size = 200,
  className = ''
}: RiskGaugeProps) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const config: GaugeConfig = useMemo(() => ({
    centerX: size / 2,
    centerY: size / 2,
    radius: (size / 2) - 30,
    startAngle: -135,
    endAngle: 135,
    strokeWidth: 20
  }), [size]);

  const currentScore = useMemo(() => {
    if (riskScore) {
      const healthRisk = Math.max(0, (2 - riskScore.healthFactor) * 50);
      const volatilityRisk = Math.min(100, riskScore.volatilityScore * 100);
      const mlRisk = riskScore.mlRiskScore || 0;
      return Math.min(100, Math.max(0, (healthRisk + volatilityRisk + mlRisk) / 3));
    }
    if (liquidationPrediction) {
      return Math.min(100, liquidationPrediction.probability * 100);
    }
    return 0;
  }, [riskScore, liquidationPrediction]);

  useEffect(() => {
    if (currentScore !== animatedScore) {
      setIsAnimating(true);
      const duration = 1500;
      const steps = 60;
      const stepValue = (currentScore - animatedScore) / steps;
      let currentStep = 0;

      const interval = setInterval(() => {
        currentStep++;
        setAnimatedScore(prev => {
          const newValue = prev + stepValue;
          if (currentStep >= steps) {
            clearInterval(interval);
            setIsAnimating(false);
            return currentScore;
          }
          return newValue;
        });
      }, duration / steps);

      return () => clearInterval(interval);
    }
  }, [currentScore, animatedScore]);

  const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
    return {
      x: centerX + (radius * Math.cos(angleInRadians)),
      y: centerY + (radius * Math.sin(angleInRadians))
    };
  };

  const createArcPath = (centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number) => {
    const start = polarToCartesian(centerX, centerY, radius, endAngle);
    const end = polarToCartesian(centerX, centerY, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return [
      "M", start.x, start.y, 
      "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y
    ].join(" ");
  };

  const getNeedleAngle = (score: number) => {
    return config.startAngle + (score / 100) * (config.endAngle - config.startAngle);
  };

  const getColorForScore = (score: number) => {
    if (score <= 25) return '#22c55e';
    if (score <= 50) return '#eab308';
    if (score <= 75) return '#f97316';
    return '#ef4444';
  };

  const getRiskLevelText = (score: number) => {
    if (score <= 25) return 'Low Risk';
    if (score <= 50) return 'Medium Risk';
    if (score <= 75) return 'High Risk';
    return 'Critical Risk';
  };

  const backgroundPath = createArcPath(
    config.centerX, 
    config.centerY, 
    config.radius, 
    config.startAngle, 
    config.endAngle
  );

  const scoreAngle = config.startAngle + (animatedScore / 100) * (config.endAngle - config.startAngle);
  const scorePath = createArcPath(
    config.centerX, 
    config.centerY, 
    config.radius, 
    config.startAngle, 
    scoreAngle
  );

  const needleAngle = getNeedleAngle(animatedScore);
  const needleEnd = polarToCartesian(config.centerX, config.centerY, config.radius - 10, needleAngle);

  return (
    <div className={`risk-gauge ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="riskGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="25%" stopColor="#eab308" />
            <stop offset="75%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge> 
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        <path
          d={backgroundPath}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={config.strokeWidth}
          strokeLinecap="round"
        />

        <path
          d={scorePath}
          fill="none"
          stroke="url(#riskGradient)"
          strokeWidth={config.strokeWidth}
          strokeLinecap="round"
          filter="url(#glow)"
          style={{
            transition: isAnimating ? 'none' : 'stroke-dasharray 0.3s ease',
          }}
        />

        <line
          x1={config.centerX}
          y1={config.centerY}
          x2={needleEnd.x}
          y2={needleEnd.y}
          stroke="#374151"
          strokeWidth="3"
          strokeLinecap="round"
          style={{
            transformOrigin: `${config.centerX}px ${config.centerY}px`,
            transition: isAnimating ? 'none' : 'transform 0.5s ease-out',
          }}
        />

        <circle
          cx={config.centerX}
          cy={config.centerY}
          r="8"
          fill="#374151"
        />

        <text
          x={config.centerX}
          y={config.centerY - 10}
          textAnchor="middle"
          fontSize="24"
          fontWeight="bold"
          fill={getColorForScore(animatedScore)}
        >
          {Math.round(animatedScore)}
        </text>

        <text
          x={config.centerX}
          y={config.centerY + 15}
          textAnchor="middle"
          fontSize="12"
          fill="#6b7280"
        >
          {getRiskLevelText(animatedScore)}
        </text>

        <text
          x={config.centerX}
          y={config.centerY + 35}
          textAnchor="middle"
          fontSize="10"
          fill="#9ca3af"
        >
          Risk Score
        </text>
      </svg>

      {riskScore && (
        <div className="gauge-details" style={{ 
          position: 'absolute', 
          bottom: -40, 
          left: 0, 
          right: 0, 
          textAlign: 'center',
          fontSize: '12px',
          color: '#6b7280'
        }}>
          <div>Health Factor: {riskScore.healthFactor.toFixed(2)}</div>
          <div>Volatility: {(riskScore.volatilityScore * 100).toFixed(1)}%</div>
        </div>
      )}

      <style jsx>{`
        .risk-gauge {
          position: relative;
          display: inline-block;
        }
        .gauge-details {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
      `}</style>
    </div>
  );
}