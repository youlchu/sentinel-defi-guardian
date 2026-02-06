import React, { useState, useEffect, useCallback } from 'react';
import { Connection, PublicKey } from "@solana/web3.js";
import { Position, PositionChange, PositionMonitor } from "../monitor/positionMonitor";
import { RiskScore, LiquidationPrediction, RiskEngine } from "../risk/riskEngine";
import axios from "axios";

interface AlertHistory {
  id: string;
  positionId: string;
  alertType: "risk_increase" | "health_warning" | "liquidation_alert" | "position_change";
  message: string;
  severity: "low" | "medium" | "high" | "critical";
  timestamp: number;
  acknowledged: boolean;
}

interface DashboardData {
  positions: Position[];
  riskScores: Map<string, RiskScore>;
  liquidationPredictions: Map<string, LiquidationPrediction>;
  alerts: AlertHistory[];
  isLoading: boolean;
  error: string | null;
}

class DashboardAPIService {
  private baseUrl: string;
  
  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  async fetchPositions(): Promise<Position[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/positions`);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch positions:', error);
      throw new Error('Failed to fetch positions');
    }
  }

  async fetchRiskScores(): Promise<RiskScore[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/risk-scores`);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch risk scores:', error);
      throw new Error('Failed to fetch risk scores');
    }
  }

  async fetchLiquidationPredictions(): Promise<LiquidationPrediction[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/liquidation-predictions`);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch liquidation predictions:', error);
      throw new Error('Failed to fetch liquidation predictions');
    }
  }

  async fetchAlertHistory(): Promise<AlertHistory[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/alerts`);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch alert history:', error);
      throw new Error('Failed to fetch alert history');
    }
  }

  async acknowledgeAlert(alertId: string): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}/alerts/${alertId}/acknowledge`);
    } catch (error) {
      console.error('Failed to acknowledge alert:', error);
      throw new Error('Failed to acknowledge alert');
    }
  }
}

const PositionCard: React.FC<{ position: Position; riskScore?: RiskScore; prediction?: LiquidationPrediction }> = ({ 
  position, 
  riskScore, 
  prediction 
}) => {
  const getRiskColor = (level?: string) => {
    switch (level) {
      case 'low': return 'bg-green-100 text-green-800 border-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getHealthColor = (healthFactor: number) => {
    if (healthFactor >= 2) return 'text-green-600';
    if (healthFactor >= 1.5) return 'text-yellow-600';
    if (healthFactor >= 1.2) return 'text-orange-600';
    return 'text-red-600';
  };

  const totalCollateralUsd = position.collateral.reduce((sum, c) => sum + c.valueUsd, 0);
  const totalDebtUsd = position.debt.reduce((sum, d) => sum + d.valueUsd, 0);

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 capitalize">
            {position.protocol} Position
          </h3>
          <p className="text-sm text-gray-600">ID: {position.id.slice(0, 8)}...</p>
        </div>
        {riskScore && (
          <span className={`px-3 py-1 rounded-full text-sm font-medium border ${getRiskColor(riskScore.riskLevel)}`}>
            {riskScore.riskLevel.toUpperCase()}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-sm text-gray-600">Health Factor</p>
          <p className={`text-xl font-bold ${getHealthColor(position.healthFactor)}`}>
            {position.healthFactor.toFixed(3)}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-600">Collateral Ratio</p>
          <p className="text-xl font-bold text-gray-900">
            {riskScore ? (riskScore.collateralRatio * 100).toFixed(1) : 'N/A'}%
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-sm text-gray-600">Total Collateral</p>
          <p className="text-lg font-semibold text-green-600">
            ${totalCollateralUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-600">Total Debt</p>
          <p className="text-lg font-semibold text-red-600">
            ${totalDebtUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {riskScore && (
        <div className="mb-4">
          <p className="text-sm text-gray-600">Liquidation Price</p>
          <p className="text-lg font-semibold text-gray-900">
            ${riskScore.liquidationPrice.toFixed(6)}
          </p>
          <p className="text-sm text-gray-500">
            {riskScore.distanceToLiquidation.toFixed(2)}% from current price
          </p>
        </div>
      )}

      {prediction && prediction.probability > 0.1 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm font-medium text-red-800">
            Liquidation Risk: {(prediction.probability * 100).toFixed(1)}%
          </p>
          {prediction.minutesToLiquidation < 60 && (
            <p className="text-sm text-red-600">
              Est. {prediction.minutesToLiquidation} minutes to liquidation
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const AlertsPanel: React.FC<{ alerts: AlertHistory[]; onAcknowledge: (alertId: string) => void }> = ({ 
  alerts, 
  onAcknowledge 
}) => {
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'low': return 'bg-blue-50 border-blue-200 text-blue-800';
      case 'medium': return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      case 'high': return 'bg-orange-50 border-orange-200 text-orange-800';
      case 'critical': return 'bg-red-50 border-red-200 text-red-800';
      default: return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const unacknowledgedAlerts = alerts.filter(alert => !alert.acknowledged);

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-900">Recent Alerts</h2>
        {unacknowledgedAlerts.length > 0 && (
          <span className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-sm font-medium">
            {unacknowledgedAlerts.length} unread
          </span>
        )}
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {alerts.slice(0, 10).map((alert) => (
          <div
            key={alert.id}
            className={`p-3 rounded-lg border ${getSeverityColor(alert.severity)} ${
              alert.acknowledged ? 'opacity-60' : ''
            }`}
          >
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium capitalize">
                    {alert.alertType.replace('_', ' ')}
                  </span>
                  <span className="text-sm font-medium capitalize">
                    {alert.severity}
                  </span>
                </div>
                <p className="text-sm">{alert.message}</p>
                <p className="text-xs opacity-75 mt-1">
                  {new Date(alert.timestamp).toLocaleString()}
                </p>
              </div>
              {!alert.acknowledged && (
                <button
                  onClick={() => onAcknowledge(alert.id)}
                  className="text-xs bg-white bg-opacity-80 hover:bg-opacity-100 px-2 py-1 rounded border"
                >
                  Acknowledge
                </button>
              )}
            </div>
          </div>
        ))}

        {alerts.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            <p>No alerts to display</p>
          </div>
        )}
      </div>
    </div>
  );
};

const DashboardStats: React.FC<{ data: DashboardData }> = ({ data }) => {
  const totalPositions = data.positions.length;
  const criticalRisk = Array.from(data.riskScores.values()).filter(r => r.riskLevel === 'critical').length;
  const highRisk = Array.from(data.riskScores.values()).filter(r => r.riskLevel === 'high').length;
  const totalCollateral = data.positions.reduce((sum, pos) => 
    sum + pos.collateral.reduce((colSum, c) => colSum + c.valueUsd, 0), 0
  );
  const avgHealthFactor = totalPositions > 0 
    ? data.positions.reduce((sum, pos) => sum + pos.healthFactor, 0) / totalPositions 
    : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
      <div className="bg-white rounded-lg shadow-md p-6 border">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Total Positions</p>
            <p className="text-2xl font-bold text-gray-900">{totalPositions}</p>
          </div>
          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
            <div className="w-6 h-6 bg-blue-600 rounded"></div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 border">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">High Risk Positions</p>
            <p className="text-2xl font-bold text-orange-600">{highRisk + criticalRisk}</p>
          </div>
          <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
            <div className="w-6 h-6 bg-orange-600 rounded"></div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 border">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Total Collateral</p>
            <p className="text-2xl font-bold text-green-600">
              ${totalCollateral.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
            <div className="w-6 h-6 bg-green-600 rounded"></div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 border">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Avg Health Factor</p>
            <p className={`text-2xl font-bold ${avgHealthFactor >= 2 ? 'text-green-600' : avgHealthFactor >= 1.5 ? 'text-yellow-600' : 'text-red-600'}`}>
              {avgHealthFactor.toFixed(2)}
            </p>
          </div>
          <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
            <div className="w-6 h-6 bg-gray-600 rounded"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function Component() {
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    positions: [],
    riskScores: new Map(),
    liquidationPredictions: new Map(),
    alerts: [],
    isLoading: true,
    error: null
  });

  const [positionMonitor, setPositionMonitor] = useState<PositionMonitor | null>(null);
  const [apiService] = useState(new DashboardAPIService());
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchDashboardData = useCallback(async () => {
    try {
      setDashboardData(prev => ({ ...prev, isLoading: true, error: null }));

      const [positions, riskScores, predictions, alerts] = await Promise.all([
        apiService.fetchPositions(),
        apiService.fetchRiskScores(),
        apiService.fetchLiquidationPredictions(),
        apiService.fetchAlertHistory()
      ]);

      const riskScoreMap = new Map(riskScores.map(rs => [rs.positionId, rs]));
      const predictionMap = new Map(predictions.map(p => [p.positionId, p]));

      setDashboardData({
        positions,
        riskScores: riskScoreMap,
        liquidationPredictions: predictionMap,
        alerts,
        isLoading: false,
        error: null
      });

      setLastUpdate(new Date());
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      setDashboardData(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }));
    }
  }, [apiService]);

  const handleAcknowledgeAlert = useCallback(async (alertId: string) => {
    try {
      await apiService.acknowledgeAlert(alertId);
      setDashboardData(prev => ({
        ...prev,
        alerts: prev.alerts.map(alert =>
          alert.id === alertId ? { ...alert, acknowledged: true } : alert
        )
      }));
    } catch (error) {
      console.error('Failed to acknowledge alert:', error);
    }
  }, [apiService]);

  const handlePositionChange = useCallback((change: PositionChange) => {
    console.log('Position change detected:', change);
    if (autoRefresh) {
      fetchDashboardData();
    }
  }, [fetchDashboardData, autoRefresh]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(fetchDashboardData, 30000);
      return () => clearInterval(interval);
    }
  }, [fetchDashboardData, autoRefresh]);

  useEffect(() => {
    const initializeMonitor = async () => {
      try {
        const connection = new Connection(process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com');
        const heliusApiKey = process.env.NEXT_PUBLIC_HELIUS_API_KEY || '';
        
        const monitor = new PositionMonitor(connection, heliusApiKey);
        monitor.onPositionChange(handlePositionChange);
        
        dashboardData.positions.forEach(position => {
          monitor.addWatchAddress(position.owner.toString());
        });

        await monitor.startWebSocketMonitoring();
        setPositionMonitor(monitor);
      } catch (error) {
        console.error('Failed to initialize position monitor:', error);
      }
    };

    if (dashboardData.positions.length > 0) {
      initializeMonitor();
    }

    return () => {
      if (positionMonitor) {
        positionMonitor.stop();
      }
    };
  }, [dashboardData.positions, handlePositionChange]);

  if (dashboardData.error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <div className="text-red-600 text-center mb-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <div className="w-8 h-8 bg-red-600 rounded"></div>
            </div>
            <h3 className="text-lg font-semibold">Error Loading Dashboard</h3>
            <p className="text-sm text-gray-600 mt-2">{dashboardData.error}</p>
          </div>
          <button
            onClick={fetchDashboardData}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Position Dashboard</h1>
            <p className="text-gray-600">
              Last updated: {lastUpdate.toLocaleTimeString()}
            </p>
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-gray-600">Auto Refresh</span>
            </label>
            <button
              onClick={fetchDashboardData}
              disabled={dashboardData.isLoading}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {dashboardData.isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <DashboardStats data={dashboardData} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Active Positions</h2>
              {dashboardData.isLoading && dashboardData.positions.length === 0 ? (
                <div className="bg-white rounded-lg shadow-md p-8 text-center">
                  <div className="animate-spin w-8 h-8 bg-blue-600 rounded-full mx-auto mb-4"></div>
                  <p className="text-gray-600">Loading positions...</p>
                </div>
              ) : dashboardData.positions.length === 0 ? (
                <div className="bg-white rounded-lg shadow-md p-8 text-center">
                  <p className="text-gray-600">No positions found</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  {dashboardData.positions.map((position) => (
                    <PositionCard
                      key={position.id}
                      position={position}
                      riskScore={dashboardData.riskScores.get(position.id)}
                      prediction={dashboardData.liquidationPredictions.get(position.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-1">
            <AlertsPanel 
              alerts={dashboardData.alerts} 
              onAcknowledge={handleAcknowledgeAlert} 
            />
          </div>
        </div>
      </div>
    </div>
  );
}