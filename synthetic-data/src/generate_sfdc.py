#!/usr/bin/env python3
"""
Salesforce (SFDC) Synthetic Data Generator

Generates realistic Salesforce Opportunity lifecycle data with 10 planted
anomaly patterns for use in SAP Transaction Forensics cross-system analysis.

Generates:
- Accounts, Users, Products
- Opportunities (with full stage histories, line items, activities)
- SAP Orders and Document Flows (for SAP-linked opportunities)

Planted anomaly patterns:
1.  STAGE_SKIP           — missing intermediate stages in history
2.  QUARTER_END          — close dates cluster at quarter-end
3.  GHOST_PIPELINE       — late-stage opps with no activities
4.  STAGE_REGRESSION     — backward stage moves in history
5.  AMOUNT_INFLATION     — >50% amount increase in final stage
6.  SPLIT_DEAL           — duplicate opp on same account within 7 days
7.  SPEED_ANOMALY        — closed within 3 days of creation
8.  STALE_PIPELINE       — open opp created >90 days ago with no movement
9.  OWNER_SWAP           — owner changed in final stage
10. CROSS_SYSTEM_GAP     — >30 day gap between SFDC close and SAP erdat

Usage:
    python3 src/generate_sfdc.py --count 200 --accounts 50 --output sfdc_output/ --seed 42
"""

from __future__ import annotations

import argparse
import json
import math
import random
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

# =============================================================================
# PATTERN CONSTANTS
# =============================================================================

PATTERN_STAGE_SKIP = 'STAGE_SKIP'
PATTERN_QUARTER_END = 'QUARTER_END_COMPRESSION'
PATTERN_GHOST_PIPELINE = 'GHOST_PIPELINE'
PATTERN_STAGE_REGRESSION = 'STAGE_REGRESSION'
PATTERN_AMOUNT_INFLATION = 'AMOUNT_INFLATION'
PATTERN_SPLIT_DEAL = 'SPLIT_DEAL'
PATTERN_SPEED_ANOMALY = 'SPEED_ANOMALY'
PATTERN_STALE_PIPELINE = 'STALE_PIPELINE'
PATTERN_OWNER_SWAP = 'OWNER_SWAP_AT_CLOSE'
PATTERN_CROSS_SYSTEM_GAP = 'CROSS_SYSTEM_GAP'

# =============================================================================
# PIPELINE DEFINITIONS  (must match TypeScript adapter)
# =============================================================================

PIPELINE_NEW_BUSINESS = [
    'Prospecting',
    'Qualification',
    'Needs Analysis',
    'Value Proposition',
    'Id. Decision Makers',
    'Perception Analysis',
    'Proposal/Price Quote',
    'Negotiation/Review',
]

PIPELINE_RENEWAL = [
    'Qualification',
    'Proposal',
]

PIPELINE_UPSELL = [
    'Discovery',
    'Proposal',
    'Negotiation',
]

PIPELINE_TYPES = {
    'New Business': PIPELINE_NEW_BUSINESS,
    'Renewal': PIPELINE_RENEWAL,
    'Upsell': PIPELINE_UPSELL,
}

CLOSED_WON = 'Closed Won'
CLOSED_LOST = 'Closed Lost'
CLOSED_STAGES = {CLOSED_WON, CLOSED_LOST}

# =============================================================================
# REFERENCE DATA
# =============================================================================

INDUSTRY_LIST = [
    'Technology', 'Financial Services', 'Healthcare', 'Manufacturing',
    'Retail', 'Energy', 'Telecommunications', 'Education',
    'Government', 'Professional Services',
]

