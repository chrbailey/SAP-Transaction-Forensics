/**
 * Transaction Forensics Pattern Viewer
 * Vanilla JavaScript single-page application
 */

class PatternViewer {
    constructor() {
        this.patterns = [];
        this.filteredPatterns = [];
        this.filters = {};
        this.metadata = {};
        this.selectedPatternId = null;
        this.expandedCards = new Set();

        // DOM elements
        this.patternList = document.getElementById('pattern-list');
        this.detailPanel = document.getElementById('detail-panel');
        this.detailTitle = document.getElementById('detail-title');
        this.detailContent = document.getElementById('detail-content');
        this.headerStats = document.getElementById('header-stats');

        // Filter elements
        this.searchInput = document.getElementById('search-input');
        this.confidenceFilter = document.getElementById('confidence-filter');
        this.salesOrgFilter = document.getElementById('sales-org-filter');
        this.industryFilter = document.getElementById('industry-filter');

        this.init();
    }

    async init() {
        try {
            await Promise.all([
                this.loadPatterns(),
                this.loadFilters()
            ]);
            this.applyFilters();
            this.render();
            this.bindEvents();
        } catch (error) {
            console.error('Initialization error:', error);
            this.showError('Failed to load pattern data');
        }
    }

    async loadPatterns() {
        const response = await fetch('/api/patterns');
        if (!response.ok) throw new Error('Failed to fetch patterns');
        const data = await response.json();
        this.patterns = data.patterns || [];
        this.metadata = data.metadata || {};
    }

    async loadFilters() {
        const response = await fetch('/api/filters');
        if (!response.ok) throw new Error('Failed to fetch filters');
        this.filters = await response.json();
        this.populateFilterDropdowns();
        this.renderStats();
    }

    populateFilterDropdowns() {
        // Populate sales org dropdown
        if (this.filters.sales_orgs) {
            this.filters.sales_orgs.forEach(org => {
                const option = document.createElement('option');
                option.value = org;
                option.textContent = `Sales Org ${org}`;
                this.salesOrgFilter.appendChild(option);
            });
        }

        // Populate industry dropdown (if available in data)
        // For now, we'll use plants as a proxy since industry isn't in the sample data
        if (this.filters.plants) {
            this.filters.plants.forEach(plant => {
                const option = document.createElement('option');
                option.value = plant;
                option.textContent = `Plant ${plant}`;
                this.industryFilter.appendChild(option);
            });
        }
    }

    renderStats() {
        const stats = this.filters.metadata || {};
        this.headerStats.innerHTML = `
            <div class="stat-item">
                <div class="stat-value">${this.patterns.length}</div>
                <div class="stat-label">Patterns</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${this.formatNumber(stats.document_count || 0)}</div>
                <div class="stat-label">Documents</div>
            </div>
            ${stats.date_range ? `
            <div class="stat-item">
                <div class="stat-value">${this.formatDateRange(stats.date_range)}</div>
                <div class="stat-label">Date Range</div>
            </div>
            ` : ''}
        `;
    }

    formatNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }

    formatDateRange(range) {
        if (!range.start || !range.end) return 'N/A';
        const start = new Date(range.start).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        const end = new Date(range.end).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        return `${start} - ${end}`;
    }

    applyFilters() {
        const searchTerm = this.searchInput.value.toLowerCase();
        const confidenceLevel = this.confidenceFilter.value;
        const salesOrg = this.salesOrgFilter.value;
        const industry = this.industryFilter.value;

        this.filteredPatterns = this.patterns.filter(pattern => {
            // Search filter
            if (searchTerm) {
                const searchableText = [
                    pattern.title,
                    pattern.description,
                    ...(pattern.top_phrases || [])
                ].join(' ').toLowerCase();
                if (!searchableText.includes(searchTerm)) return false;
            }

            // Confidence filter
            if (confidenceLevel) {
                const conf = pattern.confidence;
                if (confidenceLevel === 'high' && conf < 0.8) return false;
                if (confidenceLevel === 'medium' && (conf < 0.6 || conf >= 0.8)) return false;
                if (confidenceLevel === 'low' && conf >= 0.6) return false;
            }

            // Sales org filter
            if (salesOrg && pattern.filters?.sales_orgs) {
                if (!pattern.filters.sales_orgs.includes(salesOrg)) return false;
            }

            // Industry/Plant filter
            if (industry && pattern.filters?.plants) {
                if (!pattern.filters.plants.includes(industry)) return false;
            }

            return true;
        });
    }

    render() {
        this.patternList.innerHTML = '';

        if (this.filteredPatterns.length === 0) {
            this.patternList.innerHTML = `
                <div class="empty-state">
                    <p>No patterns match your filters.</p>
                    <p>Try adjusting your search criteria.</p>
                </div>
            `;
            return;
        }

        this.filteredPatterns.forEach(pattern => {
            const card = this.renderPatternCard(pattern);
            this.patternList.appendChild(card);
        });
    }

    // Get the primary lift value (highest multiplier from effect_sizes)
    getPrimaryLift(pattern) {
        if (!pattern.effect_sizes) return null;
        const effects = Object.values(pattern.effect_sizes);
        if (effects.length === 0) return null;
        return Math.max(...effects.map(e => e.multiplier || 1));
    }

    // Get timing statistics for display
    getTimingStats(pattern) {
        if (!pattern.effect_sizes) return null;
        // Look for time-related metrics
        const timeMetrics = ['processing_time', 'cycle_time', 'resolution_time',
                           'hold_duration', 'warehouse_delay', 'documentation_time',
                           'processing_delay'];
        for (const metric of timeMetrics) {
            if (pattern.effect_sizes[metric]) {
                return pattern.effect_sizes[metric];
            }
        }
        // Return first metric if no time metric found
        const firstKey = Object.keys(pattern.effect_sizes)[0];
        return firstKey ? pattern.effect_sizes[firstKey] : null;
    }

    renderPatternCard(pattern) {
        const card = document.createElement('div');
        card.className = 'pattern-card';
        card.dataset.patternId = pattern.id;

        if (pattern.id === this.selectedPatternId) {
            card.classList.add('selected');
        }

        const isExpanded = this.expandedCards.has(pattern.id);
        if (isExpanded) {
            card.classList.add('expanded');
        }

        const confidenceClass = this.getConfidenceClass(pattern.confidence);
        const confidenceLabel = this.getConfidenceLabel(pattern.confidence);
        const lift = this.getPrimaryLift(pattern);
        const timing = this.getTimingStats(pattern);
        const evidenceCount = pattern.evidence?.doc_keys?.length || pattern.sample_size || 0;

        // Calculate percentage of total
        const totalDocs = this.metadata.document_count || 10000;
        const percentage = ((pattern.sample_size / totalDocs) * 100).toFixed(1);

        card.innerHTML = `
            <div class="pattern-card-header">
                <span class="confidence-badge ${confidenceClass}">
                    ${confidenceLabel} CONFIDENCE
                </span>
                ${lift ? `<span class="lift-badge">Lift: ${lift.toFixed(1)}x</span>` : ''}
            </div>

            <h3 class="pattern-card-title">${this.escapeHtml(pattern.title)}</h3>

            <p class="pattern-card-description">${this.escapeHtml(pattern.description)}</p>

            <div class="phrase-section">
                <span class="phrase-label">Top Phrases:</span>
                <span class="phrase-list">${(pattern.top_phrases || []).map(
                    phrase => this.escapeHtml(phrase)
                ).join(', ')}</span>
            </div>

            ${timing ? `
            <div class="timing-stats">
                <span class="timing-baseline">Baseline: ${timing.baseline} ${timing.unit}</span>
                <span class="timing-arrow">-></span>
                <span class="timing-pattern">Pattern: ${timing.pattern} ${timing.unit}</span>
            </div>
            ` : ''}

            <div class="pattern-card-meta">
                <span class="meta-item">
                    <strong>Occurrences:</strong> ${pattern.sample_size.toLocaleString()} (${percentage}% of total)
                </span>
            </div>

            <div class="pattern-card-meta">
                <span class="meta-item">
                    <strong>Sales Orgs:</strong> ${(pattern.filters?.sales_orgs || []).map(
                        org => this.escapeHtml(org)
                    ).join(', ') || 'All'}
                </span>
            </div>

            <div class="card-actions">
                <button class="btn-view-evidence" data-pattern-id="${pattern.id}">View Evidence</button>
                <button class="btn-view-snippets" data-pattern-id="${pattern.id}">Sample Snippets</button>
            </div>

            <div class="card-expanded-content ${isExpanded ? 'visible' : ''}" id="expanded-${pattern.id}">
                <!-- Expanded content loaded on demand -->
            </div>
        `;

        // Bind click handler for the card (excluding buttons)
        card.addEventListener('click', (e) => {
            if (!e.target.closest('button')) {
                this.selectPattern(pattern.id);
            }
        });

        // Bind button handlers
        const viewEvidenceBtn = card.querySelector('.btn-view-evidence');
        const viewSnippetsBtn = card.querySelector('.btn-view-snippets');

        viewEvidenceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleEvidence(pattern.id);
        });

        viewSnippetsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showSnippets(pattern.id);
        });

        return card;
    }

    async toggleEvidence(patternId) {
        const expandedContent = document.getElementById(`expanded-${patternId}`);

        if (this.expandedCards.has(patternId)) {
            this.expandedCards.delete(patternId);
            expandedContent.classList.remove('visible');
            expandedContent.innerHTML = '';
        } else {
            this.expandedCards.add(patternId);
            expandedContent.classList.add('visible');
            expandedContent.innerHTML = '<div class="loading-small">Loading evidence...</div>';

            try {
                const response = await fetch(`/api/evidence/${patternId}`);
                if (!response.ok) throw new Error('Failed to fetch evidence');
                const data = await response.json();

                expandedContent.innerHTML = `
                    <div class="evidence-section">
                        <h4>Evidence (${data.evidence_count} documents)</h4>
                        <div class="doc-keys">
                            ${(data.evidence?.doc_keys || []).map(key =>
                                `<span class="doc-key">${this.escapeHtml(key)}</span>`
                            ).join('')}
                        </div>
                    </div>
                `;
            } catch (error) {
                expandedContent.innerHTML = '<div class="error-small">Failed to load evidence</div>';
            }
        }
    }

    async showSnippets(patternId) {
        try {
            const response = await fetch(`/api/patterns/${patternId}`);
            if (!response.ok) throw new Error('Failed to fetch pattern');
            const pattern = await response.json();

            if (pattern.evidence?.sample_snippets?.length > 0) {
                this.showSnippetModal(pattern);
            } else {
                this.showToast('No sample snippets available', 'info');
            }
        } catch (error) {
            this.showToast('Failed to load snippets', 'error');
        }
    }

    showSnippetModal(pattern) {
        // Remove existing modal if any
        const existingModal = document.querySelector('.snippet-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.className = 'snippet-modal';
        modal.innerHTML = `
            <div class="snippet-modal-content">
                <div class="snippet-modal-header">
                    <h3>Sample Snippets - ${this.escapeHtml(pattern.title)}</h3>
                    <button class="btn-close-modal">&times;</button>
                </div>
                <div class="snippet-modal-body">
                    <p class="snippet-notice">All snippets are redacted for privacy.</p>
                    ${pattern.evidence.sample_snippets.map(snippet => `
                        <div class="snippet-item">
                            <code>${this.escapeHtml(snippet)}</code>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close handlers
        modal.querySelector('.btn-close-modal').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    getConfidenceClass(confidence) {
        if (confidence >= 0.8) return 'confidence-high';
        if (confidence >= 0.6) return 'confidence-medium';
        return 'confidence-low';
    }

    getConfidenceLabel(confidence) {
        if (confidence >= 0.8) return 'HIGH';
        if (confidence >= 0.6) return 'MEDIUM';
        return 'LOW';
    }

    async selectPattern(patternId) {
        this.selectedPatternId = patternId;

        // Update card selection
        document.querySelectorAll('.pattern-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.patternId === patternId);
        });

        // Fetch full pattern details
        try {
            const response = await fetch(`/api/patterns/${patternId}`);
            if (!response.ok) throw new Error('Failed to fetch pattern details');
            const pattern = await response.json();
            this.renderDetailPanel(pattern);
            this.detailPanel.classList.remove('hidden');
        } catch (error) {
            console.error('Error loading pattern details:', error);
            this.showToast('Failed to load pattern details', 'error');
        }
    }

    renderDetailPanel(pattern) {
        this.detailTitle.textContent = pattern.title;

        const confidenceClass = this.getConfidenceClass(pattern.confidence);
        const lift = this.getPrimaryLift(pattern);
        const evidenceCount = pattern.evidence?.doc_keys?.length || 0;

        let html = `
            <div class="detail-section">
                <div class="detail-metrics">
                    <span class="confidence-badge ${confidenceClass}">
                        ${this.getConfidenceLabel(pattern.confidence)} CONFIDENCE (${Math.round(pattern.confidence * 100)}%)
                    </span>
                    ${lift ? `<span class="lift-badge">Lift: ${lift.toFixed(1)}x</span>` : ''}
                </div>
                <p class="detail-sample-size">Based on ${pattern.sample_size.toLocaleString()} samples</p>
            </div>

            <div class="detail-section">
                <div class="detail-section-title">Description</div>
                <p class="detail-description">${this.escapeHtml(pattern.description)}</p>
            </div>
        `;

        // Caveats section (prominently displayed)
        if (pattern.caveats && pattern.caveats.length > 0) {
            html += `
                <div class="detail-section">
                    <div class="detail-section-title">Caveats</div>
                    <ul class="caveat-list">
                        ${pattern.caveats.map(caveat =>
                            `<li class="caveat-item">${this.escapeHtml(caveat)}</li>`
                        ).join('')}
                    </ul>
                </div>
            `;
        }

        // Effect sizes table with timing statistics
        if (pattern.effect_sizes && Object.keys(pattern.effect_sizes).length > 0) {
            html += `
                <div class="detail-section">
                    <div class="detail-section-title">Effect Sizes (Timing Statistics)</div>
                    <table class="effect-table">
                        <thead>
                            <tr>
                                <th>Metric</th>
                                <th>Baseline</th>
                                <th>Pattern Value</th>
                                <th>Change</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.entries(pattern.effect_sizes).map(([key, value]) => `
                                <tr>
                                    <td>${this.formatMetricName(key)}</td>
                                    <td>${value.baseline} ${value.unit}</td>
                                    <td>${value.pattern} ${value.unit}</td>
                                    <td class="multiplier">${value.multiplier}x</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        // Key phrases
        if (pattern.top_phrases && pattern.top_phrases.length > 0) {
            html += `
                <div class="detail-section">
                    <div class="detail-section-title">Key Phrases</div>
                    <div class="phrase-tags">
                        ${pattern.top_phrases.map(phrase =>
                            `<span class="phrase-tag">${this.escapeHtml(phrase)}</span>`
                        ).join('')}
                    </div>
                </div>
            `;
        }

        // Evidence section
        if (pattern.evidence) {
            html += `<div class="detail-section">
                <div class="detail-section-title">Evidence (${evidenceCount} documents)</div>
            `;

            if (pattern.evidence.doc_keys && pattern.evidence.doc_keys.length > 0) {
                html += `
                    <div class="doc-keys">
                        ${pattern.evidence.doc_keys.slice(0, 5).map(key =>
                            `<span class="doc-key">${this.escapeHtml(key)}</span>`
                        ).join('')}
                        ${pattern.evidence.doc_keys.length > 5 ?
                            `<span class="doc-key">+${pattern.evidence.doc_keys.length - 5} more</span>` : ''}
                    </div>
                `;
            }

            if (pattern.evidence.sample_snippets && pattern.evidence.sample_snippets.length > 0) {
                html += `
                    <p style="margin: 1rem 0 0.5rem; font-size: 0.85rem; color: var(--color-text-light);">
                        Sample Snippets (Redacted)
                    </p>
                    <ul class="evidence-list">
                        ${pattern.evidence.sample_snippets.map(snippet =>
                            `<li class="evidence-snippet">${this.escapeHtml(snippet)}</li>`
                        ).join('')}
                    </ul>
                `;
            }

            html += `</div>`;
        }

        // Filter info
        if (pattern.filters) {
            html += `
                <div class="detail-section">
                    <div class="detail-section-title">Applicable Filters</div>
                    <p style="font-size: 0.9rem;">
                        ${pattern.filters.sales_orgs ?
                            `<strong>Sales Orgs:</strong> ${pattern.filters.sales_orgs.map(
                                org => this.escapeHtml(org)
                            ).join(', ')}<br>` : ''}
                        ${pattern.filters.plants ?
                            `<strong>Plants:</strong> ${pattern.filters.plants.map(
                                plant => this.escapeHtml(plant)
                            ).join(', ')}` : ''}
                    </p>
                </div>
            `;
        }

        // Actions
        html += `
            <div class="detail-actions">
                <button class="btn-secondary" id="copy-pattern">Copy to Clipboard</button>
                <button class="btn-secondary" id="export-pattern">Export Pattern</button>
            </div>
        `;

        this.detailContent.innerHTML = html;

        // Bind action buttons
        document.getElementById('copy-pattern').addEventListener('click', () => this.copyPattern(pattern));
        document.getElementById('export-pattern').addEventListener('click', () => this.exportPattern(pattern));
    }

    formatMetricName(key) {
        return key
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    closeDetailPanel() {
        this.detailPanel.classList.add('hidden');
        this.selectedPatternId = null;
        document.querySelectorAll('.pattern-card.selected').forEach(card => {
            card.classList.remove('selected');
        });
    }

    copyPattern(pattern) {
        const text = this.formatPatternAsText(pattern);
        navigator.clipboard.writeText(text)
            .then(() => this.showToast('Pattern copied to clipboard', 'success'))
            .catch(() => this.showToast('Failed to copy', 'error'));
    }

    formatPatternAsText(pattern) {
        let text = `# ${pattern.title}\n\n`;
        text += `**ID:** ${pattern.id}\n`;
        text += `**Confidence:** ${Math.round(pattern.confidence * 100)}%\n`;
        text += `**Sample Size:** ${pattern.sample_size.toLocaleString()}\n`;

        const lift = this.getPrimaryLift(pattern);
        if (lift) {
            text += `**Lift:** ${lift.toFixed(1)}x\n`;
        }
        text += '\n';

        text += `## Description\n${pattern.description}\n\n`;

        if (pattern.top_phrases?.length) {
            text += `## Key Phrases\n`;
            pattern.top_phrases.forEach(phrase => {
                text += `- \`${phrase}\`\n`;
            });
            text += '\n';
        }

        if (pattern.caveats?.length) {
            text += `## Caveats\n`;
            pattern.caveats.forEach(caveat => {
                text += `- ${caveat}\n`;
            });
            text += '\n';
        }

        if (pattern.effect_sizes) {
            text += `## Timing Statistics\n`;
            Object.entries(pattern.effect_sizes).forEach(([key, value]) => {
                text += `- ${this.formatMetricName(key)}: ${value.baseline} -> ${value.pattern} ${value.unit} (${value.multiplier}x)\n`;
            });
        }

        return text;
    }

    exportPattern(pattern) {
        const blob = new Blob([JSON.stringify(pattern, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${pattern.id}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showToast('Pattern exported', 'success');
    }

    bindEvents() {
        // Filter events
        this.searchInput.addEventListener('input', this.debounce(() => {
            this.applyFilters();
            this.render();
        }, 300));

        this.confidenceFilter.addEventListener('change', () => {
            this.applyFilters();
            this.render();
        });

        this.salesOrgFilter.addEventListener('change', () => {
            this.applyFilters();
            this.render();
        });

        this.industryFilter.addEventListener('change', () => {
            this.applyFilters();
            this.render();
        });

        // Clear filters
        document.getElementById('clear-filters').addEventListener('click', () => {
            this.searchInput.value = '';
            this.confidenceFilter.value = '';
            this.salesOrgFilter.value = '';
            this.industryFilter.value = '';
            this.applyFilters();
            this.render();
        });

        // Export buttons
        document.getElementById('export-json').addEventListener('click', () => {
            window.location.href = '/api/export/json';
        });

        document.getElementById('export-markdown').addEventListener('click', () => {
            window.location.href = '/api/export/markdown';
        });

        // Close detail panel
        document.getElementById('close-detail').addEventListener('click', () => {
            this.closeDetailPanel();
        });

        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (!this.detailPanel.classList.contains('hidden')) {
                    this.closeDetailPanel();
                }
                // Also close any snippet modal
                const modal = document.querySelector('.snippet-modal');
                if (modal) modal.remove();
            }
        });
    }

    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    showError(message) {
        this.patternList.innerHTML = `
            <div class="empty-state">
                <p style="color: var(--color-confidence-low);">${this.escapeHtml(message)}</p>
                <p>Please check the console for more details.</p>
            </div>
        `;
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new PatternViewer();
});
