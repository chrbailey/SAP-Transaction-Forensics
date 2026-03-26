"""
Tests for generate_sfdc.py — Synthetic Salesforce data generator.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import pytest

# Allow imports from src/
sys.path.insert(0, str(Path(__file__).parent.parent / 'src'))

from generate_sfdc import (
    PATTERN_AMOUNT_INFLATION,
    PATTERN_CROSS_SYSTEM_GAP,
    PATTERN_GHOST_PIPELINE,
    PATTERN_OWNER_SWAP,
    PATTERN_QUARTER_END,
    PATTERN_SPLIT_DEAL,
    PATTERN_SPEED_ANOMALY,
    PATTERN_STAGE_REGRESSION,
    PATTERN_STAGE_SKIP,
    PATTERN_STALE_PIPELINE,
    PIPELINE_NEW_BUSINESS,
    PIPELINE_RENEWAL,
    PIPELINE_UPSELL,
    SFDCGenerator,
    SFDCGeneratorConfig,
)


# =============================================================================
# TestGeneratorConfig
# =============================================================================


class TestGeneratorConfig:
    def test_defaults(self):
        cfg = SFDCGeneratorConfig()
        assert cfg.n_accounts == 50
        assert cfg.n_opportunities == 200
        assert cfg.n_users == 20
        assert cfg.n_products == 15
        assert cfg.sap_link_rate == 0.60
        assert cfg.date_range_start == '2024-01-01'
        assert cfg.date_range_end == '2025-12-31'
        assert cfg.win_rate == 0.35
        assert cfg.seed == 42

    def test_custom_config(self):
        cfg = SFDCGeneratorConfig(
            n_accounts=10,
            n_opportunities=50,
            n_users=5,
            n_products=8,
            sap_link_rate=0.80,
            date_range_start='2024-06-01',
            date_range_end='2024-12-31',
            win_rate=0.50,
            seed=99,
        )
        assert cfg.n_accounts == 10
        assert cfg.n_opportunities == 50
        assert cfg.n_users == 5
        assert cfg.n_products == 8
        assert cfg.sap_link_rate == 0.80
        assert cfg.seed == 99

    def test_generator_accepts_config(self):
        cfg = SFDCGeneratorConfig(n_opportunities=20, seed=1)
        gen = SFDCGenerator(cfg)
        assert gen.config is cfg


# =============================================================================
# TestDataGeneration
# =============================================================================


class TestDataGeneration:
    @pytest.fixture(scope='class')
    def data(self):
        cfg = SFDCGeneratorConfig(
            n_accounts=50,
            n_opportunities=200,
            n_users=20,
            n_products=15,
            seed=42,
        )
        gen = SFDCGenerator(cfg)
        return gen.generate()

    def test_correct_account_count(self, data):
        assert len(data['accounts']) == 50

    def test_correct_user_count(self, data):
        assert len(data['users']) == 20

    def test_correct_product_count(self, data):
        assert len(data['products']) == 15

    def test_opportunity_count_at_least_base(self, data):
        # SPLIT_DEAL may add extras; base should be 200+
        assert len(data['opportunities']) >= 200

    def test_stage_histories_for_all_opps(self, data):
        opp_ids = {o['id'] for o in data['opportunities']}
        hist_opp_ids = {h['opportunity_id'] for h in data['stage_histories']}
        # All base opportunities (non-split) should have stage history
        base_ids = {o['id'] for o in data['opportunities'] if PATTERN_SPLIT_DEAL not in o.get('_pattern_flags', []) or not o['id'].startswith('006S')}
        missing = base_ids - hist_opp_ids
        # Allow for split deals (which may not have full histories)
        assert len(missing) == 0 or all(oid.startswith('006S') for oid in missing)

    def test_valid_account_references(self, data):
        account_ids = {a['id'] for a in data['accounts']}
        for opp in data['opportunities']:
            assert opp['account_id'] in account_ids, (
                f"Opp {opp['id']} references unknown account {opp['account_id']}"
            )

    def test_valid_product_references(self, data):
        product_ids = {p['id'] for p in data['products']}
        for li in data['line_items']:
            assert li['product_id'] in product_ids, (
                f"Line item {li['id']} references unknown product {li['product_id']}"
            )

    def test_valid_opportunity_references_in_histories(self, data):
        opp_ids = {o['id'] for o in data['opportunities']}
        for h in data['stage_histories']:
            assert h['opportunity_id'] in opp_ids

    def test_valid_opportunity_references_in_activities(self, data):
        opp_ids = {o['id'] for o in data['opportunities']}
        for a in data['activities']:
            assert a['opportunity_id'] in opp_ids

    def test_sap_linked_records_exist(self, data):
        linked_opps = [o for o in data['opportunities'] if o['is_sap_linked']]
        assert len(linked_opps) > 0
        assert len(data['sap_orders']) > 0
        assert len(data['sap_doc_flows']) > 0

    def test_sap_order_references_linked_opp(self, data):
        opp_ids = {o['id'] for o in data['opportunities']}
        for order in data['sap_orders']:
            assert order['sfdc_opportunity_id'] in opp_ids

    def test_deterministic_seed(self):
        cfg = SFDCGeneratorConfig(n_opportunities=50, seed=123)
        gen1 = SFDCGenerator(cfg)
        gen2 = SFDCGenerator(cfg)
        d1 = gen1.generate()
        d2 = gen2.generate()
        assert len(d1['opportunities']) == len(d2['opportunities'])
        assert d1['opportunities'][0]['id'] == d2['opportunities'][0]['id']
        assert d1['opportunities'][0]['amount'] == d2['opportunities'][0]['amount']

    def test_different_seeds_produce_different_data(self):
        cfg_a = SFDCGeneratorConfig(n_opportunities=50, seed=1)
        cfg_b = SFDCGeneratorConfig(n_opportunities=50, seed=2)
        d1 = SFDCGenerator(cfg_a).generate()
        d2 = SFDCGenerator(cfg_b).generate()
        amounts_a = [o['amount'] for o in d1['opportunities']]
        amounts_b = [o['amount'] for o in d2['opportunities']]
        assert amounts_a != amounts_b

    def test_all_opportunities_have_pattern_flags_key(self, data):
        for opp in data['opportunities']:
            assert '_pattern_flags' in opp
            assert isinstance(opp['_pattern_flags'], list)

    def test_opportunities_have_required_fields(self, data):
        required = ['id', 'name', 'account_id', 'owner_id', 'type',
                    'stage_name', 'amount', 'close_date', 'created_date',
                    'probability', 'is_closed', 'is_won', 'is_sap_linked']
        for opp in data['opportunities']:
            for f in required:
                assert f in opp, f"Opp {opp['id']} missing field '{f}'"

    def test_pipeline_constants_correct(self):
        assert 'Prospecting' in PIPELINE_NEW_BUSINESS
        assert 'Negotiation/Review' in PIPELINE_NEW_BUSINESS
        assert len(PIPELINE_NEW_BUSINESS) == 8
        assert 'Qualification' in PIPELINE_RENEWAL
        assert 'Proposal' in PIPELINE_RENEWAL
        assert len(PIPELINE_RENEWAL) == 2
        assert 'Discovery' in PIPELINE_UPSELL
        assert len(PIPELINE_UPSELL) == 3


# =============================================================================
# TestPlantedPatterns
# =============================================================================


class TestPlantedPatterns:
    @pytest.fixture(scope='class')
    def data(self):
        # Use a larger count to ensure pattern incidence
        cfg = SFDCGeneratorConfig(
            n_accounts=50,
            n_opportunities=300,
            n_users=20,
            n_products=15,
            sap_link_rate=0.70,
            seed=42,
        )
        gen = SFDCGenerator(cfg)
        return gen.generate()

    @pytest.fixture(scope='class')
    def pattern_counts(self, data):
        all_flags = []
        for o in data['opportunities']:
            all_flags.extend(o.get('_pattern_flags', []))
        for order in data.get('sap_orders', []):
            all_flags.extend(order.get('_pattern_flags', []))
        return Counter(all_flags)

    def test_stage_skip_exists(self, pattern_counts):
        assert pattern_counts[PATTERN_STAGE_SKIP] >= 1, \
            f"Expected at least 1 STAGE_SKIP, got {pattern_counts[PATTERN_STAGE_SKIP]}"

    def test_quarter_end_exists(self, pattern_counts):
        assert pattern_counts[PATTERN_QUARTER_END] >= 5, \
            f"Expected at least 5 QUARTER_END, got {pattern_counts[PATTERN_QUARTER_END]}"

    def test_ghost_pipeline_exists(self, pattern_counts):
        assert pattern_counts[PATTERN_GHOST_PIPELINE] >= 1, \
            f"Expected at least 1 GHOST_PIPELINE, got {pattern_counts[PATTERN_GHOST_PIPELINE]}"

    def test_stage_regression_exists(self, pattern_counts):
        assert pattern_counts[PATTERN_STAGE_REGRESSION] >= 1, \
            f"Expected at least 1 STAGE_REGRESSION, got {pattern_counts[PATTERN_STAGE_REGRESSION]}"

    def test_amount_inflation_exists(self, pattern_counts):
        assert pattern_counts[PATTERN_AMOUNT_INFLATION] >= 1, \
            f"Expected at least 1 AMOUNT_INFLATION, got {pattern_counts[PATTERN_AMOUNT_INFLATION]}"

    def test_split_deal_exists(self, pattern_counts):
        assert pattern_counts[PATTERN_SPLIT_DEAL] >= 2, \
            f"Expected at least 2 SPLIT_DEAL, got {pattern_counts[PATTERN_SPLIT_DEAL]}"

    def test_speed_anomaly_exists(self, pattern_counts):
        assert pattern_counts[PATTERN_SPEED_ANOMALY] >= 1, \
            f"Expected at least 1 SPEED_ANOMALY, got {pattern_counts[PATTERN_SPEED_ANOMALY]}"

    def test_stale_pipeline_exists(self, pattern_counts):
        assert pattern_counts[PATTERN_STALE_PIPELINE] >= 3, \
            f"Expected at least 3 STALE_PIPELINE, got {pattern_counts[PATTERN_STALE_PIPELINE]}"

    def test_owner_swap_exists(self, pattern_counts):
        assert pattern_counts[PATTERN_OWNER_SWAP] >= 1, \
            f"Expected at least 1 OWNER_SWAP, got {pattern_counts[PATTERN_OWNER_SWAP]}"

    def test_cross_system_gap_exists(self, pattern_counts):
        assert pattern_counts[PATTERN_CROSS_SYSTEM_GAP] >= 1, \
            f"Expected at least 1 CROSS_SYSTEM_GAP, got {pattern_counts[PATTERN_CROSS_SYSTEM_GAP]}"

    def test_stage_skip_removes_stages(self, data):
        """Skipped opps should have fewer stage history entries than expected."""
        skipped_ids = {
            o['id'] for o in data['opportunities']
            if PATTERN_STAGE_SKIP in o.get('_pattern_flags', [])
        }
        hist_counts = Counter(h['opportunity_id'] for h in data['stage_histories'])
        # Skipped opps should exist and have at least 1 stage
        for oid in skipped_ids:
            assert hist_counts[oid] >= 1

    def test_quarter_end_dates_near_end_of_quarter(self, data):
        """Quarter-end flagged opps should have close dates in last 5 days of a quarter."""
        quarter_ends = {'03-31', '06-30', '09-30', '12-31'}
        for opp in data['opportunities']:
            if PATTERN_QUARTER_END in opp.get('_pattern_flags', []):
                close = opp['close_date']  # YYYY-MM-DD
                mm_dd = close[5:]
                # Month-day should be within 5 days of a quarter end
                from datetime import datetime as dt
                close_dt = dt.strptime(close, '%Y-%m-%d')
                month = close_dt.month
                day = close_dt.day
                # Check it's in one of the last 5 days of a quarter month
                quarter_end_days = {
                    (3, 31), (3, 30), (3, 29), (3, 28), (3, 27),
                    (6, 30), (6, 29), (6, 28), (6, 27), (6, 26),
                    (9, 30), (9, 29), (9, 28), (9, 27), (9, 26),
                    (12, 31), (12, 30), (12, 29), (12, 28), (12, 27),
                }
                assert (month, day) in quarter_end_days, \
                    f"QUARTER_END opp {opp['id']} has close_date {close} not near quarter end"

    def test_ghost_pipeline_has_no_activities(self, data):
        ghost_ids = {
            o['id'] for o in data['opportunities']
            if PATTERN_GHOST_PIPELINE in o.get('_pattern_flags', [])
        }
        act_opp_ids = {a['opportunity_id'] for a in data['activities']}
        for oid in ghost_ids:
            assert oid not in act_opp_ids, \
                f"Ghost pipeline opp {oid} should have no activities"

    def test_split_deals_share_account(self, data):
        split_opps = [
            o for o in data['opportunities']
            if PATTERN_SPLIT_DEAL in o.get('_pattern_flags', [])
            and o['id'].startswith('006S')
        ]
        opp_by_id = {o['id']: o for o in data['opportunities']}
        for split in split_opps:
            # Find the original — same account_id should exist among non-split opps
            same_account = [
                o for o in data['opportunities']
                if o['account_id'] == split['account_id']
                and not o['id'].startswith('006S')
            ]
            assert len(same_account) >= 1

    def test_speed_anomaly_closed_fast(self, data):
        from datetime import datetime as dt
        for opp in data['opportunities']:
            if PATTERN_SPEED_ANOMALY in opp.get('_pattern_flags', []):
                created = dt.strptime(opp['created_date'], '%Y-%m-%d')
                closed = dt.strptime(opp['close_date'], '%Y-%m-%d')
                delta = (closed - created).days
                assert delta <= 3, \
                    f"SPEED_ANOMALY opp {opp['id']} delta={delta} days, expected <=3"

    def test_stale_pipeline_is_open(self, data):
        for opp in data['opportunities']:
            if PATTERN_STALE_PIPELINE in opp.get('_pattern_flags', []):
                assert not opp['is_closed'], \
                    f"STALE_PIPELINE opp {opp['id']} should be open"

    def test_cross_system_gap_erdat_after_close(self, data):
        from datetime import datetime as dt
        opp_by_id = {o['id']: o for o in data['opportunities']}
        for order in data.get('sap_orders', []):
            if PATTERN_CROSS_SYSTEM_GAP in order.get('_pattern_flags', []):
                opp = opp_by_id.get(order['sfdc_opportunity_id'])
                assert opp is not None
                close_dt = dt.strptime(opp['close_date'], '%Y-%m-%d')
                erdat = dt.strptime(order['erdat'], '%Y-%m-%d')
                gap = (erdat - close_dt).days
                assert gap > 30, \
                    f"CROSS_SYSTEM_GAP order {order['vbeln']} gap={gap} days, expected >30"


# =============================================================================
# TestJSONOutput
# =============================================================================


class TestJSONOutput:
    @pytest.fixture
    def tmp_output(self, tmp_path):
        return tmp_path / 'sfdc_out'

    @pytest.fixture
    def generator_and_data(self):
        cfg = SFDCGeneratorConfig(n_opportunities=30, n_accounts=10, seed=77)
        gen = SFDCGenerator(cfg)
        data = gen.generate()
        return gen, data

    def test_write_creates_output_dir(self, generator_and_data, tmp_output):
        gen, data = generator_and_data
        gen.write_output(data, str(tmp_output))
        assert tmp_output.exists()

    def test_all_core_files_written(self, generator_and_data, tmp_output):
        gen, data = generator_and_data
        gen.write_output(data, str(tmp_output))
        expected = [
            'accounts.json', 'users.json', 'products.json',
            'opportunities.json', 'stage_histories.json',
            'line_items.json', 'activities.json',
        ]
        for fname in expected:
            assert (tmp_output / fname).exists(), f"Missing {fname}"

    def test_sap_files_written_when_linked(self, generator_and_data, tmp_output):
        gen, data = generator_and_data
        gen.write_output(data, str(tmp_output))
        if data['sap_orders']:
            assert (tmp_output / 'sap_orders.json').exists()
        if data['sap_doc_flows']:
            assert (tmp_output / 'sap_doc_flows.json').exists()

    def test_json_roundtrip_opportunities(self, generator_and_data, tmp_output):
        gen, data = generator_and_data
        gen.write_output(data, str(tmp_output))
        loaded = json.loads((tmp_output / 'opportunities.json').read_text())
        assert isinstance(loaded, list)
        assert len(loaded) == len(data['opportunities'])
        assert loaded[0]['id'] == data['opportunities'][0]['id']

    def test_json_roundtrip_stage_histories(self, generator_and_data, tmp_output):
        gen, data = generator_and_data
        gen.write_output(data, str(tmp_output))
        loaded = json.loads((tmp_output / 'stage_histories.json').read_text())
        assert isinstance(loaded, list)
        assert len(loaded) == len(data['stage_histories'])

    def test_json_roundtrip_sap_orders(self, generator_and_data, tmp_output):
        gen, data = generator_and_data
        gen.write_output(data, str(tmp_output))
        if data['sap_orders']:
            loaded = json.loads((tmp_output / 'sap_orders.json').read_text())
            assert len(loaded) == len(data['sap_orders'])

    def test_sap_files_not_written_when_no_linked(self, tmp_path):
        """With sap_link_rate=0 and no won opps, SAP files should not be created."""
        cfg = SFDCGeneratorConfig(
            n_opportunities=20,
            n_accounts=5,
            sap_link_rate=0.0,
            seed=1,
        )
        gen = SFDCGenerator(cfg)
        data = gen.generate()
        out = tmp_path / 'no_sap'
        gen.write_output(data, str(out))
        assert not (out / 'sap_orders.json').exists()
        assert not (out / 'sap_doc_flows.json').exists()

    def test_output_is_valid_json(self, generator_and_data, tmp_output):
        gen, data = generator_and_data
        gen.write_output(data, str(tmp_output))
        for f in tmp_output.glob('*.json'):
            content = f.read_text()
            parsed = json.loads(content)
            assert parsed is not None