ACCOUNT_NAMES_PREFIXES = [
    'Apex', 'Atlas', 'Axis', 'Blue', 'Cardinal', 'Cascade', 'Cedar',
    'Centric', 'Century', 'Clarity', 'Cobalt', 'Core', 'Crown', 'Delta',
    'Dynamic', 'Eagle', 'Ember', 'Envoy', 'Epoch', 'Equinox', 'Evolve',
    'Falcon', 'Frontier', 'Fusion', 'Global', 'Granite', 'Harbor',
    'Helix', 'Horizon', 'Hydra', 'Ignite', 'Impact', 'Infra', 'Inland',
    'Ionic', 'Iris', 'Ironclad', 'Keystone', 'Kinetic', 'Lattice',
    'Legacy', 'Lumina', 'Lynx', 'Magellan', 'Matrix', 'Meridian',
    'Metro', 'Momentum', 'Nexus', 'Noble', 'Nordic', 'Nova', 'Omega',
    'Onyx', 'Orbit', 'Pacific', 'Panther', 'Peak', 'Pinnacle', 'Pivot',
    'Prism', 'Proton', 'Pulse', 'Quantum', 'Quest', 'Radius', 'Raven',
    'Ridge', 'Rocket', 'Sapphire', 'Sentinel', 'Sigma', 'Signal',
    'Solar', 'Solstice', 'Sonar', 'Spark', 'Spectrum', 'Sterling',
    'Summit', 'Surge', 'Synapse', 'Sync', 'Tangent', 'Talon', 'Titan',
    'Torque', 'Trace', 'Trident', 'Trinity', 'Tungsten', 'Unified',
    'Uplift', 'Valor', 'Vantage', 'Vector', 'Vertex', 'Vista', 'Volt',
    'Vortex', 'Zenith', 'Zephyr', 'Zero',
]

ACCOUNT_SUFFIXES = [
    'Corp', 'Inc', 'LLC', 'Group', 'Technologies', 'Solutions',
    'Systems', 'Partners', 'Ventures', 'Holdings', 'Enterprises',
    'Consulting', 'Services', 'Industries',
]

PRODUCT_NAMES = [
    'Enterprise Suite', 'Analytics Pro', 'Cloud Connect', 'DataSync',
    'AutoFlow', 'SecureVault', 'InsightEngine', 'OmniTrack',
    'TeamBridge', 'CoreAPI', 'SmartReport', 'RiskGuard',
    'DevOps Hub', 'ComplianceKit', 'NexusCRM',
]

FIRST_NAMES = [
    'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael',
    'Linda', 'William', 'Barbara', 'David', 'Susan', 'Richard', 'Jessica',
    'Joseph', 'Sarah', 'Thomas', 'Karen', 'Charles', 'Lisa', 'Christopher',
    'Nancy', 'Daniel', 'Betty', 'Matthew', 'Margaret', 'Anthony', 'Sandra',
    'Mark', 'Ashley', 'Donald', 'Dorothy', 'Steven', 'Kimberly', 'Paul',
    'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle', 'Kenneth', 'Carol',
    'Kevin', 'Amanda', 'Brian', 'Melissa', 'George', 'Deborah', 'Timothy',
    'Stephanie',
]

LAST_NAMES = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
    'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
    'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
    'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark',
    'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King',
    'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green',
    'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
    'Carter', 'Roberts',
]

ACTIVITY_TYPES = ['Call', 'Email', 'Meeting', 'Task', 'Demo']

ACTIVITY_SUBJECTS = {
    'Call': [
        'Discovery call', 'Follow-up call', 'Qualification call',
        'Executive briefing call', 'Check-in call', 'Pricing discussion',
    ],
    'Email': [
        'Sent proposal', 'Follow-up on proposal', 'Introduction email',
        'Meeting recap', 'Next steps', 'Contract sent',
    ],
    'Meeting': [
        'Demo meeting', 'Stakeholder meeting', 'QBR', 'Contract review',
        'Executive sponsor meeting', 'Kickoff meeting',
    ],
    'Task': [
        'Prepare proposal', 'Update CRM', 'Send contract', 'Legal review',
        'Security questionnaire', 'Procurement review',
    ],
    'Demo': [
        'Product demo', 'Technical demo', 'Executive demo',
        'POC review', 'Custom demo',
    ],
}

SAP_ORDER_TYPES = ['ZOR', 'TA', 'OR', 'ZRE']
SAP_SALES_ORGS = ['1000', '1010', '2000', '3000']
SAP_DIST_CHANNELS = ['10', '20', '30']
SAP_DIVISIONS = ['00', '01', '10']

# =============================================================================
# CONFIG DATACLASS
# =============================================================================


