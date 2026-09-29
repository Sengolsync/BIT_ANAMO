import React, { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  Coins,
  Receipt,
  ArrowDownUp,
  Clock,
  Zap,
  TrendingUp,
  Activity,
  ArrowRight,
  ShieldCheck,
  Bot,
} from 'lucide-react';
import { api } from '../api/client';
import { BlockSummary, HourlyAISummary, RankedAddress } from '../types';
import { useRealtime } from '../context/useRealtime';
import { StatCard } from '../components/ui/StatCard';
import { Badge } from '../components/ui/Badge';
import { FollowButton } from '../components/ui/FollowButton';
import { VolumeChart } from '../components/charts/VolumeChart';
import { ActivityChart } from '../components/charts/ActivityChart';
import { InOutChart } from '../components/charts/InOutChart';
import { AddressDistributionChart } from '../components/charts/AddressDistributionChart';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton';
import { formatDecimal, formatInteger } from '../utils/formatters';

interface DashboardPageProps {
  onNavigateTo: (type: 'block' | 'address' | 'page', id: string) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigateTo }) => {
  const { latestBlock, pulseBlockHeight } = useRealtime();
  const [blocks, setBlocks] = useState<BlockSummary[]>([]);
  const [activeMetric, setActiveMetric] = useState<'txs' | 'volume' | 'fees' | 'in_out' | 'addresses'>('volume');
  const [topAddresses, setTopAddresses] = useState<RankedAddress[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [hourlyStart, setHourlyStart] = useState<string>('15:00');
  const [hourlyLoading, setHourlyLoading] = useState<boolean>(false);
  const [hourlySummary, setHourlySummary] = useState<HourlyAISummary | null>(null);
  const [hourlyError, setHourlyError] = useState<string>('');

  const defaultHourlyDate = useMemo(() => {
    const now = new Date();
    const rounded = new Date(now);
    rounded.setMinutes(0, 0, 0);
    rounded.setHours(rounded.getHours() - 1);
    return rounded.toISOString().slice(0, 16);
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [latestBlock?.height]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const res = await api.listBlocks({ limit: 10 });
      setBlocks(res.blocks);

      if (res.blocks.length > 0) {
        const targetBlock = res.blocks[0];
        const analysis = await api.getBlockAnalysis(targetBlock.height);
        setTopAddresses(analysis.top_addresses);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const currentBlock = latestBlock || (blocks.length > 0 ? blocks[0] : null);

  const handleGenerateHourlySummary = async () => {
    try {
      setHourlyLoading(true);
      setHourlyError('');
      const selectedDate = new Date(`${defaultHourlyDate.slice(0, 10)}T${hourlyStart}:00Z`);
      const result = await api.generateHourlyAISummary(selectedDate.toISOString());
      setHourlySummary(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The one-hour AI summary could not be generated.';
      setHourlyError(message);
      setHourlySummary(null);
    } finally {
      setHourlyLoading(false);
    }
  };

  // Prepare chart data across recent blocks
  const chronologicalBlocks = [...blocks].reverse();

  const volumeChartData = chronologicalBlocks.map((b) => ({
    name: `#${b.height}`,
    volume_btc: b.total_volume_btc,
    fees_btc: b.total_fees_btc
  }));

  const activityChartData = chronologicalBlocks.map((b) => ({
    name: `#${b.height}`,
    tx_count: b.analyzed_tx_count
  }));

  const feesChartData = chronologicalBlocks.map((b) => ({
    name: `#${b.height}`,
    volume_btc: b.total_fees_btc
  }));

  const inOutChartData = chronologicalBlocks.map((b) => ({
    name: `#${b.height}`,
    incoming: b.total_volume_btc,
    outgoing: Math.max(0, (b.total_volume_btc ?? 0) - (b.total_fees_btc ?? 0))
  }));

  // Exact relative time
  const getRelativeTime = (ts: number) => {
    const diffSec = Math.floor(Date.now() / 1000 - ts);
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    return `${Math.floor(diffSec / 3600)}h ago`;
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-dark-700/60 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-wide font-mono flex items-center gap-2">
              <Boxes className="w-5 h-5 text-btc-primary" />
              INTELLIGENCE OVERVIEW
            </h1>
            <Badge variant="cyan" size="sm">REAL DATA FEED</Badge>
          </div>
          <p className="text-xs text-slate-400 mt-1 font-mono">
            Autonomous block ingestion &bull; Deterministic statistical analysis &bull; Follow-up address correlation
          </p>
        </div>

        {/* 10-Day Window Status */}
        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-dark-900 border border-dark-700/80 text-xs text-slate-300 font-mono">
          <Activity className="w-4 h-4 text-intel-cyan animate-pulse" />
          <span>10-Day Analysis Window Active</span>
        </div>
      </div>

      {/* Primary KPI Grid */}
      {loading && !currentBlock ? (
        <LoadingSkeleton rows={2} height="h-24" />
      ) : currentBlock ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
          {/* Latest Block Height */}
          <div
            onClick={() => onNavigateTo('block', currentBlock.height.toString())}
            className="cursor-pointer group"
          >
            <StatCard
              label="Block Height"
              value={`#${currentBlock.height}`}
              subValue={getRelativeTime(currentBlock.timestamp)}
              icon={Boxes}
              iconColor="text-btc-primary"
              highlight={true}
              tooltip="Current analyzed Bitcoin block tip"
            />
          </div>

          {/* Analyzed / Total Transactions */}
          <StatCard
            label="Analyzed / Total TX"
            value={formatInteger(currentBlock.analyzed_tx_count)}
            subValue={`of ${formatInteger(currentBlock.tx_count)}`}
            icon={Zap}
            iconColor="text-intel-cyan"
            tooltip={`Coverage: ${currentBlock.coverage_pct}% of total transactions in block`}
          />

          {/* Coverage Percentage */}
          <StatCard
            label="Data Coverage"
            value={`${currentBlock.coverage_pct}%`}
            subValue="Verified Scope"
            icon={ShieldCheck}
            iconColor="text-intel-emerald"
            tooltip="Percentage of block transactions ingested and analyzed under prototype configuration"
          />

          {/* Total Volume */}
          <StatCard
            label="Total Volume"
            value={formatDecimal(currentBlock.total_volume_btc, 2)}
            subValue="BTC"
            icon={Coins}
            iconColor="text-btc-primary"
            tooltip="Sum of transaction outputs in analyzed block"
          />

          {/* Total Fees */}
          <StatCard
            label="Total Fees"
            value={formatDecimal(currentBlock.total_fees_btc, 4)}
            subValue="BTC"
            icon={Receipt}
            iconColor="text-intel-blue"
            tooltip="Aggregate miner fees in analyzed transactions"
          />

          {/* Average TX */}
          <StatCard
            label="Average TX"
            value={formatDecimal(currentBlock.avg_tx_btc, 4)}
            subValue="BTC"
            icon={TrendingUp}
            iconColor="text-intel-purple"
            tooltip="Average output size of analyzed transactions"
          />

          {/* Largest TX */}
          <StatCard
            label="Largest TX"
            value={formatDecimal(currentBlock.largest_tx_btc, 2)}
            subValue="BTC"
            icon={Coins}
            iconColor="text-intel-amber"
            tooltip="Largest single transaction observed in this block"
          />

          {/* Inputs & Outputs */}
          <StatCard
            label="Inputs / Outputs"
            value={formatInteger(currentBlock.input_count)}
            subValue={`/ ${formatInteger(currentBlock.output_count)}`}
            icon={ArrowDownUp}
            iconColor="text-intel-cyan"
            tooltip="Total transaction inputs and outputs processed"
          />

          {/* Backend Processing Time */}
          <div className="col-span-2 intel-card p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
              <span className="uppercase tracking-wider font-medium">Actual Processing Time</span>
              <Clock className="w-4 h-4 text-intel-cyan" />
            </div>
            <div className="flex items-baseline gap-2 my-1">
              <span className="text-xl lg:text-2xl font-bold font-mono text-white">
                {currentBlock.total_time_sec}s
              </span>
              <span className="text-xs font-mono text-slate-400">Total Latency</span>
            </div>
            <div className="flex items-center gap-4 text-[11px] font-mono text-slate-400 pt-1 border-t border-dark-700/50">
              <span>Fetch: <strong className="text-slate-200">{currentBlock.fetch_time_sec}s</strong></span>
              <span>Analysis: <strong className="text-intel-emerald font-bold">{currentBlock.analysis_time_sec}s</strong></span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Honest Scope Transparency Callout */}
      {currentBlock && (
        <div className="p-3.5 rounded-xl bg-dark-900/80 border border-dark-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-btc-primary" />
            <span className="text-slate-300">
              <strong className="text-white">TRANSPARENT DATA SCOPE:</strong> Block #{currentBlock.height} contains <strong>{formatInteger(currentBlock.tx_count)}</strong> total transactions. Analyzed: <strong>{formatInteger(currentBlock.analyzed_tx_count)}</strong> ({currentBlock.coverage_pct}% coverage).
            </span>
          </div>
          <button
            onClick={() => onNavigateTo('block', currentBlock.height.toString())}
            className="text-intel-cyan hover:underline flex items-center gap-1 font-semibold whitespace-nowrap"
          >
            <span>Open Detailed Analysis</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="intel-card p-5 border-intel-cyan/40">
        <div className="flex items-center gap-2 mb-4">
          <Bot className="w-4 h-4 text-intel-cyan" />
          <h2 className="text-sm font-bold font-mono text-white tracking-wider uppercase">AI 1-HOUR INTELLIGENCE</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 items-end">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-mono mb-2">Start Time</span>
            <input
              type="time"
              value={hourlyStart}
              onChange={(e) => setHourlyStart(e.target.value)}
              className="w-full rounded-lg border border-dark-700 bg-dark-950 px-3 py-2 text-white font-mono text-sm focus:border-intel-cyan focus:outline-none"
            />
          </label>

          <div className="rounded-xl border border-dark-700 bg-dark-950/60 px-3 py-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-mono mb-2">Analysis Window</div>
            <div className="font-mono text-sm text-slate-200">
              {hourlyStart} → {String((Number(hourlyStart.split(':')[0]) + 1) % 24).padStart(2, '0') + ':' + hourlyStart.split(':')[1]}
            </div>
          </div>
        </div>

        <button
          onClick={handleGenerateHourlySummary}
          disabled={hourlyLoading}
          className="mt-4 px-3 py-2 rounded-lg bg-intel-cyan/15 border border-intel-cyan/40 text-intel-cyan text-xs font-mono font-bold disabled:opacity-50"
        >
          {hourlyLoading ? 'Analyzing blocks from ' + hourlyStart + ' to ' + (String((Number(hourlyStart.split(':')[0]) + 1) % 24).padStart(2, '0') + ':' + hourlyStart.split(':')[1]) + '...' : 'Generate 1-Hour Summary'}
        </button>

        {hourlyError && (
          <div className="mt-4 rounded-lg border border-intel-amber/40 bg-intel-amber/10 p-3 text-xs font-mono text-intel-amber">
            {hourlyError}
          </div>
        )}

        {hourlySummary && (
          <div className="mt-5 rounded-lg border border-intel-cyan/30 bg-dark-950/80 p-4 text-xs font-mono text-slate-200">
            <div className="mb-3 text-[10px] uppercase tracking-wider text-slate-400">
              {hourlySummary.time_window?.label || 'Selected window'}
            </div>

            {hourlySummary.status === 'no_data' ? (
              <p className="text-slate-200">No Bitcoin blocks were received during this time window.</p>
            ) : hourlySummary.status === 'ok' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                  <div className="rounded border border-dark-700 bg-dark-900/70 p-2"><span className="block text-slate-400 mb-1">Blocks</span><strong className="text-white">{hourlySummary.blocks_analyzed ?? 0}</strong></div>
                  <div className="rounded border border-dark-700 bg-dark-900/70 p-2"><span className="block text-slate-400 mb-1">Transactions</span><strong className="text-white">{hourlySummary.transactions_analyzed ?? 0}</strong></div>
                  <div className="rounded border border-dark-700 bg-dark-900/70 p-2"><span className="block text-slate-400 mb-1">BTC Transferred</span><strong className="text-white">{hourlySummary.aggregated?.total_btc_transferred ?? 0} BTC</strong></div>
                  <div className="rounded border border-dark-700 bg-dark-900/70 p-2"><span className="block text-slate-400 mb-1">Avg Tx</span><strong className="text-white">{hourlySummary.aggregated?.average_transaction_btc ?? 0} BTC</strong></div>
                </div>

                <div className="space-y-3">
                  <div><div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Overview</div><p className="leading-relaxed text-slate-200">{hourlySummary.overview}</p></div>
                  <div><div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Block Activity</div><p className="leading-relaxed text-slate-200">{hourlySummary.block_activity}</p></div>
                  <div><div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Transaction Activity</div><p className="leading-relaxed text-slate-200">{hourlySummary.transaction_activity}</p></div>
                  <div><div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Address Activity</div><p className="leading-relaxed text-slate-200">{hourlySummary.address_activity}</p></div>
                  <div><div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Notable Patterns</div><p className="leading-relaxed text-slate-200">{hourlySummary.notable_patterns}</p></div>
                  <div><div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Investigation Focus</div><p className="leading-relaxed text-slate-200">{hourlySummary.investigation_focus}</p></div>
                </div>
              </div>
            ) : (
              <p className="text-slate-200">{hourlySummary.message || 'The AI summary is currently unavailable.'}</p>
            )}
          </div>
        )}
      </div>

      {/* Interactive Charts Section with Metric Switcher */}
      <div className="intel-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 border-b border-dark-700/50 pb-4">
          <div>
            <h2 className="text-sm font-bold font-mono text-white tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-intel-cyan" />
              BLOCKCHAIN INTELLIGENCE TELEMETRY
            </h2>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5">
              Multi-block trends across recent real Bitcoin blocks
            </p>
          </div>

          {/* Metric Switcher Tabs */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-dark-950 border border-dark-700/80 rounded-lg">
            <button
              onClick={() => setActiveMetric('volume')}
              className={`px-3 py-1 rounded text-xs font-mono font-medium transition-colors ${
                activeMetric === 'volume'
                  ? 'bg-btc-primary text-white font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              BTC Volume
            </button>
            <button
              onClick={() => setActiveMetric('txs')}
              className={`px-3 py-1 rounded text-xs font-mono font-medium transition-colors ${
                activeMetric === 'txs'
                  ? 'bg-btc-primary text-white font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Transactions
            </button>
            <button
              onClick={() => setActiveMetric('fees')}
              className={`px-3 py-1 rounded text-xs font-mono font-medium transition-colors ${
                activeMetric === 'fees'
                  ? 'bg-btc-primary text-white font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Fees
            </button>
            <button
              onClick={() => setActiveMetric('in_out')}
              className={`px-3 py-1 rounded text-xs font-mono font-medium transition-colors ${
                activeMetric === 'in_out'
                  ? 'bg-btc-primary text-white font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              IN / OUT
            </button>
            <button
              onClick={() => setActiveMetric('addresses')}
              className={`px-3 py-1 rounded text-xs font-mono font-medium transition-colors ${
                activeMetric === 'addresses'
                  ? 'bg-btc-primary text-white font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Top Addresses
            </button>
          </div>
        </div>

        {/* Selected Chart Content */}
        <div className="mt-2">
          {activeMetric === 'volume' && (
            <div>
              <div className="flex items-center justify-between mb-2 text-xs font-mono text-slate-400">
                <span>Metric: Total BTC Volume per Block</span>
                <span className="text-btc-primary">Source: Real Block Outputs</span>
              </div>
              <VolumeChart data={volumeChartData} height={300} />
            </div>
          )}

          {activeMetric === 'txs' && (
            <div>
              <div className="flex items-center justify-between mb-2 text-xs font-mono text-slate-400">
                <span>Metric: Analyzed Transactions per Block</span>
                <span className="text-intel-cyan">Source: Real Transactions</span>
              </div>
              <ActivityChart data={activityChartData} height={300} />
            </div>
          )}

          {activeMetric === 'fees' && (
            <div>
              <div className="flex items-center justify-between mb-2 text-xs font-mono text-slate-400">
                <span>Metric: Total Miner Fees per Block (BTC)</span>
                <span className="text-intel-blue">Source: Real Fees</span>
              </div>
              <VolumeChart data={feesChartData} height={300} />
            </div>
          )}

          {activeMetric === 'in_out' && (
            <div>
              <div className="flex items-center justify-between mb-2 text-xs font-mono text-slate-400">
                <span>Metric: Incoming vs Outgoing Flow</span>
                <span className="text-intel-emerald">Source: Input/Output UTXO Sums</span>
              </div>
              <InOutChart data={inOutChartData} height={300} />
            </div>
          )}

          {activeMetric === 'addresses' && (
            <div>
              <div className="flex items-center justify-between mb-2 text-xs font-mono text-slate-400">
                <span>Metric: Most Active Addresses in Block #{currentBlock?.height}</span>
                <span className="text-intel-blue">Click address bar to inspect</span>
              </div>
              <AddressDistributionChart
                data={topAddresses.map(a => ({
                  address: a.address,
                  tx_count: a.tx_count,
                  total_activity_btc: a.total_activity_btc
                }))}
                height={300}
                onSelectAddress={(addr) => onNavigateTo('address', addr)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Two Column Section: Recent Analyzed Blocks & Most Active Addresses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Analyzed Blocks Table */}
        <div className="intel-card overflow-hidden">
          <div className="intel-card-header">
            <div className="flex items-center gap-2">
              <Boxes className="w-4 h-4 text-btc-primary" />
              <span className="text-xs font-bold font-mono tracking-wider text-white uppercase">
                Recent Analyzed Blocks
              </span>
            </div>
            <button
              onClick={() => onNavigateTo('page', 'live-blocks')}
              className="text-xs text-intel-cyan hover:underline font-mono flex items-center gap-1"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-dark-950/80 text-slate-400 border-b border-dark-700/60">
                <tr>
                  <th className="py-2.5 px-3">Height</th>
                  <th className="py-2.5 px-3">Coverage</th>
                  <th className="py-2.5 px-3">Volume</th>
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700/40">
                {blocks.map((b) => {
                  const isPulsing = pulseBlockHeight === b.height;
                  return (
                    <tr
                      key={b.hash}
                      onClick={() => onNavigateTo('block', b.height.toString())}
                      className={`hover:bg-dark-800/60 cursor-pointer transition-colors ${
                        isPulsing ? 'bg-btc-primary/20 animate-pulse' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 font-bold text-white flex items-center gap-1.5">
                        <span className="text-btc-primary">#{b.height}</span>
                        {isPulsing && (
                          <span className="px-1 py-0.2 text-[9px] rounded bg-btc-primary text-black font-bold">
                            NEW
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">
                        {b.analyzed_tx_count}/{b.tx_count} ({b.coverage_pct}%)
                      </td>
                      <td className="py-2.5 px-3 text-slate-200 font-semibold">
                        {formatDecimal(b.total_volume_btc, 2)} BTC
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">
                        {b.total_time_sec}s
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="text-intel-cyan hover:underline text-[11px]">
                          Inspect →
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Active Addresses in Current Block */}
        <div className="intel-card overflow-hidden">
          <div className="intel-card-header">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-intel-cyan" />
              <span className="text-xs font-bold font-mono tracking-wider text-white uppercase">
                Top Active Addresses
              </span>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              Block #{currentBlock?.height}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-dark-950/80 text-slate-400 border-b border-dark-700/60">
                <tr>
                  <th className="py-2.5 px-3">Address</th>
                  <th className="py-2.5 px-3">TXs</th>
                  <th className="py-2.5 px-3">Volume (BTC)</th>
                  <th className="py-2.5 px-3 text-right">Follow</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700/40">
                {topAddresses.slice(0, 6).map((addr) => (
                  <tr
                    key={addr.address}
                    onClick={() => onNavigateTo('address', addr.address)}
                    className="hover:bg-dark-800/60 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-3 text-slate-200 font-medium truncate max-w-[140px]">
                      <span className="hover:text-intel-cyan">
                        {addr.address.substring(0, 6)}...{addr.address.substring(addr.address.length - 6)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-intel-cyan font-bold">
                      {addr.tx_count}
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">
                      {formatDecimal(addr.total_activity_btc, 4)}
                    </td>
                    <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <FollowButton
                        address={addr.address}
                        isInitiallyFollowed={addr.is_followed}
                        size="sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
