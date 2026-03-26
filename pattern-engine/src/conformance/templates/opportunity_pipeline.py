"""
Salesforce Opportunity Pipeline Process Model Templates.

Defines expected stage-progression models for SFDC opportunity types:
- New Business  : 8 intermediate stages + Closed Won / Closed Lost
- Renewal       : Qualification + Proposal + Closed Won / Closed Lost

Stage names match the generator in synthetic-data/src/generate_sfdc.py
exactly so that conformance checking works against real event logs.

New Business pipeline:
    Prospecting -> Qualification -> Needs Analysis -> Value Proposition
    -> Id. Decision Makers -> Perception Analysis
    -> Proposal/Price Quote -> Negotiation/Review
    -> Closed Won | Closed Lost

Renewal pipeline:
    Qualification -> Proposal -> Closed Won | Closed Lost
"""

from __future__ import annotations

from typing import Optional

from ..models import ActivityType, ProcessModel, ProcessModelBuilder


def get_new_business_model() -> ProcessModel:
    """
    Return the New Business opportunity pipeline process model.

    8 intermediate stages with two valid terminal states:
    Closed Won and Closed Lost.

    Returns:
        ProcessModel for New Business opportunity pipeline
    """
    builder = ProcessModelBuilder(
        name="sfdc_new_business",
        display_name="SFDC New Business Pipeline",
        description=(
            "Standard Salesforce New Business opportunity pipeline: "
            "Prospecting → … → Negotiation/Review → Closed Won/Lost"
        ),
        version="1.0.0",
    )

    # ----- Activities --------------------------------------------------------

    builder.add_activity(
        "Prospecting",
        "Prospecting",
        ActivityType.START,
        sap_event_types=["Prospecting"],
        description="Initial prospecting stage",
    )
    builder.add_activity(
        "Qualification",
        "Qualification",
        ActivityType.INTERMEDIATE,
        sap_event_types=["Qualification"],
        description="Opportunity qualification",
    )
    builder.add_activity(
        "Needs Analysis",
        "Needs Analysis",
        ActivityType.INTERMEDIATE,
        sap_event_types=["Needs Analysis"],
        description="Customer needs analysis",
    )
    builder.add_activity(
        "Value Proposition",
        "Value Proposition",
        ActivityType.INTERMEDIATE,
        sap_event_types=["Value Proposition"],
        description="Value proposition presented",
    )
    builder.add_activity(
        "Id. Decision Makers",
        "Id. Decision Makers",
        ActivityType.INTERMEDIATE,
        sap_event_types=["Id. Decision Makers"],
        description="Decision-makers identified",
    )
    builder.add_activity(
        "Perception Analysis",
        "Perception Analysis",
        ActivityType.INTERMEDIATE,
        sap_event_types=["Perception Analysis"],
        description="Customer perception analysis",
    )
    builder.add_activity(
        "Proposal/Price Quote",
        "Proposal/Price Quote",
        ActivityType.MILESTONE,
        sap_event_types=["Proposal/Price Quote"],
        description="Formal proposal or price quote submitted",
    )
    builder.add_activity(
        "Negotiation/Review",
        "Negotiation/Review",
        ActivityType.INTERMEDIATE,
        sap_event_types=["Negotiation/Review"],
        description="Contract negotiation and review",
    )
    builder.add_activity(
        "Closed Won",
        "Closed Won",
        ActivityType.END,
        sap_event_types=["Closed Won"],
        description="Opportunity won",
    )
    # Closed Lost is OPTIONAL — only one terminal branch is taken per trace.
    # Marking it OPTIONAL prevents the checker from flagging its absence when
    # the trace ends with Closed Won (and vice-versa).
    builder.add_activity(
        "Closed Lost",
        "Closed Lost",
        ActivityType.OPTIONAL,
        sap_event_types=["Closed Lost"],
        description="Opportunity lost",
    )

    # ----- Sequential happy path ---------------------------------------------

    builder.add_sequence(
        [
            "Prospecting",
            "Qualification",
            "Needs Analysis",
            "Value Proposition",
            "Id. Decision Makers",
            "Perception Analysis",
            "Proposal/Price Quote",
            "Negotiation/Review",
        ]
    )

    # Terminal transitions from final negotiation stage
    builder.add_transition("Negotiation/Review", "Closed Won")
    builder.add_transition("Negotiation/Review", "Closed Lost")

    # Allow Closed Lost to exit from any intermediate stage
    for stage in [
        "Prospecting",
        "Qualification",
        "Needs Analysis",
        "Value Proposition",
        "Id. Decision Makers",
        "Perception Analysis",
        "Proposal/Price Quote",
    ]:
        builder.add_transition(stage, "Closed Lost", is_mandatory=False)

    return builder.build()


def get_renewal_model() -> ProcessModel:
    """
    Return the Renewal opportunity pipeline process model.

    Shorter pipeline: Qualification → Proposal → Closed Won/Lost.

    Returns:
        ProcessModel for Renewal opportunity pipeline
    """
    builder = ProcessModelBuilder(
        name="sfdc_renewal",
        display_name="SFDC Renewal Pipeline",
        description=(
            "Salesforce Renewal opportunity pipeline: "
            "Qualification → Proposal → Closed Won/Lost"
        ),
        version="1.0.0",
    )

    builder.add_activity(
        "Qualification",
        "Qualification",
        ActivityType.START,
        sap_event_types=["Qualification"],
        description="Renewal qualification",
    )
    builder.add_activity(
        "Proposal",
        "Proposal",
        ActivityType.INTERMEDIATE,
        sap_event_types=["Proposal"],
        description="Renewal proposal",
    )
    builder.add_activity(
        "Closed Won",
        "Closed Won",
        ActivityType.END,
        sap_event_types=["Closed Won"],
        description="Renewal won",
    )
    # Closed Lost is OPTIONAL — only one terminal branch is taken per trace.
    builder.add_activity(
        "Closed Lost",
        "Closed Lost",
        ActivityType.OPTIONAL,
        sap_event_types=["Closed Lost"],
        description="Renewal lost",
    )

    # Sequential happy path
    builder.add_sequence(["Qualification", "Proposal"])

    # Terminal transitions
    builder.add_transition("Proposal", "Closed Won")
    builder.add_transition("Proposal", "Closed Lost")

    # Early exit
    builder.add_transition("Qualification", "Closed Lost", is_mandatory=False)

    return builder.build()


def get_opportunity_model(record_type: str = "New Business") -> ProcessModel:
    """
    Factory: return the appropriate opportunity pipeline model for *record_type*.

    Args:
        record_type: SFDC opportunity type (e.g. "New Business", "Renewal")

    Returns:
        ProcessModel matching the record type.
        Falls back to New Business model for unknown types.
    """
    if record_type == "Renewal":
        return get_renewal_model()
    # Default (covers "New Business", "Upsell", and unknown types)
    return get_new_business_model()
