import React from 'react';
import { Position } from '../monitor/positionMonitor';

interface PositionCardProps {
  position: Position;
}

const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatNumber = (value: number, decimals: number = 2): string => {
  return value.toFixed(decimals);
};

const getHealthFactorColor = (healthFactor: number): string => {
  if (healthFactor >= 1.5) return '#10b981'; // green
  if (healthFactor >= 1.0) return '#f59e0b'; // yellow
  return '#ef4444'; // red
};

const calculateLiquidationPrice = (position: Position): number | null => {
  const totalCollateralValue = position.collateral.reduce((sum, c) => sum + c.valueUsd, 0);
  const totalDebtValue = position.debt.reduce((sum, d) => sum + d.valueUsd, 0);
  
  if (totalCollateralValue === 0 || totalDebtValue === 0) return null;
  
  const liquidationThreshold = position.liquidationThreshold || 0.8;
  
  // Primary collateral token for liquidation price calculation
  const primaryCollateral = position.collateral.find(c => c.priceUsd) || position.collateral[0];
  
  if (!primaryCollateral?.priceUsd) return null;
  
  // Calculate the price at which the position would be liquidated
  // This is a simplified calculation - actual liquidation logic varies by protocol
  const liquidationPrice = (totalDebtValue / (primaryCollateral.amount * liquidationThreshold));
  
  return liquidationPrice;
};

const PositionCard: React.FC<PositionCardProps> = ({ position }) => {
  const totalCollateralValue = position.collateral.reduce((sum, c) => sum + c.valueUsd, 0);
  const totalDebtValue = position.debt.reduce((sum, d) => sum + d.valueUsd, 0);
  const liquidationPrice = calculateLiquidationPrice(position);
  const healthFactorColor = getHealthFactorColor(position.healthFactor);

  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      padding: '16px',
      margin: '8px 0',
      backgroundColor: '#ffffff',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        borderBottom: '1px solid #f3f4f6',
        paddingBottom: '12px',
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#111827' }}>
            Position {position.id.slice(0, 8)}...
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#6b7280', textTransform: 'capitalize' }}>
            {position.protocol}
          </p>
        </div>
        
        {/* Health Factor */}
        <div style={{ textAlign: 'right' }}>
          <p style={{ margin: 0, fontSize: '12px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Health Factor
          </p>
          <p style={{ 
            margin: '4px 0 0 0', 
            fontSize: '24px', 
            fontWeight: '700', 
            color: healthFactorColor 
          }}>
            {formatNumber(position.healthFactor, 3)}
          </p>
        </div>
      </div>

      {/* Financial Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '16px' }}>
        {/* Collateral */}
        <div>
          <p style={{ margin: 0, fontSize: '12px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Total Collateral
          </p>
          <p style={{ margin: '4px 0 0 0', fontSize: '20px', fontWeight: '600', color: '#059669' }}>
            {formatCurrency(totalCollateralValue)}
          </p>
          {position.collateral.length > 1 && (
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#6b7280' }}>
              {position.collateral.length} assets
            </p>
          )}
        </div>

        {/* Debt */}
        <div>
          <p style={{ margin: 0, fontSize: '12px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Total Debt
          </p>
          <p style={{ margin: '4px 0 0 0', fontSize: '20px', fontWeight: '600', color: '#dc2626' }}>
            {formatCurrency(totalDebtValue)}
          </p>
          {position.debt.length > 1 && (
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#6b7280' }}>
              {position.debt.length} assets
            </p>
          )}
        </div>
      </div>

      {/* Additional Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
        {/* Liquidation Price */}
        <div>
          <p style={{ margin: 0, fontSize: '12px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Est. Liquidation Price
          </p>
          <p style={{ margin: '4px 0 0 0', fontSize: '16px', fontWeight: '600', color: '#374151' }}>
            {liquidationPrice ? formatCurrency(liquidationPrice) : 'N/A'}
          </p>
        </div>

        {/* Utilization Ratio */}
        <div>
          <p style={{ margin: 0, fontSize: '12px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Utilization
          </p>
          <p style={{ margin: '4px 0 0 0', fontSize: '16px', fontWeight: '600', color: '#374151' }}>
            {totalCollateralValue > 0 ? formatNumber((totalDebtValue / totalCollateralValue) * 100, 1) : '0.0'}%
          </p>
        </div>
      </div>

      {/* Timestamp */}
      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f3f4f6' }}>
        <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>
          Last updated: {new Date(position.timestamp).toLocaleString()}
        </p>
      </div>
    </div>
  );
};

export default PositionCard;