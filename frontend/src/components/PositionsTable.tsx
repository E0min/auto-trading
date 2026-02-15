'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Spinner from '@/components/ui/Spinner';
import { formatCurrency, formatSymbol, getPnlColor, getPnlSign, translateSide } from '@/lib/utils';
import type { Position } from '@/types';

/** Format SL price with 2-4 decimal places depending on magnitude */
function formatSlPrice(price: string): string {
  const num = parseFloat(price);
  if (isNaN(num) || num <= 0) return '\u2014';
  // Use 4 decimals for small prices (< 1), otherwise 2
  const decimals = num < 1 ? 4 : 2;
  return `$${num.toFixed(decimals)}`;
}

interface PositionsTableProps {
  positions: Position[];
  loading: boolean;
  onClosePosition?: (pos: Position) => Promise<void>;
  closingSymbol?: string | null;
}

export default function PositionsTable({ positions, loading, onClosePosition, closingSymbol }: PositionsTableProps) {
  const [confirmTarget, setConfirmTarget] = useState<Position | null>(null);

  const pnlNum = confirmTarget ? parseFloat(confirmTarget.unrealizedPnl) || 0 : 0;
  const isLoss = pnlNum < 0;

  const confirmMessage = confirmTarget
    ? `${formatSymbol(confirmTarget.symbol)} ${translateSide(confirmTarget.posSide)} ${confirmTarget.qty}개\n\n` +
      (isLoss
        ? `이 포지션을 시장가로 청산하면 약 $${formatCurrency(String(Math.abs(pnlNum)))}의 손실이 확정됩니다.`
        : `약 $${formatCurrency(confirmTarget.unrealizedPnl)}의 수익이 확정됩니다.`)
    : '';

  const handleConfirmClose = () => {
    if (confirmTarget && onClosePosition) {
      onClosePosition(confirmTarget);
    }
    setConfirmTarget(null);
  };

  return (
    <>
      <Card title="활성 포지션" className="overflow-hidden">
        <div className="overflow-x-auto -mx-6 -mb-6">
          <table>
            <thead>
              <tr>
                <th>심볼</th>
                <th>방향</th>
                <th>수량</th>
                <th>진입가</th>
                <th>SL 가격</th>
                <th>현재가</th>
                <th>미실현 PnL</th>
                <th>레버리지</th>
                <th>청산가</th>
                {onClosePosition && <th>작업</th>}
              </tr>
            </thead>
            <tbody>
              {loading && positions.length === 0 ? (
                <tr>
                  <td colSpan={onClosePosition ? 10 : 9} className="text-center text-[var(--text-muted)] py-10">
                    로딩 중...
                  </td>
                </tr>
              ) : positions.length === 0 ? (
                <tr>
                  <td colSpan={onClosePosition ? 10 : 9} className="text-center text-[var(--text-muted)] py-10">
                    활성 포지션 없음
                  </td>
                </tr>
              ) : (
                positions.map((pos, idx) => {
                  const isClosing = closingSymbol === `${pos.symbol}-${pos.posSide}`;
                  return (
                    <tr key={`${pos.symbol}-${pos.posSide}-${idx}`}>
                      <td className="font-mono font-medium text-[var(--text-primary)]">{formatSymbol(pos.symbol)}</td>
                      <td>
                        <Badge variant={pos.posSide === 'long' ? 'success' : 'danger'} dot>
                          {translateSide(pos.posSide)}
                        </Badge>
                      </td>
                      <td className="font-mono text-[var(--text-secondary)]">{pos.qty}</td>
                      <td className="font-mono text-[var(--text-secondary)]">${formatCurrency(pos.entryPrice)}</td>
                      <td className="font-mono text-[var(--loss)]/70">
                        {pos.stopLossPrice ? formatSlPrice(pos.stopLossPrice) : '\u2014'}
                      </td>
                      <td className="font-mono text-[var(--text-secondary)]">${formatCurrency(pos.markPrice)}</td>
                      <td className={`font-mono font-medium text-sm ${getPnlColor(pos.unrealizedPnl)}`}>
                        {getPnlSign(pos.unrealizedPnl)}${formatCurrency(pos.unrealizedPnl)}
                      </td>
                      <td className="font-mono text-[var(--text-muted)]">{pos.leverage}x</td>
                      <td className="font-mono text-[var(--text-muted)]">${formatCurrency(pos.liquidationPrice)}</td>
                      {onClosePosition && (
                        <td>
                          <button
                            onClick={() => setConfirmTarget(pos)}
                            disabled={isClosing}
                            className="px-3 py-1 text-[11px] font-medium text-[var(--loss)] border border-[var(--loss)]/30 rounded-md hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                          >
                            {isClosing ? (
                              <>
                                <Spinner size="sm" className="text-[var(--loss)]" />
                                청산 중
                              </>
                            ) : (
                              '청산'
                            )}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmDialog
        open={!!confirmTarget}
        title="포지션 청산 확인"
        message={confirmMessage}
        confirmLabel="청산 실행"
        cancelLabel="취소"
        variant="danger"
        onConfirm={handleConfirmClose}
        onCancel={() => setConfirmTarget(null)}
      />
    </>
  );
}