@dataclass
class SFDCGeneratorConfig:
    n_accounts: int = 50
    n_opportunities: int = 200
    n_users: int = 20
    n_products: int = 15
    sap_link_rate: float = 0.60
    date_range_start: str = '2024-01-01'
    date_range_end: str = '2025-12-31'
    win_rate: float = 0.35
    seed: int = 42


# =============================================================================
# HELPERS
# =============================================================================

def _fmt_date(dt: datetime) -> str:
    return dt.strftime('%Y-%m-%d')


def _fmt_ts(dt: datetime) -> str:
    return dt.strftime('%Y-%m-%dT%H:%M:%SZ')


def _parse_date(s: str) -> datetime:
    return datetime.strptime(s, '%Y-%m-%d')


def _quarter_end(dt: datetime) -> datetime:
    """Return the last day of the quarter containing dt."""
    quarter = (dt.month - 1) // 3
    quarter_end_month = (quarter + 1) * 3
    if quarter_end_month == 3:
        return datetime(dt.year, 3, 31)
    elif quarter_end_month == 6:
        return datetime(dt.year, 6, 30)
    elif quarter_end_month == 9:
        return datetime(dt.year, 9, 30)
    else:
        return datetime(dt.year, 12, 31)


def _add_days(dt: datetime, n: int) -> datetime:
    return dt + timedelta(days=n)


# =============================================================================
# GENERATOR CLASS
# =============================================================================


