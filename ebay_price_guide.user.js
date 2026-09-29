// ==UserScript==
// @name         eBay Price Guide Insights
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Shows eBay's trading card Price Guide insights inline on listing pages, without opening the "See insights" modal
// @author       You
// @match        https://www.ebay.com/itm/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        // Same-origin endpoint the "See insights" modal loads its data from
        marketDataUrl: '/wcs/get-market-data/listing-id?listingid=',

        // Give up on the market data request after this long (ms)
        requestTimeout: 15000,

        // Number of recent sales to show
        recentSalesLimit: 5,

        // How long to wait for the listing's right-hand panel to render (ms)
        anchorTimeout: 10000,

        // localStorage key for remembering the collapsed state
        collapsedKey: 'ebay_pg_insights_collapsed'
    };

    const PANEL_ID = 'ebay-pg-insights';

    /**
     * Get the listing ID from the current URL
     * @returns {string|null} Listing ID
     */
    function getListingId() {
        const match = location.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/);
        return match ? match[1] : null;
    }

    /**
     * Fetch price guide data for a listing
     * @param {string} listingId - eBay listing ID
     * @returns {Promise<object|null>} The listing object from the market data response
     */
    async function fetchMarketData(listingId) {
        // Note: don't send a custom Accept header - the endpoint stalls when one is set
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeout);

        const response = await fetch(CONFIG.marketDataUrl + encodeURIComponent(listingId), {
            credentials: 'include',
            signal: controller.signal
        }).finally(() => clearTimeout(timer));

        if (!response.ok) {
            throw new Error('Market data request failed with status ' + response.status);
        }

        const json = await response.json();
        return json?.data?.listingV2ById?.listing || null;
    }

    /**
     * Pull a numeric amount and currency out of an eBay price object
     * Prefers the converted (viewer's currency) amount over the original
     * @param {object} price - { original: {amount, currency}, converted: {amount, currency} }
     * @returns {{amount: number, currency: string}|null}
     */
    function readPrice(price) {
        const p = price?.converted || price?.original;
        if (!p || p.amount == null) return null;

        const amount = parseFloat(p.amount);
        if (isNaN(amount)) return null;

        return { amount, currency: p.currency || 'USD' };
    }

    /**
     * Format a price object for display
     * @param {{amount: number, currency: string}|null} price
     * @returns {string}
     */
    function formatPrice(price) {
        if (!price) return '—';
        try {
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: price.currency }).format(price.amount);
        } catch (e) {
            return price.currency + ' ' + price.amount.toFixed(2);
        }
    }

    /**
     * Format an ISO date (YYYY-MM-DD) as e.g. "Sep 28"
     * @param {string} isoDate
     * @returns {string}
     */
    function formatDate(isoDate) {
        if (!isoDate) return '';
        const date = new Date(isoDate + 'T00:00:00');
        if (isNaN(date)) return isoDate;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    /**
     * Escape text for safe insertion into HTML
     * @param {string} text
     * @returns {string}
     */
    function escapeHtml(text) {
        // Escapes quotes too, so the result is safe inside attribute values (e.g. title="...")
        return (text == null ? '' : String(text))
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Work out which grader and grade this listing is, from its condition descriptors
     * @param {object} listing - Listing object from the market data response
     * @returns {{graderId: string|null, graderName: string|null, grade: string|null}}
     */
    function getListingGrade(listing) {
        const descriptors = listing?.itemCondition?.itemConditionDescriptors || [];
        const result = { graderId: null, graderName: null, grade: null };

        descriptors.forEach(d => {
            const value = d.conditionDescriptorValues?.[0];
            if (!value) return;

            if (d.conditionDescriptor?.id === '27501') {
                result.graderId = value.id;
                result.graderName = value.displayName;
            } else if (d.conditionDescriptor?.id === '27502') {
                result.grade = value.displayName;
            }
        });

        return result;
    }

    /**
     * Get a short grader name, e.g. "Professional Sports Authenticator (PSA)" -> "PSA"
     * @param {string} name
     * @returns {string}
     */
    function shortGraderName(name) {
        const match = (name || '').match(/\(([^)]+)\)\s*$/);
        return match ? match[1] : (name || 'Unknown');
    }

    /**
     * Get the current listing price from the page
     * @returns {{amount: number, currency: string}|null}
     */
    function getListingPrice() {
        const selectors = [
            '[data-testid="x-price-primary"] .ux-textspans',
            '.x-price-primary .ux-textspans',
            '.x-price-primary'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (!el) continue;

            const match = el.textContent.replace(/,/g, '').match(/([\d]+(?:\.\d{1,2})?)/);
            if (match) {
                // eBay.com listings are shown in USD
                return { amount: parseFloat(match[1]), currency: 'USD' };
            }
        }

        return null;
    }

    /**
     * Build an inline SVG chart of weekly median sold price with sold-count bars
     * @param {Array} trends - metricsTrends array
     * @returns {string} SVG markup
     */
    function buildTrendChart(trends) {
        const points = (trends || [])
            .map(t => ({ date: t.soldDate, price: readPrice(t.medianPrice), count: t.itemSoldCount || 0 }))
            // Weeks with no sales come back with a $0 median - skip them
            .filter(p => p.price && p.price.amount > 0);

        if (points.length < 2) return '';

        const width = 300;
        const height = 80;
        const pad = { top: 8, right: 4, bottom: 16, left: 4 };
        const innerW = width - pad.left - pad.right;
        const innerH = height - pad.top - pad.bottom;

        const prices = points.map(p => p.price.amount);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const priceRange = maxPrice - minPrice || 1;
        const maxCount = Math.max(...points.map(p => p.count), 1);

        const step = innerW / (points.length - 1);
        const x = i => pad.left + i * step;
        const y = v => pad.top + innerH - ((v - minPrice) / priceRange) * innerH;

        const barWidth = Math.max(2, step * 0.5);
        const bars = points.map((p, i) => {
            const h = (p.count / maxCount) * innerH * 0.5;
            return `<rect x="${(x(i) - barWidth / 2).toFixed(1)}" y="${(pad.top + innerH - h).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" class="pg-bar"><title>${escapeHtml(formatDate(p.date))}: ${escapeHtml(p.count)} sold</title></rect>`;
        }).join('');

        const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.price.amount).toFixed(1)}`).join(' ');
        const dots = points.map((p, i) =>
            `<circle cx="${x(i).toFixed(1)}" cy="${y(p.price.amount).toFixed(1)}" r="2.5" class="pg-dot"><title>Week of ${escapeHtml(formatDate(p.date))}: ${escapeHtml(formatPrice(p.price))} median, ${escapeHtml(p.count)} sold</title></circle>`
        ).join('');

        const first = points[0];
        const last = points[points.length - 1];

        return `
            <svg class="pg-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Weekly median sold price">
                ${bars}
                <polyline points="${line}" class="pg-line"/>
                ${dots}
                <text x="${pad.left}" y="${height - 3}" class="pg-axis">${escapeHtml(formatDate(first.date))}</text>
                <text x="${width - pad.right}" y="${height - 3}" class="pg-axis" text-anchor="end">${escapeHtml(formatDate(last.date))}</text>
            </svg>
            <div class="pg-chart-legend">
                <span><i class="pg-swatch pg-swatch-line"></i>Weekly median (${escapeHtml(formatPrice({ amount: minPrice, currency: first.price.currency }))} – ${escapeHtml(formatPrice({ amount: maxPrice, currency: first.price.currency }))})</span>
                <span><i class="pg-swatch pg-swatch-bar"></i>Sold per week</span>
            </div>`;
    }

    /**
     * Build the comparison of this listing's price against the median
     * @param {{amount: number}|null} listingPrice
     * @param {{amount: number}|null} median
     * @returns {string} HTML
     */
    function buildComparison(listingPrice, median) {
        if (!listingPrice || !median || !median.amount) return '';

        const diff = listingPrice.amount - median.amount;
        const pct = (diff / median.amount) * 100;

        let cls = 'pg-fair';
        let label = 'Around median';
        if (pct > 20) { cls = 'pg-high'; label = 'Well above median'; }
        else if (pct > 5) { cls = 'pg-above'; label = 'Above median'; }
        else if (pct < -5) { cls = 'pg-good'; label = 'Below median'; }

        const sign = diff >= 0 ? '+' : '−';
        return `
            <div class="pg-compare ${cls}">
                <strong>${label}</strong>
                <span>This listing ${escapeHtml(formatPrice(listingPrice))} is ${sign}${escapeHtml(formatPrice({ amount: Math.abs(diff), currency: median.currency }))} (${sign}${Math.abs(pct).toFixed(1)}%) vs. median</span>
            </div>`;
    }

    /**
     * Build the grade comparison tables for each grading company
     * @param {Array} byGrader - priceGuidanceByGradingCompany array
     * @param {object} current - Result of getListingGrade
     * @returns {string} HTML
     */
    function buildGradeTables(byGrader, current) {
        if (!byGrader || !byGrader.length) return '';

        // Current grader first
        const sorted = [...byGrader].sort((a, b) =>
            (b.grader?.id === current.graderId) - (a.grader?.id === current.graderId)
        );

        return sorted.map(g => {
            const isCurrentGrader = g.grader?.id === current.graderId;
            const rows = (g.grades || []).map(gr => {
                const guidance = gr.priceGuidance || {};
                const median = readPrice(guidance.recommendations?.fixedPrice?.suggestedPrice);
                const min = readPrice(guidance.recommendations?.soldPriceRange?.minPrice);
                const max = readPrice(guidance.recommendations?.soldPriceRange?.maxPrice);
                const sold = guidance.meta?.totalUnitSold ?? guidance.meta?.totalTransactions ?? 0;
                const isCurrent = isCurrentGrader && gr.grade?.displayName === current.grade;

                return `
                    <tr class="${isCurrent ? 'pg-current' : ''}">
                        <td>${escapeHtml(shortGraderName(g.grader?.displayName))} ${escapeHtml(gr.grade?.displayName)}${isCurrent ? ' <span class="pg-tag">This item</span>' : ''}</td>
                        <td class="pg-num">${escapeHtml(formatPrice(median))}</td>
                        <td class="pg-num pg-muted">${min && max ? escapeHtml(formatPrice(min)) + '–' + escapeHtml(formatPrice(max)) : '—'}</td>
                        <td class="pg-num">${escapeHtml(sold)}</td>
                    </tr>`;
            }).join('');

            return `
                <details class="pg-grader" ${isCurrentGrader ? 'open' : ''}>
                    <summary>${escapeHtml(g.grader?.displayName || 'Unknown grader')} <span class="pg-muted">(${(g.grades || []).length} grade${(g.grades || []).length === 1 ? '' : 's'})</span></summary>
                    <table class="pg-table">
                        <thead><tr><th>Grade</th><th class="pg-num">Median</th><th class="pg-num">Range</th><th class="pg-num">Sold</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </details>`;
        }).join('');
    }

    /**
     * Build the recent sales list
     * @param {Array} listings - priceGuidance.listings array
     * @returns {string} HTML
     */
    function buildRecentSales(listings) {
        const sales = (listings || []).slice(0, CONFIG.recentSalesLimit);
        if (!sales.length) return '';

        const rows = sales.map(s => {
            const proof = s.proofPoint || {};
            const price = readPrice(s.price);
            const shipping = readPrice(s.shippingCost);
            const format = proof.listingFormat === 'AUCTION' ? `Auction${proof.bidCount && proof.bidCount !== '0' ? ' · ' + proof.bidCount + ' bids' : ''}`
                : proof.bestOffer ? 'Best Offer' : (proof.listingFormat === 'BIN' ? 'Buy It Now' : (proof.listingFormat || ''));
            const title = proof.title || 'Listing ' + proof.listingId;
            const titleHtml = proof.listingId && proof.source === 'EBAY'
                ? `<a href="/itm/${encodeURIComponent(proof.listingId)}" target="_blank" rel="noopener" title="${escapeHtml(title)}">${escapeHtml(title)}</a>`
                : `<span title="${escapeHtml(title)}">${escapeHtml(title)}</span>`;

            return `
                <tr>
                    <td class="pg-muted pg-nowrap">${escapeHtml(formatDate(s.soldDate))}</td>
                    <td class="pg-title">${titleHtml}<div class="pg-muted">${escapeHtml(format)}${proof.source && proof.source !== 'EBAY' ? ' · ' + escapeHtml(proof.source) : ''}</div></td>
                    <td class="pg-num pg-nowrap"><strong>${escapeHtml(formatPrice(price))}</strong>${shipping && shipping.amount > 0 ? `<div class="pg-muted">+${escapeHtml(formatPrice(shipping))} ship</div>` : ''}</td>
                </tr>`;
        }).join('');

        return `
            <details class="pg-section" open>
                <summary>Recent sales</summary>
                <table class="pg-table pg-sales"><tbody>${rows}</tbody></table>
            </details>`;
    }

    /**
     * Build the full panel HTML
     * @param {object} listing - Listing object from the market data response
     * @returns {string|null} HTML, or null if there is no price guide data
     */
    function buildPanel(listing) {
        const cards = listing?.items?.[0]?.itemCollectiblePriceGuidance?.tradingCardsOnViewItem;
        const guidance = cards?.priceGuidance;
        if (!guidance) return null;

        const current = getListingGrade(listing);
        const rec = guidance.recommendations || {};
        const meta = guidance.meta || {};

        // Prefer this grade's own stats when available (matches the modal's "This item" row)
        let gradeGuidance = null;
        (cards.priceGuidanceByGradingCompany || []).forEach(g => {
            if (g.grader?.id !== current.graderId) return;
            const match = (g.grades || []).find(gr => gr.grade?.displayName === current.grade);
            if (match) gradeGuidance = match.priceGuidance;
        });

        const median = readPrice((gradeGuidance || guidance).recommendations?.fixedPrice?.suggestedPrice)
            || readPrice(rec.fixedPrice?.suggestedPrice);
        const soldCount = (gradeGuidance || guidance).meta?.totalUnitSold ?? meta.totalUnitSold;
        const min = readPrice(rec.soldPriceRange?.minPrice);
        const max = readPrice(rec.soldPriceRange?.maxPrice);
        const lastSale = guidance.listings?.[0];
        const lastPrice = lastSale ? readPrice(lastSale.price) : null;
        const days = meta.dateWindowAppliedInDays || 90;

        const raw = cards.priceGuidanceByUngradedCondition;
        const rawMedian = readPrice(raw?.recommendations?.fixedPrice?.suggestedPrice);
        const rawSold = raw?.meta?.totalUnitSold;

        const gradeLabel = current.graderName
            ? `${shortGraderName(current.graderName)} ${current.grade || ''}`.trim()
            : (listing.itemCondition?.displayName || '');

        const collapsed = (() => {
            try { return localStorage.getItem(CONFIG.collapsedKey) === '1'; } catch (e) { return false; }
        })();

        return `
            <div class="pg-header">
                <div>
                    <div class="pg-title-main">Price Guide insights</div>
                    <div class="pg-muted">${escapeHtml(gradeLabel)} · last ${escapeHtml(days)} days</div>
                </div>
                <div class="pg-actions">
                    <button type="button" class="pg-btn" data-pg-action="open-modal" title="Open eBay's full insights modal">Full view</button>
                    <button type="button" class="pg-btn" data-pg-action="toggle" aria-expanded="${!collapsed}">${collapsed ? 'Show' : 'Hide'}</button>
                </div>
            </div>
            <div class="pg-body" ${collapsed ? 'hidden' : ''}>
                <div class="pg-stats">
                    <div class="pg-stat"><div class="pg-label">Median sold</div><div class="pg-value">${escapeHtml(formatPrice(median))}</div></div>
                    <div class="pg-stat"><div class="pg-label">Sold</div><div class="pg-value">${escapeHtml(soldCount ?? '—')}</div></div>
                    <div class="pg-stat"><div class="pg-label">Last sold</div><div class="pg-value">${escapeHtml(formatPrice(lastPrice))}</div><div class="pg-muted">${escapeHtml(formatDate(lastSale?.soldDate))}</div></div>
                    <div class="pg-stat"><div class="pg-label">Sold range</div><div class="pg-value pg-small">${min && max ? escapeHtml(formatPrice(min)) + ' – ' + escapeHtml(formatPrice(max)) : '—'}</div></div>
                    <div class="pg-stat"><div class="pg-label">Sellers</div><div class="pg-value">${escapeHtml(meta.totalSellers ?? '—')}</div></div>
                    <div class="pg-stat"><div class="pg-label">Raw (ungraded)</div><div class="pg-value">${escapeHtml(formatPrice(rawMedian))}</div>${rawSold != null ? `<div class="pg-muted">${escapeHtml(rawSold)} sold</div>` : ''}</div>
                </div>
                ${buildComparison(getListingPrice(), median)}
                ${buildTrendChart(guidance.metricsTrends)}
                <details class="pg-section" open>
                    <summary>Compare grades</summary>
                    ${buildGradeTables(cards.priceGuidanceByGradingCompany, current)}
                </details>
                ${buildRecentSales(guidance.listings)}
            </div>`;
    }

    /**
     * Inject the panel's styles
     */
    function injectStyles() {
        if (document.getElementById(PANEL_ID + '-styles')) return;

        const style = document.createElement('style');
        style.id = PANEL_ID + '-styles';
        style.textContent = `
            #${PANEL_ID} { border: 1px solid #e5e5e5; border-radius: 12px; padding: 14px 16px; margin: 12px 0 20px; font-size: 13px; color: #191919; background: #fff; }
            #${PANEL_ID} .pg-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
            #${PANEL_ID} .pg-title-main { font-size: 16px; font-weight: 700; }
            #${PANEL_ID} .pg-muted { color: #707070; font-size: 12px; }
            #${PANEL_ID} .pg-actions { display: flex; gap: 6px; flex-shrink: 0; }
            #${PANEL_ID} .pg-btn { border: 1px solid #c7c7c7; background: #fff; border-radius: 16px; padding: 4px 12px; font-size: 12px; cursor: pointer; color: #191919; }
            #${PANEL_ID} .pg-btn:hover { background: #f7f7f7; }
            #${PANEL_ID} .pg-body { margin-top: 12px; }
            #${PANEL_ID} .pg-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
            #${PANEL_ID} .pg-stat { background: #f7f7f7; border-radius: 8px; padding: 8px 10px; min-width: 0; }
            #${PANEL_ID} .pg-label { color: #707070; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
            #${PANEL_ID} .pg-value { font-size: 16px; font-weight: 700; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            #${PANEL_ID} .pg-value.pg-small { font-size: 13px; }
            #${PANEL_ID} .pg-compare { margin-top: 10px; padding: 8px 10px; border-radius: 8px; border-left: 4px solid; display: flex; flex-direction: column; gap: 2px; }
            #${PANEL_ID} .pg-good { background: #e9f7ef; border-color: #1e8a44; }
            #${PANEL_ID} .pg-fair { background: #eef4fd; border-color: #3665f3; }
            #${PANEL_ID} .pg-above { background: #fff6e5; border-color: #c77700; }
            #${PANEL_ID} .pg-high { background: #fdecec; border-color: #d0021b; }
            #${PANEL_ID} .pg-chart { width: 100%; height: 90px; margin-top: 12px; display: block; }
            #${PANEL_ID} .pg-line { fill: none; stroke: #3665f3; stroke-width: 2; vector-effect: non-scaling-stroke; }
            #${PANEL_ID} .pg-dot { fill: #3665f3; }
            #${PANEL_ID} .pg-bar { fill: #d6dff9; }
            #${PANEL_ID} .pg-axis { font-size: 9px; fill: #707070; }
            #${PANEL_ID} .pg-chart-legend { display: flex; gap: 14px; flex-wrap: wrap; color: #707070; font-size: 11px; margin-top: 2px; }
            #${PANEL_ID} .pg-swatch { display: inline-block; width: 10px; height: 10px; margin-right: 4px; vertical-align: -1px; border-radius: 2px; }
            #${PANEL_ID} .pg-swatch-line { background: #3665f3; height: 3px; vertical-align: 2px; }
            #${PANEL_ID} .pg-swatch-bar { background: #d6dff9; }
            #${PANEL_ID} details.pg-section { margin-top: 14px; }
            #${PANEL_ID} details > summary { cursor: pointer; font-weight: 700; padding: 2px 0; }
            #${PANEL_ID} details.pg-grader { margin: 6px 0 0 4px; }
            #${PANEL_ID} details.pg-grader > summary { font-weight: 600; font-size: 12px; }
            #${PANEL_ID} .pg-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
            #${PANEL_ID} .pg-table th { text-align: left; color: #707070; font-weight: 400; font-size: 11px; border-bottom: 1px solid #e5e5e5; padding: 4px; }
            #${PANEL_ID} .pg-table td { padding: 5px 4px; border-bottom: 1px solid #f2f2f2; vertical-align: top; }
            #${PANEL_ID} .pg-num { text-align: right; }
            #${PANEL_ID} .pg-nowrap { white-space: nowrap; }
            #${PANEL_ID} tr.pg-current td { background: #eef4fd; font-weight: 600; }
            #${PANEL_ID} .pg-tag { background: #3665f3; color: #fff; border-radius: 8px; padding: 0 6px; font-size: 10px; font-weight: 600; margin-left: 4px; }
            #${PANEL_ID} .pg-sales .pg-title { max-width: 0; width: 100%; }
            #${PANEL_ID} .pg-sales .pg-title a, #${PANEL_ID} .pg-sales .pg-title > span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #191919; }
            #${PANEL_ID} .pg-sales .pg-title a:hover { text-decoration: underline; }
            #${PANEL_ID} .pg-error { color: #d0021b; }
        `;
        document.head.appendChild(style);
    }

    /**
     * Wait for an element matching one of the selectors to appear
     * @param {string[]} selectors
     * @param {number} timeout - ms
     * @returns {Promise<Element|null>}
     */
    function waitForElement(selectors, timeout) {
        const find = () => {
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el) return el;
            }
            return null;
        };

        return new Promise(resolve => {
            const existing = find();
            if (existing) return resolve(existing);

            const observer = new MutationObserver(() => {
                const el = find();
                if (el) {
                    observer.disconnect();
                    resolve(el);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                resolve(find());
            }, timeout);
        });
    }

    /**
     * Insert the panel container into the page
     * @returns {Promise<HTMLElement|null>}
     */
    async function insertContainer() {
        // Directly under the Price Guide / Grade / Pop row, falling back to under the price
        const anchor = await waitForElement([
            '[data-testid="x-psa-elevated-info"]',
            '.x-psa-elevated-info',
            '[data-testid="x-price-section"]',
            '.x-price-section'
        ], CONFIG.anchorTimeout);

        if (!anchor) {
            console.log('[PG Insights] Could not find a place to insert the panel');
            return null;
        }

        const container = document.createElement('div');
        container.id = PANEL_ID;
        container.innerHTML = '<div class="pg-muted">Loading Price Guide insights…</div>';
        anchor.insertAdjacentElement('afterend', container);
        return container;
    }

    /**
     * Wire up the panel's buttons
     * @param {HTMLElement} container
     */
    function bindEvents(container) {
        container.addEventListener('click', event => {
            const button = event.target.closest('[data-pg-action]');
            if (!button) return;

            const action = button.getAttribute('data-pg-action');

            if (action === 'toggle') {
                const body = container.querySelector('.pg-body');
                const nowHidden = !body.hidden;
                body.hidden = nowHidden;
                button.textContent = nowHidden ? 'Show' : 'Hide';
                button.setAttribute('aria-expanded', String(!nowHidden));
                try { localStorage.setItem(CONFIG.collapsedKey, nowHidden ? '1' : '0'); } catch (e) { /* storage unavailable */ }
            } else if (action === 'open-modal') {
                const seeInsights = [...document.querySelectorAll('.elevated-info button, button.fake-link')]
                    .find(b => /see insights/i.test(b.textContent));
                if (seeInsights) seeInsights.click();
            }
        });
    }

    /**
     * Main entry point
     */
    async function init() {
        const listingId = getListingId();
        if (!listingId) return;

        let listing;
        try {
            listing = await fetchMarketData(listingId);
        } catch (e) {
            console.log('[PG Insights] Failed to load market data:', e);
            return;
        }

        const html = buildPanel(listing);
        if (!html) {
            console.log('[PG Insights] No Price Guide data for this listing');
            return;
        }

        injectStyles();
        const container = await insertContainer();
        if (!container) return;

        container.innerHTML = html;
        bindEvents(container);
        console.log('[PG Insights] Panel rendered for listing', listingId);
    }

    init();
})();
