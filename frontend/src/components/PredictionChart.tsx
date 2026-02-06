import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
  ReferenceLine,
  Brush
} from 'recharts';

interface LiquidationProbabilityData {
  timestamp: number;
  probability: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface PricePredictionData {
  timestamp: number;
  predictedPrice: number;
  actualPrice?: number;
  confidence: number;
}

interface ConfidenceInterval {
  timestamp: number;
  lower: number;
  upper: number;
  mean: number;
}

interface ChartDataPoint {
  timestamp: number;
  time: string;
  liquidationProb: number;
  predictedPrice: number;
  actualPrice?: number;
  confidenceLower: number;
  confidenceUpper: number;
  confidenceMean: number;
  riskLevel: string;
}

interface MLPredictionResult {
  liquidationData: LiquidationProbabilityData[];
  priceData: PricePredictionData[];
  confidenceIntervals: ConfidenceInterval[];
  accuracy: number;
  lastUpdated: number;
}

interface TimeSeriesData {
  data: ChartDataPoint[];
  timeRange: '1h' | '6h' | '24h' | '7d';
  isLoading: boolean;
}

interface ChartConfiguration {
  showLiquidationProb: boolean;
  showPricePrediction: boolean;
  showConfidenceInterval: boolean;
  showActualPrice: boolean;
  animationDuration: number;
  updateInterval: number;
}

interface RealTimeUpdateConfig {
  enabled: boolean;
  interval: number;
  maxDataPoints: number;
  autoScroll: boolean;
}

export default function Component() {
  const [timeSeriesData, setTimeSeriesData] = useState<TimeSeriesData>({
    data: [],
    timeRange: '24h',
    isLoading: true
  });

  const [chartConfig, setChartConfig] = useState<ChartConfiguration>({
    showLiquidationProb: true,
    showPricePrediction: true,
    showConfidenceInterval: true,
    showActualPrice: true,
    animationDuration: 300,
    updateInterval: 2000
  });

  const [realTimeConfig, setRealTimeConfig] = useState<RealTimeUpdateConfig>({
    enabled: true,
    interval: 2000,
    maxDataPoints: 200,
    autoScroll: true
  });

  const [selectedMetric, setSelectedMetric] = useState<string>('all');
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const generateMockData = useCallback((count: number, startTime?: number): ChartDataPoint[] => {
    const now = startTime || Date.now();
    const data: ChartDataPoint[] = [];
    
    for (let i = 0; i < count; i++) {
      const timestamp = now - (count - i - 1) * 60000; // 1 minute intervals
      const basePrice = 50000 + Math.sin(i * 0.1) * 5000 + Math.random() * 1000;
      const volatility = 0.02 + Math.random() * 0.08;
      const liquidationProb = Math.max(0, Math.min(100, 
        30 + Math.sin(i * 0.05) * 20 + (Math.random() - 0.5) * 40
      ));
      
      const predictedPrice = basePrice * (1 + (Math.random() - 0.5) * volatility);
      const actualPrice = i < count - 10 ? basePrice * (1 + (Math.random() - 0.5) * volatility * 0.8) : undefined;
      
      const confidenceWidth = basePrice * volatility;
      
      data.push({
        timestamp,
        time: new Date(timestamp).toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        liquidationProb,
        predictedPrice,
        actualPrice,
        confidenceLower: predictedPrice - confidenceWidth,
        confidenceUpper: predictedPrice + confidenceWidth,
        confidenceMean: predictedPrice,
        riskLevel: liquidationProb > 75 ? 'critical' : 
                  liquidationProb > 50 ? 'high' : 
                  liquidationProb > 25 ? 'medium' : 'low'
      });
    }
    
    return data;
  }, []);

  const updateData = useCallback(() => {
    if (!realTimeConfig.enabled) return;

    setTimeSeriesData(prev => {
      const now = Date.now();
      const newDataPoint = generateMockData(1, now)[0];
      
      let updatedData = [...prev.data, newDataPoint];
      
      if (updatedData.length > realTimeConfig.maxDataPoints) {
        updatedData = updatedData.slice(-realTimeConfig.maxDataPoints);
      }
      
      return {
        ...prev,
        data: updatedData,
        isLoading: false
      };
    });
  }, [generateMockData, realTimeConfig.enabled, realTimeConfig.maxDataPoints]);

  useEffect(() => {
    // Initialize data
    const initialData = generateMockData(50);
    setTimeSeriesData(prev => ({
      ...prev,
      data: initialData,
      isLoading: false
    }));
  }, [generateMockData]);

  useEffect(() => {
    if (isPlaying && realTimeConfig.enabled) {
      intervalRef.current = setInterval(updateData, realTimeConfig.interval);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, realTimeConfig.enabled, realTimeConfig.interval, updateData]);

  const handleTimeRangeChange = (range: '1h' | '6h' | '24h' | '7d') => {
    setTimeSeriesData(prev => ({ ...prev, timeRange: range, isLoading: true }));
    
    const dataPoints = range === '1h' ? 60 : range === '6h' ? 360 : range === '24h' ? 1440 : 10080;
    const newData = generateMockData(Math.min(dataPoints, 200));
    
    setTimeout(() => {
      setTimeSeriesData(prev => ({
        ...prev,
        data: newData,
        isLoading: false
      }));
    }, 500);
  };

  const togglePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const toggleRealTime = () => {
    setRealTimeConfig(prev => ({ ...prev, enabled: !prev.enabled }));
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-gray-900 border border-cyan-400 rounded-lg p-4 shadow-lg">
          <p className="text-cyan-400 font-semibold">{label}</p>
          {chartConfig.showLiquidationProb && (
            <p className="text-red-400">
              Liquidation Risk: {data.liquidationProb.toFixed(1)}%
            </p>
          )}
          {chartConfig.showPricePrediction && (
            <p className="text-green-400">
              Predicted Price: ${data.predictedPrice.toFixed(2)}
            </p>
          )}
          {chartConfig.showActualPrice && data.actualPrice && (
            <p className="text-blue-400">
              Actual Price: ${data.actualPrice.toFixed(2)}
            </p>
          )}
          {chartConfig.showConfidenceInterval && (
            <div className="text-yellow-400">
              <p>Confidence: ${data.confidenceLower.toFixed(2)} - ${data.confidenceUpper.toFixed(2)}</p>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  const getRiskColor = (riskLevel: string) => {
    switch (riskLevel) {
      case 'critical': return '#ff0000';
      case 'high': return '#ff6600';
      case 'medium': return '#ffaa00';
      case 'low': return '#00ff00';
      default: return '#00ff00';
    }
  };

  if (timeSeriesData.isLoading) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-950 rounded-lg">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
        <span className="ml-4 text-cyan-400">Loading prediction data...</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-gray-950 text-white rounded-lg overflow-hidden">
      {/* Header Controls */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-cyan-400">SENTINEL ML Predictions</h2>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${realTimeConfig.enabled ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`}></div>
              <span className="text-sm text-gray-400">
                {realTimeConfig.enabled ? 'Live' : 'Paused'}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Time Range Buttons */}
            {(['1h', '6h', '24h', '7d'] as const).map(range => (
              <button
                key={range}
                onClick={() => handleTimeRangeChange(range)}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  timeSeriesData.timeRange === range
                    ? 'bg-cyan-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {range}
              </button>
            ))}
            
            {/* Control Buttons */}
            <button
              onClick={togglePlayPause}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            >
              {isPlaying ? '⏸️' : '▶️'}
            </button>
            
            <button
              onClick={toggleRealTime}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                realTimeConfig.enabled
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-gray-600 hover:bg-gray-500'
              }`}
            >
              Real-time
            </button>
          </div>
        </div>
        
        {/* Metric Toggles */}
        <div className="flex flex-wrap gap-2 mt-3">
          {[
            { key: 'showLiquidationProb', label: 'Liquidation Risk', color: 'text-red-400' },
            { key: 'showPricePrediction', label: 'Price Prediction', color: 'text-green-400' },
            { key: 'showConfidenceInterval', label: 'Confidence Bands', color: 'text-yellow-400' },
            { key: 'showActualPrice', label: 'Actual Price', color: 'text-blue-400' }
          ].map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => setChartConfig(prev => ({ ...prev, [key]: !prev[key as keyof ChartConfiguration] }))}
              className={`px-2 py-1 text-xs rounded border transition-colors ${
                chartConfig[key as keyof ChartConfiguration]
                  ? `${color} border-current bg-opacity-20`
                  : 'text-gray-500 border-gray-600 hover:text-gray-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Chart */}
      <div className="p-4" ref={chartRef}>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={timeSeriesData.data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey="time" 
              stroke="#9CA3AF"
              fontSize={12}
              interval="preserveStartEnd"
            />
            <YAxis yAxisId="price" stroke="#9CA3AF" fontSize={12} />
            <YAxis yAxisId="probability" orientation="right" stroke="#9CA3AF" fontSize={12} domain={[0, 100]} />
            
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            
            {/* Confidence Interval Area */}
            {chartConfig.showConfidenceInterval && (
              <>
                <defs>
                  <linearGradient id="confidenceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#fbbf24" stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <Area
                  yAxisId="price"
                  type="monotone"
                  dataKey="confidenceUpper"
                  stroke="none"
                  fill="url(#confidenceGradient)"
                  name="Confidence Interval"
                />
                <Area
                  yAxisId="price"
                  type="monotone"
                  dataKey="confidenceLower"
                  stroke="none"
                  fill="white"
                  name=""
                />
              </>
            )}
            
            {/* Predicted Price Line */}
            {chartConfig.showPricePrediction && (
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="predictedPrice"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                name="Predicted Price"
                strokeDasharray="5 5"
              />
            )}
            
            {/* Actual Price Line */}
            {chartConfig.showActualPrice && (
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="actualPrice"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="Actual Price"
                connectNulls={false}
              />
            )}
            
            {/* Liquidation Probability Line */}
            {chartConfig.showLiquidationProb && (
              <Line
                yAxisId="probability"
                type="monotone"
                dataKey="liquidationProb"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ fill: '#ef4444', strokeWidth: 1, r: 2 }}
                name="Liquidation Risk %"
              />
            )}
            
            {/* Risk Level Reference Lines */}
            <ReferenceLine yAxisId="probability" y={25} stroke="#fbbf24" strokeDasharray="2 2" />
            <ReferenceLine yAxisId="probability" y={50} stroke="#f97316" strokeDasharray="2 2" />
            <ReferenceLine yAxisId="probability" y={75} stroke="#ef4444" strokeDasharray="2 2" />
            
            <Brush 
              dataKey="time" 
              height={30} 
              stroke="#06b6d4"
              fill="#1f2937"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Statistics Panel */}
      <div className="p-4 border-t border-gray-800">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-900 p-3 rounded">
            <div className="text-xs text-gray-400">Current Risk</div>
            <div className={`text-lg font-bold ${
              timeSeriesData.data.length > 0 
                ? timeSeriesData.data[timeSeriesData.data.length - 1].liquidationProb > 75 
                  ? 'text-red-400' : 'text-green-400'
                : 'text-gray-400'
            }`}>
              {timeSeriesData.data.length > 0 
                ? `${timeSeriesData.data[timeSeriesData.data.length - 1].liquidationProb.toFixed(1)}%`
                : 'N/A'
              }
            </div>
          </div>
          
          <div className="bg-gray-900 p-3 rounded">
            <div className="text-xs text-gray-400">Prediction Accuracy</div>
            <div className="text-lg font-bold text-green-400">94.2%</div>
          </div>
          
          <div className="bg-gray-900 p-3 rounded">
            <div className="text-xs text-gray-400">Data Points</div>
            <div className="text-lg font-bold text-cyan-400">{timeSeriesData.data.length}</div>
          </div>
          
          <div className="bg-gray-900 p-3 rounded">
            <div className="text-xs text-gray-400">Update Frequency</div>
            <div className="text-lg font-bold text-blue-400">{realTimeConfig.interval / 1000}s</div>
          </div>
        </div>
      </div>
    </div>
  );
}