class SFDCGenerator:
    """Generates synthetic Salesforce Opportunity lifecycle data."""

    def __init__(self, config: SFDCGeneratorConfig) -> None:
        self.config = config
        self.rng = random.Random(config.seed)
        self._date_start = _parse_date(config.date_range_start)
        self._date_end = _parse_date(config.date_range_end)
        self._date_span = (self._date_end - self._date_start).days

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate(self) -> Dict[str, Any]:
        accounts = self._gen_accounts()
        users = self._gen_users()
        products = self._gen_products()
        opportunities, stage_histories, line_items, activities = (
            self._gen_opportunities(accounts, users, products)
        )
        self._apply_patterns(opportunities, stage_histories, activities, accounts, users)
        sap_orders, sap_doc_flows = self._gen_sap_data(opportunities)
        self._apply_cross_system_gap(opportunities, sap_orders)

        return {
            'accounts': accounts,
            'users': users,
            'products': products,
            'opportunities': opportunities,
            'stage_histories': stage_histories,
            'line_items': line_items,
            'activities': activities,
            'sap_orders': sap_orders,
            'sap_doc_flows': sap_doc_flows,
        }

    def write_output(self, data: Dict[str, Any], output_dir: str) -> None:
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)

        # Always-written files
        always = [
            'accounts', 'users', 'products',
            'opportunities', 'stage_histories',
            'line_items', 'activities',
        ]
        for key in always:
            path = out / f'{key}.json'
            path.write_text(json.dumps(data[key], indent=2), encoding='utf-8')

        # SAP files only when there are linked records
        if data.get('sap_orders'):
            (out / 'sap_orders.json').write_text(
                json.dumps(data['sap_orders'], indent=2), encoding='utf-8'
            )
        if data.get('sap_doc_flows'):
            (out / 'sap_doc_flows.json').write_text(
                json.dumps(data['sap_doc_flows'], indent=2), encoding='utf-8'
            )

    # ------------------------------------------------------------------
    # Entity generators
    # ------------------------------------------------------------------

    def _gen_accounts(self) -> List[Dict[str, Any]]:
        accounts = []
        used_names: set = set()
        for i in range(self.config.n_accounts):
            name = self._unique_account_name(used_names)
            used_names.add(name)
            accounts.append({
                'id': f'001{str(i+1).zfill(15)}',
                'name': name,
                'industry': self.rng.choice(INDUSTRY_LIST),
                'annual_revenue': self.rng.randint(1, 500) * 1_000_000,
                'employee_count': self.rng.choice([50, 100, 250, 500, 1000, 5000, 10000]),
                'billing_country': self.rng.choice(['US', 'US', 'US', 'CA', 'GB', 'DE', 'FR', 'AU']),
                'created_date': _fmt_date(self._random_date_before(self._date_start, 730)),
            })
        return accounts

    def _gen_users(self) -> List[Dict[str, Any]]:
        users = []
        used_names: set = set()
        roles = ['AE', 'AE', 'AE', 'SE', 'SDR', 'Manager', 'Director']
        for i in range(self.config.n_users):
            fn = self.rng.choice(FIRST_NAMES)
            ln = self.rng.choice(LAST_NAMES)
            # make unique
            key = f'{fn}{ln}'
            if key in used_names:
                ln = ln + str(i)
            used_names.add(key)
            users.append({
                'id': f'005{str(i+1).zfill(15)}',
                'name': f'{fn} {ln}',
                'email': f'{fn.lower()}.{ln.lower()}@example.com',
                'role': self.rng.choice(roles),
                'is_active': True,
            })
        return users

    def _gen_products(self) -> List[Dict[str, Any]]:
        products = []
        names = PRODUCT_NAMES[:self.config.n_products]
        for i, name in enumerate(names):
            products.append({
                'id': f'01t{str(i+1).zfill(15)}',
                'name': name,
                'product_code': f'PRD-{str(i+1).zfill(4)}',
                'list_price': self.rng.choice([5000, 10000, 15000, 25000, 50000, 75000, 100000]),
                'family': self.rng.choice(['Platform', 'Add-On', 'Professional Services', 'Support']),
                'is_active': True,
            })
        return products

    def _gen_opportunities(
        self,
        accounts: List[Dict[str, Any]],
        users: List[Dict[str, Any]],
        products: List[Dict[str, Any]],
    ) -> tuple:
        opportunities: List[Dict[str, Any]] = []
        stage_histories: List[Dict[str, Any]] = []
        line_items: List[Dict[str, Any]] = []
        activities: List[Dict[str, Any]] = []

        for i in range(self.config.n_opportunities):
            opp_id = f'006{str(i+1).zfill(15)}'
            account = self.rng.choice(accounts)
            owner = self.rng.choice(users)
            opp_type = self.rng.choices(
                list(PIPELINE_TYPES.keys()),
                weights=[0.65, 0.25, 0.10],
                k=1,
            )[0]
            pipeline = PIPELINE_TYPES[opp_type]

            created = self._random_date(self._date_start, self._date_end - timedelta(days=30))

            # Determine outcome
            is_closed = self.rng.random() < 0.55
            is_won = is_closed and (self.rng.random() < self.config.win_rate / 0.55)

            if is_closed:
                stage = CLOSED_WON if is_won else CLOSED_LOST
                max_days_to_close = min(120, (self._date_end - created).days)
                days_to_close = self.rng.randint(14, max(15, max_days_to_close))
                close_date = _add_days(created, days_to_close)
                if close_date > self._date_end:
                    close_date = self._date_end
                probability = 100 if is_won else 0
            else:
                stage = self.rng.choice(pipeline[-3:])  # late stage for open
                close_date = _add_days(created, self.rng.randint(30, 180))
                probability = self.rng.randint(20, 80)

            base_amount = self.rng.randint(10, 500) * 1000
            amount = base_amount

            is_sap_linked = self.rng.random() < self.config.sap_link_rate and is_won

            opp: Dict[str, Any] = {
                'id': opp_id,
                'name': f'{account["name"]} — {opp_type} {self.rng.randint(100, 999)}',
                'account_id': account['id'],
                'owner_id': owner['id'],
                'type': opp_type,
                'stage_name': stage,
                'amount': amount,
                'close_date': _fmt_date(close_date),
                'created_date': _fmt_date(created),
                'probability': probability,
                'is_closed': is_closed,
                'is_won': is_won,
                'is_sap_linked': is_sap_linked,
                'sap_order_id': None,
                '_pattern_flags': [],
            }
            opportunities.append(opp)

            # Stage history
            histories = self._build_stage_history(opp_id, pipeline, stage, created, close_date, is_closed, owner)
            stage_histories.extend(histories)

            # Line items
            n_products = self.rng.randint(1, 4)
            selected = self.rng.sample(products, min(n_products, len(products)))
            for j, prod in enumerate(selected):
                qty = self.rng.randint(1, 10)
                unit_price = prod['list_price'] * self.rng.uniform(0.8, 1.2)
                line_items.append({
                    'id': f'00k{str(i * 10 + j + 1).zfill(15)}',
                    'opportunity_id': opp_id,
                    'product_id': prod['id'],
                    'product_name': prod['name'],
                    'quantity': qty,
                    'unit_price': round(unit_price, 2),
                    'total_price': round(unit_price * qty, 2),
                    'list_price': prod['list_price'],
                })

            # Activities
            n_activities = self.rng.randint(2, 8) if not is_closed else self.rng.randint(3, 12)
            for k in range(n_activities):
                atype = self.rng.choice(ACTIVITY_TYPES)
                act_date = _add_days(created, self.rng.randint(0, max(1, days_to_close if is_closed else 60)))
                activities.append({
                    'id': f'00T{str(i * 20 + k + 1).zfill(15)}',
                    'opportunity_id': opp_id,
                    'owner_id': owner['id'],
                    'type': atype,
                    'subject': self.rng.choice(ACTIVITY_SUBJECTS[atype]),
                    'activity_date': _fmt_date(act_date),
                    'status': 'Completed',
                })

        return opportunities, stage_histories, line_items, activities

    def _build_stage_history(
        self,
        opp_id: str,
        pipeline: List[str],
        final_stage: str,
        created: datetime,
        close_date: datetime,
        is_closed: bool,
        owner: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        histories = []
        span = max(1, (close_date - created).days)

        # Determine how many pipeline stages were reached
        if is_closed:
            stages_traversed = list(pipeline)
        else:
            n = self.rng.randint(max(1, len(pipeline) // 2), len(pipeline))
            stages_traversed = pipeline[:n]

        # Spread stage transitions across the date span
        n_stages = len(stages_traversed)
        for idx, stage in enumerate(stages_traversed):
            if n_stages == 1:
                days_offset = 0
            else:
                days_offset = int((idx / (n_stages - 1)) * span * self.rng.uniform(0.7, 1.0))
            stage_date = _add_days(created, days_offset)

            histories.append({
                'id': f'0Sh{opp_id[3:]}_{str(idx).zfill(3)}',
                'opportunity_id': opp_id,
                'stage_name': stage,
                'created_date': _fmt_ts(stage_date),
                'owner_id': owner['id'],
                'amount': None,  # patched by AMOUNT_INFLATION if needed
            })

        # Add closed stage entry if closed
        if is_closed:
            histories.append({
                'id': f'0Sh{opp_id[3:]}_{str(len(stages_traversed)).zfill(3)}',
                'opportunity_id': opp_id,
                'stage_name': final_stage,
                'created_date': _fmt_ts(close_date),
                'owner_id': owner['id'],
                'amount': None,
            })

        return histories

    def _gen_sap_data(
        self, opportunities: List[Dict[str, Any]]
    ) -> tuple:
        sap_orders: List[Dict[str, Any]] = []
        sap_doc_flows: List[Dict[str, Any]] = []

        linked_opps = [o for o in opportunities if o['is_sap_linked']]

        for opp in linked_opps:
            order_id = f'SAP{self.rng.randint(1000000, 9999999)}'
            opp['sap_order_id'] = order_id

            close_dt = _parse_date(opp['close_date'])
            erdat_offset = self.rng.randint(1, 10)
            erdat = _add_days(close_dt, erdat_offset)

            order = {
                'vbeln': order_id,
                'sfdc_opportunity_id': opp['id'],
                'erdat': _fmt_date(erdat),
                'audat': _fmt_date(erdat),
                'auart': self.rng.choice(SAP_ORDER_TYPES),
                'vkorg': self.rng.choice(SAP_SALES_ORGS),
                'vtweg': self.rng.choice(SAP_DIST_CHANNELS),
                'spart': self.rng.choice(SAP_DIVISIONS),
                'netwr': opp['amount'],
                'waerk': 'USD',
                'kunnr': opp['account_id'],
                '_pattern_flags': [],
            }
            sap_orders.append(order)

            # Doc flow: order → delivery → invoice
            for doc_type, doc_prefix, days_after in [('J', 'DEL', 2), ('M', 'INV', 5)]:
                sap_doc_flows.append({
                    'id': f'DF{order_id}{doc_type}',
                    'vbelv': order_id,
                    'posnv': '000010',
                    'vbeln': f'{doc_prefix}{self.rng.randint(100000, 999999)}',
                    'posnn': '000010',
                    'vbtyp_n': doc_type,
                    'erdat': _fmt_date(_add_days(erdat, days_after)),
                    'rfmng': 1,
                })

        return sap_orders, sap_doc_flows

    # ------------------------------------------------------------------
    # Pattern application
    # ------------------------------------------------------------------

    def _apply_patterns(
        self,
        opportunities: List[Dict[str, Any]],
        stage_histories: List[Dict[str, Any]],
        activities: List[Dict[str, Any]],
        accounts: List[Dict[str, Any]],
        users: List[Dict[str, Any]],
    ) -> None:
        # Build lookup maps
        opp_by_id: Dict[str, Dict[str, Any]] = {o['id']: o for o in opportunities}
        hist_by_opp: Dict[str, List[Dict[str, Any]]] = {}
        for h in stage_histories:
            hist_by_opp.setdefault(h['opportunity_id'], []).append(h)
        act_by_opp: Dict[str, List[Dict[str, Any]]] = {}
        for a in activities:
            act_by_opp.setdefault(a['opportunity_id'], []).append(a)

        closed_won = [o for o in opportunities if o['is_won']]
        open_opps = [o for o in opportunities if not o['is_closed']]
        late_stage_open = [
            o for o in open_opps
            if o['stage_name'] in ('Negotiation/Review', 'Proposal/Price Quote',
                                   'Proposal', 'Negotiation', 'Perception Analysis')
        ]

        # 1. STAGE_SKIP: 5% of all opps
        for opp in opportunities:
            if self.rng.random() < 0.05:
                histories = hist_by_opp.get(opp['id'], [])
                inner = [h for h in histories if h['stage_name'] not in CLOSED_STAGES]
                if len(inner) > 3:
                    n_remove = self.rng.randint(1, 2)
                    # Remove 1-2 intermediate stages (not first, not last)
                    removable = inner[1:-1]
                    to_remove = self.rng.sample(removable, min(n_remove, len(removable)))
                    for h in to_remove:
                        stage_histories.remove(h)
                        hist_by_opp[opp['id']].remove(h)
                    opp['_pattern_flags'].append(PATTERN_STAGE_SKIP)

        # 2. QUARTER_END: 40% of closed won
        for opp in closed_won:
            if self.rng.random() < 0.40:
                close_dt = _parse_date(opp['close_date'])
                qend = _quarter_end(close_dt)
                # Move to last 5 days of quarter
                days_back = self.rng.randint(0, 4)
                new_close = _add_days(qend, -days_back)
                opp['close_date'] = _fmt_date(new_close)
                opp['_pattern_flags'].append(PATTERN_QUARTER_END)

        # 3. GHOST_PIPELINE: 10% of late-stage open opps — remove all activities
        for opp in late_stage_open:
            if self.rng.random() < 0.10:
                opp_acts = act_by_opp.get(opp['id'], [])
                for a in opp_acts:
                    activities.remove(a)
                act_by_opp[opp['id']] = []
                opp['_pattern_flags'].append(PATTERN_GHOST_PIPELINE)

        # 4. STAGE_REGRESSION: 3% of all opps — insert backward stage move
        for opp in opportunities:
            if self.rng.random() < 0.03:
                histories = hist_by_opp.get(opp['id'], [])
                pipeline = PIPELINE_TYPES.get(opp['type'], PIPELINE_NEW_BUSINESS)
                if len(histories) >= 2:
                    # Insert a stage that is earlier in the pipeline after a later one
                    inner = [h for h in histories if h['stage_name'] in pipeline]
                    if len(inner) >= 2:
                        last = inner[-1]
                        last_idx = pipeline.index(last['stage_name']) if last['stage_name'] in pipeline else -1
                        if last_idx > 0:
                            regression_stage = pipeline[last_idx - 1]
                            # Insert after the last history entry timestamp
                            last_dt = datetime.strptime(last['created_date'], '%Y-%m-%dT%H:%M:%SZ')
                            regression_dt = _add_days(last_dt, self.rng.randint(1, 5))
                            regression_entry = {
                                'id': f'0Sh{opp["id"][3:]}_R{str(self.rng.randint(100, 999))}',
                                'opportunity_id': opp['id'],
                                'stage_name': regression_stage,
                                'created_date': _fmt_ts(regression_dt),
                                'owner_id': opp['owner_id'],
                                'amount': None,
                            }
                            stage_histories.append(regression_entry)
                            hist_by_opp[opp['id']].append(regression_entry)
                            opp['_pattern_flags'].append(PATTERN_STAGE_REGRESSION)

        # 5. AMOUNT_INFLATION: 8% — increase amount >50% in final stage
        for opp in opportunities:
            if self.rng.random() < 0.08:
                inflation = self.rng.uniform(0.55, 2.5)
                new_amount = math.ceil(opp['amount'] * (1 + inflation) / 1000) * 1000
                opp['amount'] = new_amount
                # Also update last history entry
                histories = hist_by_opp.get(opp['id'], [])
                if histories:
                    last_h = max(histories, key=lambda h: h['created_date'])
                    last_h['amount'] = new_amount
                opp['_pattern_flags'].append(PATTERN_AMOUNT_INFLATION)

        # 6. SPLIT_DEAL: 6% — create duplicate opp on same account within 7 days
        new_opps: List[Dict[str, Any]] = []
        base_opps_count = len(opportunities)
        for idx, opp in enumerate(opportunities[:base_opps_count]):
            if self.rng.random() < 0.06:
                created_dt = _parse_date(opp['created_date'])
                split_created = _add_days(created_dt, self.rng.randint(1, 7))
                split_id = f'006S{str(idx).zfill(14)}'
                split_opp = {
                    'id': split_id,
                    'name': opp['name'] + ' (Split)',
                    'account_id': opp['account_id'],
                    'owner_id': opp['owner_id'],
                    'type': opp['type'],
                    'stage_name': opp['stage_name'],
                    'amount': math.ceil(opp['amount'] * self.rng.uniform(0.4, 0.7) / 1000) * 1000,
                    'close_date': opp['close_date'],
                    'created_date': _fmt_date(split_created),
                    'probability': opp['probability'],
                    'is_closed': opp['is_closed'],
                    'is_won': opp['is_won'],
                    'is_sap_linked': False,
                    'sap_order_id': None,
                    '_pattern_flags': [PATTERN_SPLIT_DEAL],
                }
                new_opps.append(split_opp)
                opp['_pattern_flags'].append(PATTERN_SPLIT_DEAL)
        opportunities.extend(new_opps)

        # 7. SPEED_ANOMALY: 5% — close within 3 days of creation
        for opp in opportunities:
            if opp['is_closed'] and self.rng.random() < 0.05:
                created_dt = _parse_date(opp['created_date'])
                new_close = _add_days(created_dt, self.rng.randint(0, 3))
                if new_close > self._date_end:
                    new_close = self._date_end
                opp['close_date'] = _fmt_date(new_close)
                opp['_pattern_flags'].append(PATTERN_SPEED_ANOMALY)

        # 8. STALE_PIPELINE: 15% of open — set created >90 days ago
        for opp in open_opps:
            if self.rng.random() < 0.15:
                stale_created = _add_days(self._date_end, -(self.rng.randint(90, 365)))
                if stale_created < self._date_start:
                    stale_created = self._date_start
                opp['created_date'] = _fmt_date(stale_created)
                opp['_pattern_flags'].append(PATTERN_STALE_PIPELINE)

        # 9. OWNER_SWAP: 4% of closed won — change owner in final stage history
        for opp in closed_won:
            if self.rng.random() < 0.04:
                histories = hist_by_opp.get(opp['id'], [])
                if histories:
                    last_h = max(histories, key=lambda h: h['created_date'])
                    # Pick a different owner
                    all_user_ids = [u['id'] for u in users if u['id'] != opp['owner_id']]
                    if all_user_ids:
                        last_h['owner_id'] = self.rng.choice(all_user_ids)
                        opp['_pattern_flags'].append(PATTERN_OWNER_SWAP)

        # 10. CROSS_SYSTEM_GAP applied after SAP generation (see _apply_cross_system_gap)

    def _apply_cross_system_gap(
        self,
        opportunities: List[Dict[str, Any]],
        sap_orders: List[Dict[str, Any]],
    ) -> None:
        """Apply CROSS_SYSTEM_GAP: >30 day gap between SFDC close and SAP erdat."""
        opp_by_id = {o['id']: o for o in opportunities}
        sap_by_opp = {o['sfdc_opportunity_id']: o for o in sap_orders}

        linked_opps = [o for o in opportunities if o['is_sap_linked']]
        for opp in linked_opps:
            if self.rng.random() < 0.06:
                sap_order = sap_by_opp.get(opp['id'])
                if sap_order:
                    close_dt = _parse_date(opp['close_date'])
                    gap_days = self.rng.randint(31, 90)
                    new_erdat = _add_days(close_dt, gap_days)
                    sap_order['erdat'] = _fmt_date(new_erdat)
                    sap_order['audat'] = _fmt_date(new_erdat)
                    opp['_pattern_flags'].append(PATTERN_CROSS_SYSTEM_GAP)
                    sap_order['_pattern_flags'].append(PATTERN_CROSS_SYSTEM_GAP)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _random_date(self, start: datetime, end: datetime) -> datetime:
        delta = max(1, (end - start).days)
        return start + timedelta(days=self.rng.randint(0, delta))

    def _random_date_before(self, dt: datetime, max_days_before: int) -> datetime:
        days = self.rng.randint(0, max_days_before)
        return dt - timedelta(days=days)

    def _unique_account_name(self, used: set) -> str:
        for _ in range(100):
            name = f'{self.rng.choice(ACCOUNT_NAMES_PREFIXES)} {self.rng.choice(ACCOUNT_SUFFIXES)}'
            if name not in used:
                return name
        # Fallback with uuid suffix
        return f'{self.rng.choice(ACCOUNT_NAMES_PREFIXES)} {self.rng.choice(ACCOUNT_SUFFIXES)} {self.rng.randint(10, 99)}'


# =============================================================================
# CLI ENTRY POINT
# =============================================================================


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Generate synthetic Salesforce Opportunity data with planted anomaly patterns.'
    )
    parser.add_argument('--count', type=int, default=200, help='Number of opportunities')
    parser.add_argument('--accounts', type=int, default=50, help='Number of accounts')
    parser.add_argument('--output', type=str, default='sfdc_output/', help='Output directory')
    parser.add_argument('--seed', type=int, default=42, help='Random seed')
    parser.add_argument('--sap-link-rate', type=float, default=0.60, help='SAP link rate for won opps')
    args = parser.parse_args()

    config = SFDCGeneratorConfig(
        n_opportunities=args.count,
        n_accounts=args.accounts,
        seed=args.seed,
        sap_link_rate=args.sap_link_rate,
    )
    generator = SFDCGenerator(config)
    data = generator.generate()
    generator.write_output(data, args.output)

    # Summary
    print(f"Generated:")
    print(f"  accounts:       {len(data['accounts'])}")
    print(f"  users:          {len(data['users'])}")
    print(f"  products:       {len(data['products'])}")
    print(f"  opportunities:  {len(data['opportunities'])}")
    print(f"  stage_histories:{len(data['stage_histories'])}")
    print(f"  line_items:     {len(data['line_items'])}")
    print(f"  activities:     {len(data['activities'])}")
    print(f"  sap_orders:     {len(data['sap_orders'])}")
    print(f"  sap_doc_flows:  {len(data['sap_doc_flows'])}")

    all_flags: List[str] = []
    for o in data['opportunities']:
        all_flags.extend(o.get('_pattern_flags', []))
    from collections import Counter
    counts = Counter(all_flags)
    print("\nPlanted patterns:")
    for pattern, count in sorted(counts.items()):
        print(f"  {pattern}: {count}")

    print(f"\nOutput written to: {args.output}")


if __name__ == '__main__':
    main()
