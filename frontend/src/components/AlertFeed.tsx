import React, { useState, useEffect, useCallback } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { PositionMonitor, Position, PositionChange } from '../monitor/positionMonitor';

export interface AlertSeverity {
  level: 'warning' | 'critical';
  threshold: number;
}

export interface Alert {
  id: string;
  severity: 'warning' | 'critical';
  timestamp: number;
  positionId: string;
  protocol: 'marginfi' | 'kamino' | 'drift';
  owner: PublicKey;
  riskDetails: {
    healthFactor: number;
    liquidationThreshold?: number;
    collateralValueUsd: number;
    debtValueUsd: number;
    changeType: 'created' | 'updated' | 'deleted';
  };
  message: string;
}

interface AlertFeedProps {
  connection: Connection;
  heliusApiKey: string;
  watchedAddresses?: string[];
}

const ALERT_THRESHOLDS = {
  warning: 1.2,
  critical: 1.05
};

const generateAlertFromChange = (change: PositionChange): Alert | null => {
  const { position, changeType, timestamp } = change;
  const { healthFactor, liquidationThreshold, collateral, debt } = position;

  let severity: 'warning' | 'critical' | null = null;
  let message = '';

  if (healthFactor <= ALERT_THRESHOLDS.critical) {
    severity = 'critical';
    message = `Critical: Health factor at ${healthFactor.toFixed(3)} - Risk of liquidation`;
  } else if (healthFactor <= ALERT_THRESHOLDS.warning) {
    severity = 'warning';
    message = `Warning: Health factor at ${healthFactor.toFixed(3)} - Monitor closely`;
  }

  if (!severity) return null;

  const collateralValue = collateral.reduce((sum, c) => sum + c.valueUsd, 0);
  const debtValue = debt.reduce((sum, d) => sum + d.valueUsd, 0);

  return {
    id: `${position.id}-${timestamp}`,
    severity,
    timestamp,
    positionId: position.id,
    protocol: position.protocol,
    owner: position.owner,
    riskDetails: {
      healthFactor,
      liquidationThreshold,
      collateralValueUsd: collateralValue,
      debtValueUsd: debtValue,
      changeType
    },
    message
  };
};

const formatTimestamp = (timestamp: number): string => {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

const AlertItem: React.FC<{ alert: Alert }> = ({ alert }) => {
  const severityColors = {
    warning: 'bg-yellow-100 border-yellow-400 text-yellow-800',
    critical: 'bg-red-100 border-red-400 text-red-800'
  };

  const severityIcons = {
    warning: '⚠️',
    critical: '🚨'
  };

  return (
    <div className={`p-4 border-l-4 rounded-r-lg mb-3 ${severityColors[alert.severity]}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3">
          <span className="text-lg">{severityIcons[alert.severity]}</span>
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-1">
              <span className="font-semibold text-sm uppercase tracking-wide">
                {alert.severity}
              </span>
              <span className="text-xs text-gray-600">
                {formatTimestamp(alert.timestamp)}
              </span>
            </div>
            <p className="font-medium text-sm mb-2">{alert.message}</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="font-medium">Position ID:</span>
                <div className="font-mono text-xs break-all">
                  {alert.positionId.slice(0, 8)}...
                </div>
              </div>
              <div>
                <span className="font-medium">Protocol:</span>
                <div className="capitalize">{alert.protocol}</div>
              </div>
              <div>
                <span className="font-medium">Health Factor:</span>
                <div>{alert.riskDetails.healthFactor.toFixed(3)}</div>
              </div>
              <div>
                <span className="font-medium">Collateral:</span>
                <div>${alert.riskDetails.collateralValueUsd.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function AlertFeed({ connection, heliusApiKey, watchedAddresses = [] }: AlertFeedProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [monitor, setMonitor] = useState<PositionMonitor | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'warning' | 'critical'>('all');

  const handlePositionChange = useCallback((change: PositionChange) => {
    const alert = generateAlertFromChange(change);
    if (alert) {
      setAlerts(prevAlerts => {
        const newAlerts = [alert, ...prevAlerts];
        return newAlerts.slice(0, 100);
      });
    }
  }, []);

  useEffect(() => {
    const positionMonitor = new PositionMonitor(connection, heliusApiKey);
    setMonitor(positionMonitor);

    positionMonitor.onPositionChange(handlePositionChange);

    const startMonitoring = async () => {
      try {
        await positionMonitor.startWebSocketMonitoring();
        setIsConnected(true);

        watchedAddresses.forEach(address => {
          positionMonitor.addWatchAddress(address);
        });
      } catch (error) {
        console.error('Failed to start position monitoring:', error);
        setIsConnected(false);
      }
    };

    startMonitoring();

    return () => {
      positionMonitor.stopWebSocketMonitoring();
    };
  }, [connection, heliusApiKey, watchedAddresses, handlePositionChange]);

  const filteredAlerts = alerts.filter(alert => {
    if (filterSeverity === 'all') return true;
    return alert.severity === filterSeverity;
  });

  const sortedAlerts = filteredAlerts.sort((a, b) => {
    if (a.severity === 'critical' && b.severity === 'warning') return -1;
    if (a.severity === 'warning' && b.severity === 'critical') return 1;
    return b.timestamp - a.timestamp;
  });

  const criticalCount = alerts.filter(alert => alert.severity === 'critical').length;
  const warningCount = alerts.filter(alert => alert.severity === 'warning').length;

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <h2 className="text-xl font-bold text-gray-900">Real-time Alerts</h2>
          <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-sm ${
            isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            <div className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-green-400' : 'bg-red-400'
            }`}></div>
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-sm text-gray-600">
            <span className="flex items-center space-x-1">
              <span className="w-3 h-3 bg-red-400 rounded-full"></span>
              <span>Critical: {criticalCount}</span>
            </span>
            <span className="flex items-center space-x-1">
              <span className="w-3 h-3 bg-yellow-400 rounded-full"></span>
              <span>Warning: {warningCount}</span>
            </span>
          </div>

          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value as 'all' | 'warning' | 'critical')}
            className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Alerts</option>
            <option value="critical">Critical Only</option>
            <option value="warning">Warning Only</option>
          </select>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {sortedAlerts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <div className="text-4xl mb-2">🔍</div>
            <p>No alerts yet. Monitoring for position risks...</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedAlerts.map(alert => (
              <AlertItem key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}