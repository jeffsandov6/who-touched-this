/** @jsxImportSource react */

import { useState } from 'react';

import './WttCoin.css';

const mintAddress = 'B6GqRNfVZ5aW2mkB4u7PJqAvh49qCaEF7uHUoPgRnQet';

const stats = {
    earned: '—',
    claimed: '—',
    unclaimed: '—',
    holders: '—',
    supply: '—',
};

export default function WttCoin() {
    const [showBuyMessage, setShowBuyMessage] = useState(false);

    return (
        <section className="wtt-coin">
            <header className="wtt-coin-header">
                <div className="wtt-coin-topline">
                    <p className="wtt-coin-warning">
                        DON'T BUY THIS COIN
                    </p>

                    <span className="wtt-coin-chain">
                        SOLANA
                    </span>
                </div>

                <div>
                    <p className="wtt-coin-symbol">WTT</p>
                    <p className="wtt-coin-name">who touched this</p>
                </div>
            </header>

            <div className="wtt-coin-chart">
                <div className="wtt-coin-chart-header">
                    <div>
                        <span>price</span>
                        <strong>$0.00</strong>
                    </div>

                    <span className="wtt-coin-chart-range">ALL</span>
                </div>

                <div className="wtt-coin-chart-plot">
                    <svg
                        className="wtt-coin-chart-svg"
                        viewBox="0 0 600 100"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                    >
                        <line className="wtt-coin-chart-grid" x1="0" y1="20" x2="600" y2="20" />
                        <line className="wtt-coin-chart-grid" x1="0" y1="50" x2="600" y2="50" />
                        <line className="wtt-coin-chart-grid" x1="0" y1="80" x2="600" y2="80" />

                        <line className="wtt-coin-chart-grid" x1="150" y1="0" x2="150" y2="100" />
                        <line className="wtt-coin-chart-grid" x1="300" y1="0" x2="300" y2="100" />
                        <line className="wtt-coin-chart-grid" x1="450" y1="0" x2="450" y2="100" />

                        <line
                            className="wtt-coin-chart-line"
                            x1="4"
                            y1="58"
                            x2="596"
                            y2="58"
                        />

                        <circle
                            className="wtt-coin-chart-point"
                            cx="596"
                            cy="58"
                            r="3"
                        />
                    </svg>

                    <span className="wtt-coin-chart-value">$0.00</span>
                </div>

                <div className="wtt-coin-chart-axis">
                    <span>launch</span>
                    <span>now</span>
                </div>
            </div>

            <div className="wtt-coin-section">
                <p className="wtt-coin-section-heading">rewards</p>

                <dl className="wtt-coin-stats wtt-coin-stats--three">
                    <div className="wtt-coin-stat">
                        <dt className="wtt-coin-stat-label">earned</dt>
                        <dd className="wtt-coin-stat-value">{stats.earned}</dd>
                    </div>

                    <div className="wtt-coin-stat">
                        <dt className="wtt-coin-stat-label">claimed</dt>
                        <dd className="wtt-coin-stat-value">{stats.claimed}</dd>
                    </div>

                    <div className="wtt-coin-stat">
                        <dt className="wtt-coin-stat-label">unclaimed</dt>
                        <dd className="wtt-coin-stat-value">{stats.unclaimed}</dd>
                    </div>
                </dl>
            </div>

            <div className="wtt-coin-section">
                <p className="wtt-coin-section-heading">on-chain</p>

                <dl className="wtt-coin-stats wtt-coin-stats--two">
                    <div className="wtt-coin-stat">
                        <dt className="wtt-coin-stat-label">holders</dt>
                        <dd className="wtt-coin-stat-value">{stats.holders}</dd>
                    </div>

                    <div className="wtt-coin-stat">
                        <dt className="wtt-coin-stat-label">supply</dt>
                        <dd className="wtt-coin-stat-value">{stats.supply}</dd>
                    </div>
                </dl>
            </div>

            <div className="wtt-coin-section">
                <p className="wtt-coin-section-heading">market</p>

                <dl className="wtt-coin-market">
                    <div className="wtt-coin-stat">
                        <dt className="wtt-coin-stat-label">price</dt>
                        <dd className="wtt-coin-stat-value">N/A</dd>
                    </div>

                    <div className="wtt-coin-stat">
                        <dt className="wtt-coin-stat-label">24h volume</dt>
                        <dd className="wtt-coin-stat-value">$0.00</dd>
                    </div>

                    <div className="wtt-coin-stat">
                        <dt className="wtt-coin-stat-label">for sale</dt>
                        <dd className="wtt-coin-stat-value">0</dd>
                    </div>
                </dl>
            </div>

            <div className="wtt-coin-buy-row">
                {!showBuyMessage ? (
                    <button
                        type="button"
                        className="wtt-coin-buy-button"
                        onClick={() => setShowBuyMessage(true)}
                    >
                        BUY
                    </button>
                ) : (
                    <p className="wtt-coin-buy-message">
                        you literally can&apos;t buy it.
                        <br />
                        but you can{' '}
                        <a className="wtt-coin-earn-link" href="/join">
                            earn one →
                        </a>
                        <br />
                        <span className="wtt-coin-buy-aside">
                            (and you can&apos;t sell it either. market value: $0)
                        </span>
                    </p>
                )}
            </div>

            <footer className="wtt-coin-footer">
                <div className="wtt-coin-mint">
                    <span>mint</span>

                    <code title={mintAddress}>
                        B6GqRN...PgRnQet
                    </code>
                </div>

                <div className="wtt-coin-links">
                    <a
                        href={`https://solscan.io/token/${mintAddress}`}
                        target="_blank"
                        rel="noreferrer"
                    >
                        solscan ↗
                    </a>

                    <a
                        href={`https://explorer.solana.com/address/${mintAddress}`}
                        target="_blank"
                        rel="noreferrer"
                    >
                        solana explorer ↗
                    </a>
                </div>
            </footer>
        </section>
    );
}